(() => {
  'use strict';

  const MAX_IMAGES = 3;
  const MAX_BYTES = 1024 * 1024;
  const MAX_EDGE = 1280;

  function bytesFromDataUrl(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    if (comma < 0) return 0;
    const b64 = dataUrl.slice(comma + 1);
    return Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  }

  function base64FromDataUrl(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    return comma >= 0 ? dataUrl.slice(comma + 1) : '';
  }

  function safeName(name, fallback = 'image.jpg') {
    const value = String(name || fallback).replace(/[\\/\0-\x1f\x7f]/g, '_').trim();
    return (value || fallback).slice(0, 180);
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('IMAGE_READ_FAILED'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  function imageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
      image.src = url;
    });
  }

  async function compressImage(file) {
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('IMAGE_TYPE_REQUIRED');
    const source = await readAsDataUrl(file);
    const image = await imageFromUrl(source);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth || image.width || 1, image.naturalHeight || image.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height || 1) * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    let quality = 0.86;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (bytesFromDataUrl(dataUrl) > MAX_BYTES && quality > 0.46) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    if (bytesFromDataUrl(dataUrl) > MAX_BYTES) {
      const shrink = Math.sqrt(MAX_BYTES / bytesFromDataUrl(dataUrl)) * 0.9;
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.floor(canvas.width * shrink));
      tmp.height = Math.max(1, Math.floor(canvas.height * shrink));
      const tctx = tmp.getContext('2d', { alpha: false });
      if (!tctx) throw new Error('CANVAS_UNAVAILABLE');
      tctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
      dataUrl = tmp.toDataURL('image/jpeg', 0.72);
    }
    const byteSize = bytesFromDataUrl(dataUrl);
    if (!byteSize || byteSize > MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');
    const stem = safeName(file.name || 'image').replace(/\.[^.]+$/, '');
    return {
      fileName: safeName(stem + '.jpg'),
      contentType: 'image/jpeg',
      byteSize,
      dataBase64: base64FromDataUrl(dataUrl),
      previewUrl: dataUrl
    };
  }

  async function prepareImages(files, max = MAX_IMAGES) {
    const list = Array.from(files || []);
    if (list.length > max) throw new Error('TOO_MANY_IMAGES');
    const out = [];
    for (const file of list) out.push(await compressImage(file));
    return out;
  }

  async function prepareFiles(files, { max = 3, maxBytes = 5 * 1024 * 1024 } = {}) {
    const list = Array.from(files || []);
    if (list.length > max) throw new Error('TOO_MANY_FILES');
    const out = [];
    for (const file of list) {
      if (!file || file.size < 1 || file.size > maxBytes) throw new Error('FILE_TOO_LARGE');
      const dataUrl = await readAsDataUrl(file);
      const dataBase64 = base64FromDataUrl(dataUrl);
      if (!dataBase64) throw new Error('FILE_READ_FAILED');
      out.push({
        fileName: safeName(file.name || 'attachment'),
        contentType: String(file.type || 'application/octet-stream').slice(0, 120),
        byteSize: file.size,
        dataBase64
      });
    }
    return out;
  }

  globalThis.DanjionWriteMedia = {
    MAX_IMAGES,
    MAX_BYTES,
    MAX_EDGE,
    prepareImages,
    prepareFiles,
    compressImage
  };
})();
