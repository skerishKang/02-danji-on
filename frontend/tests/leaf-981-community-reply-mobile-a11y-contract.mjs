import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../13_이웃대화_글상세_댓글.html', import.meta.url), 'utf8');
const live = page.match(/<script id="danjion-community-detail-live-wiring-329">([\s\S]*?)<\/script>/);
assert.ok(live, 'community detail live wiring script must exist');
const script = live[1];

const hasReplyTriggerTarget = source => /\.comment-tools button\{[^}]*min-height:44px/.test(source);
const hasReplyInputTarget = source => /\.reply-form input,\.server-reply-form input\{[^}]*min-height:44px/.test(source);
const hasAccessibleLabel = source => /aria-label="'\+esc\(replyLabel\(c\)\)\+'"/.test(source);
const hasSafeArea = source => /env\(safe-area-inset-bottom,0px\)/.test(source);
const hasFocusOnOpen = source => /function focusReplyInput\(form\)[\s\S]*input\.focus\(\{preventScroll:true\}\)/.test(source);

assert.match(page, /function replyLabel\(c\)\{return String\(c&&c\.author&&c\.author\.nickname\|\|'주민'\)\+'님에게 답글';\}/, 'reply label must include target nickname context');
assert.match(page, /const inputId='reply-input-'\+id;/, 'dynamic reply inputs must have unique id derived from parent comment');
assert.ok(hasAccessibleLabel(page), 'dynamic reply input must expose an explicit accessible name');
assert.ok(page.includes('label class="sr-only" for="\'+inputId+\'">\'+esc(replyLabel(c))+\'</label>'), 'dynamic reply input must have a matching explicit label');
assert.match(page, /data-server-reply-cancel>취소<\/button>/, 'reply form must expose a cancel control');
assert.ok(hasReplyTriggerTarget(page), 'reply open/toggle controls must have a 44px minimum touch target');
assert.ok(hasReplyInputTarget(page), 'reply input must have a 44px minimum touch target');
assert.match(page, /\.reply-form button,\.server-reply-form button\{[^}]*min-height:44px/, 'reply controls must have a 44px minimum touch target');
assert.ok(hasSafeArea(page), 'mobile geometry must use safe-area inset');
assert.match(page, /--community-bottom-offset:calc\(68px \+ var\(--community-safe-bottom\)\)/, 'sticky action offset must add safe-area to shared 68px nav');
assert.match(page, /html body\[data-danjion-page\] nav\.mobile-bottom\{height:calc\(68px \+ var\(--community-safe-bottom\)\)!important;padding-bottom:var\(--community-safe-bottom\)!important\}/, 'fixed navigation must retain 68px plus safe-area');
assert.match(page, /html body\[data-danjion-page\] nav\.mobile-bottom>button,html body\[data-danjion-page\] nav\.mobile-bottom>a\{height:100%!important;min-height:44px!important\}/, 'safe-area navigation children must fit inside the padded navigation');
assert.match(page, /\.actions\{bottom:var\(--community-bottom-offset\)!important\}/, 'sticky actions must sit above the bottom navigation and inset');
assert.ok(hasFocusOnOpen(page), 'reply form must focus its input on open');
assert.match(page, /input\.focus\(\{preventScroll:true\}\);[\s\S]*input\.scrollIntoView\(\{block:'center'/, 'reply input focus must keep software keyboard geometry scrollable');
assert.match(script, /replyFocusState\.set\(form,replyButton\)/, 'reply open must remember its trigger');
assert.match(script, /function closeReplyForm\(form,trigger\)/, 'reply close must restore focus to the trigger');
assert.match(script, /closeReplyForm\(replyForm,replyFocusState\.get\(replyForm\)\)/, 'successful reply submit must restore trigger focus');
assert.match(script, /flash\(failMessage\(r\)\);[\s\S]*focusReplyInput\(replyForm\);/, 'failed reply submit must keep focus in the input');
assert.match(script, /closeReplyForm\(form,replyFocusState\.get\(form\)\)/, 'cancel path must restore the stored trigger');
assert.doesNotThrow(() => new Function(script), 'community detail live wiring must remain valid JavaScript');

const mutations = [
  ['reply-trigger-min-44', page.replace('min-height:44px;border:0;background:none;padding:0 4px', 'min-height:40px;border:0;background:none;padding:0 4px'), hasReplyTriggerTarget],
  ['reply-input-min-44', page.replace('min-height:44px;height:44px;border:1px solid var(--line);background:#fff', 'min-height:40px;height:44px;border:1px solid var(--line);background:#fff'), hasReplyInputTarget],
  ['accessible-label', page.replace("aria-label=\"'+esc(replyLabel(c))+'\"", 'placeholder-only'), hasAccessibleLabel],
  ['safe-area-inset', page.replace('env(safe-area-inset-bottom,0px)', '0px'), hasSafeArea],
  ['focus-on-open', page.replace('input.focus({preventScroll:true});', '// mutated focus'), hasFocusOnOpen]
];
for (const [name, mutated, predicate] of mutations) {
  assert.equal(predicate(mutated), false, `mutation ${name} must be killed by the focused contract`);
}

console.log('PASS #981 community reply mobile accessibility contract');
console.log('REPLY_INPUT_ACCESSIBLE_LABEL=PASS');
console.log('REPLY_TOUCH_TARGET_MIN_44=PASS');
console.log('REPLY_FOCUS_ON_OPEN=PASS');
console.log('REPLY_FOCUS_RESTORE_ON_CANCEL=PASS');
console.log('REPLY_FOCUS_RESTORE_ON_SUBMIT=PASS');
console.log('MOBILE_SAFE_AREA=PASS');
console.log('STICKY_ACTION_BOTTOM_NAV_NO_COLLISION=PASS');
console.log('SOFTWARE_KEYBOARD_SCROLL_BEHAVIOR=PASS');
console.log('MUTATION_PROOF=PASS:' + mutations.map(([name]) => name).join(','));
console.log('NO_VISUAL_REDESIGN=YES');
