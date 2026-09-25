// #1030: conversation notification toggles on 21 must fail closed when the
// external live wiring is unavailable.
//
// Defect: the first inline page block installed a *local* notification toggle
// handler that flipped the switch and claimed success with copy that looks
// persisted, even though nothing was saved server-side:
//
//   const on = button.classList.toggle('on');
//   button.setAttribute('aria-checked', String(on));
//   showToast(on ? '알림을 받습니다.' : '알림을 받지 않습니다.');
//
// The later authoritative wiring installs a capture listener that intercepts
// the same controls and truthfully says the setting is not stored on the
// server. So the bug is only user-visible when that external wiring is missing
// or fails to load — which is exactly the state this contract executes.
//
// This contract pins:
//   1. no local fake-success notification toggle survives in canonical page 21
//   2. clicking the controls with no external wiring changes nothing and says
//      nothing that implies a server write
//   3. the truthful "manage it in Settings" route is preserved
//   4. the #1025 send-authority containment is not regressed
//   5. re-inserting the legacy handler is caught (mutation proof)
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
const messageHtml = await read('21_메시지_대화상세.html');

const firstInlineScript = (() => {
  const match = messageHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, '21 must still ship its first inline block');
  return match[1];
})();

// The copy that must never be produced by a local, unsaved toggle.
const FAKE_SUCCESS = /알림을 받습니다|알림을 받지 않습니다/;
const TRUTHFUL_ROUTE = '알림 설정은 24 설정 화면에서 관리됩니다';

// The exact inline handler under test, and the exact legacy handler it replaced.
const CURRENT_HANDLER =
  "document.querySelectorAll('.toggle').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();" +
  "showToast('대화 알림 설정은 서버에 저장되지 않습니다. 알림 설정은 24 설정 화면에서 관리됩니다.')}));";
const LEGACY_HANDLER =
  "document.querySelectorAll('.toggle').forEach(button=>button.addEventListener('click',()=>{" +
  "const on=button.classList.toggle('on');button.setAttribute('aria-checked',String(on));" +
  "showToast(on?'알림을 받습니다.':'알림을 받지 않습니다.')}));";

// ---------------------------------------------------------------------------
// 1. Static: the legacy local fake-success toggle is gone from the page.
// ---------------------------------------------------------------------------
assert.doesNotMatch(
  messageHtml,
  FAKE_SUCCESS,
  '21 must not contain local notification fake-success copy anywhere in the document',
);
assert.doesNotMatch(
  firstInlineScript,
  /classList\.toggle\('on'\)/,
  '21 inline block must not flip a notification toggle locally without server authority',
);
assert.doesNotMatch(
  firstInlineScript,
  /setAttribute\('aria-checked'/,
  '21 inline block must not rewrite aria-checked locally without server authority',
);
assert.ok(
  firstInlineScript.includes(CURRENT_HANDLER),
  '21 inline block must keep the truthful fail-closed notification handler',
);

// The truthful routing must remain in *both* paths, so the guidance is the
// same whether or not the external wiring loaded.
assert.match(
  messageHtml,
  new RegExp(TRUTHFUL_ROUTE),
  '21 must keep the truthful "manage notifications in Settings" route message',
);
assert.ok(
  (messageHtml.match(new RegExp(TRUTHFUL_ROUTE, 'g')) || []).length >= 2,
  '21 must keep the truthful route message on both the inline fallback and the authoritative wiring',
);

// ---------------------------------------------------------------------------
// 2. Behavioural: run the real first inline block with every external
//    dependency absent (no DanjionSession, no messages bridge, no live wiring),
//    then click a conversation notification toggle.
//
//    Markup-stripping cannot observe this failure mode, so the real inline
//    code is executed against a DOM stub that faithfully records class and
//    attribute mutations.
// ---------------------------------------------------------------------------
const runInlineWithoutExternal = (source = firstInlineScript) => {
  const listeners = { input: [], submit: [], click: [] };

  // A node that actually records what a handler does to it, so a local flip
  // is observable rather than swallowed by a permissive stub.
  const makeNode = (classes = '') => {
    const classSet = new Set(classes.split(/\s+/).filter(Boolean));
    const attrs = {};
    return {
      classes: classSet,
      attrs,
      textContent: '',
      innerHTML: '',
      hidden: false,
      value: '',
      disabled: false,
      placeholder: '',
      dataset: {},
      classList: {
        add: (...c) => c.forEach((x) => classSet.add(x)),
        remove: (...c) => c.forEach((x) => classSet.delete(x)),
        toggle: (c, force) => {
          const on = force === undefined ? !classSet.has(c) : Boolean(force);
          if (on) classSet.add(c);
          else classSet.delete(c);
          return on;
        },
        contains: (c) => classSet.has(c),
      },
      setAttribute: (k, v) => {
        attrs[k] = String(v);
      },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      addEventListener: (t, f) => listeners[t] && listeners[t].push(f),
      dispatchEvent: (e) => {
        if (e && e.type === 'input') listeners.input.forEach((f) => f(e));
        if (e && e.type === 'click') listeners.click.forEach((f) => f(e));
        return true;
      },
      closest: () => null,
      querySelector: () => makeNode(),
      querySelectorAll: () => [],
      appendChild() {},
      insertAdjacentHTML() {},
      scrollIntoView() {},
      focus() {},
    };
  };

  // The canonical markup ships both conversation notification switches in the
  // "on" state, so "on" must not be treated as a change by itself.
  const conversationToggle = makeNode('toggle on');
  const incomingToggle = makeNode('toggle on');
  const toggleNodes = [conversationToggle, incomingToggle];

  const el = (extra = {}) => ({ ...makeNode(), ...extra });
  const send = { disabled: true };
  const reply = el({
    addEventListener: (t, f) => listeners[t] && listeners[t].push(f),
  });
  const form = el({ id: 'replyForm', addEventListener: (t, f) => listeners[t] && listeners[t].push(f) });

  const nodes = {
    '.toast': el(),
    '[data-more]': el(),
    '.more-menu': el(),
    '[data-action-title]': el(),
    '[data-action-copy]': el(),
    '[data-reasons]': el(),
    '[data-action]': el(),
    '[data-close]': el(),
    '.reason': el(),
    '[data-confirm]': el(),
    '.reply-context': el(),
    '#replyForm': form,
    '#reply': reply,
    '#count': el(),
    '.send': send,
    '#thread': el(),
    '.composer': el(),
    '[data-scroll-reply]': el(),
  };

  const documentStub = {
    querySelector: (sel) => nodes[sel] || null,
    // Only the notification switches answer `.toggle`.
    querySelectorAll: (sel) => (sel === '.toggle' ? toggleNodes : []),
    getElementById: (id) => nodes['#' + id] || null,
    createElement: () => makeNode(),
    addEventListener() {},
    body: { style: {} },
  };

  const sandbox = {
    document: documentStub,
    location: { search: '', href: '' },
    window: {},
    globalThis: undefined,
    console,
    setTimeout: () => 0,
    clearTimeout: () => {},
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
  };
  sandbox.globalThis = sandbox;

  new Function(
    'document',
    'location',
    'globalThis',
    'window',
    'setTimeout',
    'clearTimeout',
    'Event',
    source,
  )(
    sandbox.document,
    sandbox.location,
    sandbox,
    sandbox.window,
    sandbox.setTimeout,
    sandbox.clearTimeout,
    sandbox.Event,
  );

  // The user clicks a conversation notification toggle.
  listeners.click.forEach((f) =>
    f({
      type: 'click',
      target: conversationToggle,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    }),
  );

  return {
    ariaCheckedAfterClick: conversationToggle.attrs['aria-checked'] ?? null,
    stillHasOnClass: conversationToggle.classes.has('on'),
    toastText: nodes['.toast'].textContent,
    // #1025 regression, observed in the same execution.
    sendEnabledAfterTyping: (() => {
      reply.value = '테스트 답장';
      listeners.input.forEach((f) => f(new sandbox.Event('input')));
      return send.disabled === false;
    })(),
  };
};

const noWiring = runInlineWithoutExternal();

// (a) The switch state must not flip locally.
assert.equal(
  noWiring.ariaCheckedAfterClick,
  null,
  '21 must not rewrite aria-checked when the external live wiring is unavailable',
);
assert.equal(
  noWiring.stillHasOnClass,
  true,
  '21 must not remove the existing toggle class locally without server authority',
);

// (b) No copy that implies a persisted server write.
assert.doesNotMatch(
  noWiring.toastText,
  FAKE_SUCCESS,
  '21 must not claim a notification setting was saved when no server authority exists',
);

// (c) If anything is shown, it must be the truthful route to Settings.
if (noWiring.toastText) {
  assert.ok(
    noWiring.toastText.includes(TRUTHFUL_ROUTE),
    '21 fallback notification message must route the user to Settings truthfully, got: ' + noWiring.toastText,
  );
}

// (d) #1025 send-authority regression, in this same wiring-less state.
assert.equal(
  noWiring.sendEnabledAfterTyping,
  false,
  '#1025 regression: typing must not enable .send without server authority',
);

// ---------------------------------------------------------------------------
// 3. The authoritative capture listener is still present and still truthful.
// ---------------------------------------------------------------------------
assert.match(
  messageHtml,
  /\.toggle'[\s\S]{0,200}addEventListener\('click',function\(ev\)[\s\S]{0,200}stopImmediatePropagation\(\)/,
  '21 authoritative wiring must keep intercepting notification clicks',
);
assert.match(
  messageHtml,
  new RegExp(TRUTHFUL_ROUTE),
  '21 authoritative wiring must keep the truthful Settings route message',
);

// ---------------------------------------------------------------------------
// 4. Mutation proof: re-inserting the legacy local handler must be caught by
//    the very same behavioural harness that passed above.
// ---------------------------------------------------------------------------
{
  const mutatedInline = firstInlineScript.replace(CURRENT_HANDLER, LEGACY_HANDLER);
  assert.notEqual(mutatedInline, firstInlineScript, 'mutation must actually change the inline block');
  assert.match(mutatedInline, FAKE_SUCCESS, 'mutation: legacy local toggle handler re-inserted');

  const runMutated = runInlineWithoutExternal(mutatedInline);

  // The mutation must break rule (a): aria-checked gets rewritten locally.
  assert.equal(
    runMutated.ariaCheckedAfterClick,
    'false',
    'mutation: legacy handler flips aria-checked locally without server authority — the contract above must reject it',
  );
  // ...and rule (b): the fake-success copy appears.
  assert.match(
    runMutated.toastText,
    FAKE_SUCCESS,
    'mutation: legacy handler emits unsaved-success copy — the contract above must reject it',
  );
  // ...and the switch visibly changes state.
  assert.equal(
    runMutated.stillHasOnClass,
    false,
    'mutation: legacy handler removes the .on class locally — the contract above must reject it',
  );
}

console.log('leaf-1030-notification-toggle-authority-contract: PASS');
