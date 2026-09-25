import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  MULTIPART_REQUEST_TOO_LARGE,
  withBoundedMultipartRequest
} from '../src/multipart-request-bounds.ts';
import {
  STORAGE_UPLOAD_POLICIES,
  validateStorageUpload
} from '../src/storage-policy.mjs';

const UPLOAD_URL = 'https://example.test/api/v1/storage/objects';
const ROUTE_LIMIT = 12 * 1024 * 1024;

function browserMultipartRequest({ contentLength, body } = {}) {
  const form = new FormData();
  form.set('kind', 'business-image');
  form.set('complexSlug', 'banglim');
  form.set('file', new File(['image-bytes'], 'shop.png', { type: 'image/png' }));
  const request = new Request(UPLOAD_URL, { method: 'POST', body: body || form });
  if (contentLength !== undefined) request.headers.set('content-length', contentLength);
  return request;
}

function streamedRequest(contentLength, totalBytes, chunkBytes = 64 * 1024) {
  let remaining = totalBytes;
  const body = new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, remaining);
      controller.enqueue(new Uint8Array(size));
      remaining -= size;
    }
  });
  return new Request(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'content-type': 'multipart/form-data; boundary=test-boundary',
      ...(contentLength === undefined ? {} : { 'content-length': contentLength })
    },
    body,
    duplex: 'half'
  });
}

test('#1011 browser multipart remains parseable without Content-Length', async () => {
  const request = browserMultipartRequest();
  assert.equal(request.headers.get('content-length'), null);

  const bounded = await withBoundedMultipartRequest(request, ROUTE_LIMIT);
  assert.equal(bounded.ok, true);
  assert.equal(bounded.declaredLength, null);

  const form = await bounded.request.formData();
  assert.equal(form.get('kind'), 'business-image');
  assert.equal(form.get('complexSlug'), 'banglim');
  assert.equal(form.get('file').name, 'shop.png');
  assert.equal(form.get('file').type, 'image/png');
});

test('#1011 malformed and negative Content-Length remain advisory, actual bytes are bounded', async () => {
  for (const contentLength of ['not-a-number', '-1', '1.5']) {
    const request = browserMultipartRequest({ contentLength });
    const bounded = await withBoundedMultipartRequest(request, ROUTE_LIMIT);
    assert.equal(bounded.ok, true, `${contentLength} must not be sole rejection authority`);
    assert.equal(bounded.declaredLength, null);
    const form = await bounded.request.formData();
    assert.equal(form.get('file') instanceof File, true);
  }
});

test('#1011 oversized declared Content-Length is rejected before body parsing', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull() {
      throw new Error('declared oversize body must not be pulled by the preparse helper');
    },
    cancel() {
      cancelled = true;
    }
  });
  const request = new Request(UPLOAD_URL, {
    method: 'POST',
    headers: { 'content-length': String(ROUTE_LIMIT + 1) },
    body,
    duplex: 'half'
  });

  const bounded = await withBoundedMultipartRequest(request, ROUTE_LIMIT);
  assert.equal(bounded.ok, false);
  assert.equal(bounded.code, MULTIPART_REQUEST_TOO_LARGE);
  assert.equal(bounded.declaredLength, ROUTE_LIMIT + 1);
  assert.equal(cancelled, true, 'declared oversize must cancel without parsing');
});

test('#1011 dishonest small Content-Length cannot bypass the actual stream bound', async () => {
  let cancelReason = null;
  let remaining = ROUTE_LIMIT + 1;
  const body = new ReadableStream({
    pull(controller) {
      const size = Math.min(64 * 1024, remaining);
      controller.enqueue(new Uint8Array(size));
      remaining -= size;
    },
    cancel(reason) {
      cancelReason = reason;
    }
  });
  const request = new Request(UPLOAD_URL, {
    method: 'POST',
    headers: { 'content-length': '1' },
    body,
    duplex: 'half'
  });

  const bounded = await withBoundedMultipartRequest(request, ROUTE_LIMIT);
  assert.equal(bounded.ok, false);
  assert.equal(bounded.code, MULTIPART_REQUEST_TOO_LARGE);
  assert.equal(bounded.declaredLength, 1);
  assert.equal(cancelReason, 'multipart request exceeds configured bound');
  assert.equal(request.bodyUsed, true);
});

test('#1011 cancellation failure cannot convert an oversized verdict to 500', async () => {
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(ROUTE_LIMIT));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      throw new Error('socket reset by peer');
    }
  });
  const request = new Request(UPLOAD_URL, { method: 'POST', body, duplex: 'half' });

  const bounded = await withBoundedMultipartRequest(request, ROUTE_LIMIT);
  assert.equal(bounded.ok, false);
  assert.equal(bounded.code, MULTIPART_REQUEST_TOO_LARGE);
});

test('#1011 streamed request at the exact limit remains parseable', async () => {
  const request = streamedRequest(undefined, ROUTE_LIMIT);
  const bounded = await withBoundedMultipartRequest(request, ROUTE_LIMIT);
  assert.equal(bounded.ok, true);
  assert.equal((await bounded.request.arrayBuffer()).byteLength, ROUTE_LIMIT);
});

test('#1011 per-kind file policies remain authoritative after preparse', () => {
  assert.equal(STORAGE_UPLOAD_POLICIES['business-image'].maxBytes, 8 * 1024 * 1024);
  assert.equal(STORAGE_UPLOAD_POLICIES['official-news-image'].maxBytes, 8 * 1024 * 1024);
  assert.equal(STORAGE_UPLOAD_POLICIES['application-document'].maxBytes, 10 * 1024 * 1024);
  assert.equal(STORAGE_UPLOAD_POLICIES['resident-evidence'].maxBytes, 10 * 1024 * 1024);

  const tooLarge = validateStorageUpload('business-image', [
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' })
  ]);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.code, 'FILE_TOO_LARGE');

  const allowed = validateStorageUpload('application-document', [
    new File([new Uint8Array(1024)], 'allowed.pdf', { type: 'application/pdf' })
  ]);
  assert.equal(allowed.ok, true);
});

test('#1011 canonical route bounds and reconstructs before formData', async () => {
  const source = await readFile(new URL('../src/storage-upload-v2.ts', import.meta.url), 'utf8');
  const boundIndex = source.indexOf('await withBoundedMultipartRequest(request, MAX_UPLOAD_REQUEST_BYTES)');
  const parseIndex = source.indexOf('await boundedUpload.request.formData()');
  assert.ok(boundIndex >= 0, 'canonical route must call the bounded preparse helper');
  assert.ok(parseIndex > boundIndex, 'formData must consume only the bounded reconstructed request');
  assert.equal(source.includes("Number(request.headers.get('content-length')"), false,
    'Content-Length must not be the route authority');
  assert.ok(source.includes('MAX_UPLOAD_REQUEST_BYTES = 12 * 1024 * 1024'),
    'canonical multipart envelope must remain 12 MiB');
});

console.log('STORAGE_MULTIPART_BOUNDS=PASS');
