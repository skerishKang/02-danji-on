import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../27_알림함.html', import.meta.url), 'utf8');

assert.ok(html.includes("if(result.mode==='auth-required'){showState(result.status===403?'본인 확인된 입주민만 알림함을 볼 수 있습니다.':'로그인이 필요합니다.');return}"),
  '401/403 notification gate copy must remain fail-closed');

assert.ok(html.includes("function optionalText(selector,value)") &&
          html.includes("if(node)node.textContent=value"),
  'live notification state updates must null-guard optional text slots');
assert.ok(html.includes("function optionalAttr(selector,name,value)") &&
          html.includes("if(node)node.setAttribute(name,value)"),
  'live notification state updates must null-guard optional attribute slots');

for (const unsafe of [
  "document.querySelector('.unread-count').textContent",
  "document.querySelector('.side-count').textContent",
  "document.querySelector('.bell i').textContent",
  "document.querySelector('.bell').setAttribute"
]) {
  assert.equal(html.includes(unsafe), false,
    `notification page must not use unsafe optional-slot mutation: ${unsafe}`);
}

assert.ok(html.includes("optionalAttr('.bell','aria-label','새 알림 0개')"),
  'gated state must reset bell accessibility label when the bell exists');
assert.ok(html.includes("render(result.notifications,result.unreadCount)"),
  'successful server notification rendering must remain wired');
assert.ok(html.includes("bridge.markAllNotificationsRead()") &&
          html.includes("bridge.markNotificationRead(item.dataset.notification)"),
  'mark-read behavior must remain wired');

console.log('PASS #525 notification auth-gate null safety');
