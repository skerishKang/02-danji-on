import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');
const sessionSrc = await read('../assets/danjion-session.js');
const consoleSrc = await read('../assets/danjion-admin-console.js');
const adminPage = await read('../admin/index.html');

const ctx = {
  location: { hostname: 'danjion.pages.dev', search: '' },
  URL,
  URLSearchParams,
  console,
  DanjionAdminAuthority: {
    isSuperAdminAuthority(value) {
      return value?.state === 'admin' && value?.wildcard === true;
    }
  }
};
vm.createContext(ctx);
vm.runInContext(sessionSrc, ctx);
vm.runInContext(consoleSrc, ctx);
const C = ctx.DanjionAdminConsole;

const onlyMessaging = C.consoleSections({
  state: 'operator',
  wildcard: false,
  scopes: ['household.message.manage']
});
assert.deepEqual(
  Array.from(onlyMessaging.operational, (section) => String(section.id)),
  ['householdMessages'],
  'dedicated household messaging scope must not unlock unrelated admin surfaces'
);

const section = C.OPERATIONAL_SECTIONS.find((item) => item.id === 'householdMessages');
assert.ok(section, 'household message admin section must exist');
assert.equal(section.requiredScope, 'household.message.manage');

const listCalls = [];
const listed = await C.loadSection(async (url, init) => {
  listCalls.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        units: [
          { buildingCode: '101', unitCode: '1001' },
          { buildingCode: '102', unitCode: '1802' }
        ],
        deliveryChannel: 'in_app',
        sendEnabled: false
      }
    })
  };
}, 'https://api.test', section);

assert.equal(listed.state, 'ready');
assert.equal(listed.rows.length, 2);
assert.ok(listCalls[0].url.endsWith('/api/v1/admin/complexes/banglim-myeongji-roadhill/household-messages/targets'));
assert.equal(listCalls[0].init?.method, undefined, 'target inventory must stay a GET');

const previewCalls = [];
const previewed = await C.previewHouseholdMessageTargets(async (url, init) => {
  previewCalls.push({ url, init });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        targetType: 'units',
        targetUnitCount: 2,
        recipientAccountCount: 3,
        deliveryChannel: 'in_app',
        sendEnabled: false,
        dispatchStatus: 'disabled_pending_activation'
      }
    })
  };
}, 'https://api.test', {
  targetType: 'units',
  units: [
    { buildingCode: '101', unitCode: '1001' },
    { buildingCode: '102', unitCode: '1802' }
  ]
});

assert.equal(previewed.state, 'preview');
assert.equal(previewed.data.targetUnitCount, 2);
assert.equal(previewed.data.recipientAccountCount, 3);
assert.equal(previewed.data.sendEnabled, false);
assert.equal(previewCalls.length, 1);
assert.ok(previewCalls[0].url.endsWith('/api/v1/admin/complexes/banglim-myeongji-roadhill/household-messages/preview'));
assert.equal(previewCalls[0].init.method, 'POST');
assert.deepEqual(JSON.parse(previewCalls[0].init.body), {
  targetType: 'units',
  units: [
    { buildingCode: '101', unitCode: '1001' },
    { buildingCode: '102', unitCode: '1802' }
  ]
});

const beforeInvalid = previewCalls.length;
const invalid = await C.previewHouseholdMessageTargets(async () => {
  throw new Error('invalid client target must not reach the network');
}, 'https://api.test', { targetType: 'unit', units: [] });
assert.equal(invalid.state, 'invalid-request');
assert.equal(previewCalls.length, beforeInvalid);

assert.ok(adminPage.includes("function householdMessageComposer(rows,apiBase)"),
  'Admin Console must render the household message composer');
assert.ok(adminPage.includes("'대상 미리보기'"),
  'Admin Console must expose the server-authoritative target preview action');
assert.ok(adminPage.includes("send.disabled=true"),
  'dispatch control must be hard-disabled before activation');
assert.ok(adminPage.includes('Production 발송은 별도 승인 후 활성화됩니다.'),
  'Admin Console must make the activation boundary visible');
assert.ok(adminPage.includes('작성 내용은 현재 브라우저에서만 유지되며 실제 발송·저장은 하지 않습니다.'),
  'message title/body must not be represented as persisted in the preview-only slice');

assert.ok(consoleSrc.includes('/household-messages/preview'));
assert.ok(!consoleSrc.includes('/household-messages/send'),
  'no dispatch route may exist in the preview-only bridge');
assert.ok(!/sendHouseholdMessage|dispatchHouseholdMessage/.test(consoleSrc),
  'no disguised dispatch helper may exist before activation');

console.log('PASS #756 household message Admin Console target-preview boundary');
