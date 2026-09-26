// #1033: unsupported notification preferences must not render as enabled.
//
// Defect: `frontend/24_설정.html` shipped the three notification controls marked
// `data-setting-support="needs-backend"` in the initial markup as
//
//   class="toggle on"  aria-checked="true"
//
// for 우리단지 새 소식 / 댓글과 답글 / 1:1 메시지 받기.
//
// But the authoritative hydration only walks `supportedNotificationToggles()`,
// i.e. controls whose `data-setting-support === 'supported'`. The server
// therefore can *never* correct those three, so they stayed visually enabled
// while nothing was persisted — a control implying a real, saved preference
// that does not exist. One of them also said "끄면 새 메시지를 받을 수
// 없습니다.", which describes an actual configurable behaviour.
//
// This contract pins:
//   1. every `needs-backend` control starts neutral and read-only
//   2. no unsupported control claims aria-checked="true" or carries `.on`
//   3. no copy on an unsupported row implies persistence
//   4. the server-backed `service_notifications` control still hydrates from
//      server truth and is never caught by the neutralisation
//   5. re-introducing `class="toggle on"` on an unsupported control is caught
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
const settingsHtml = await read('24_설정.html');

// ---------------------------------------------------------------------------
// Parse the notification panel. The rows are flat, well-formed and rendered
// from one line, so a small button-level parse is enough and keeps the
// assertion on the shipped markup rather than on a browser.
// ---------------------------------------------------------------------------
const panelMatch = settingsHtml.match(/<article class="panel" id="notifications">([\s\S]*?)<\/article>/);
assert.ok(panelMatch, '24 must still ship the notifications panel');

const rows = [];
{
  const panel = panelMatch[1];
  // Split on the row opening tag. The final row closes with `</div></div>` before
  // `</article>`, so anchoring on the row start (not on a specific closing
  // sequence) keeps every row, including the last one.
  const rowStarts = [...panel.matchAll(/<div class="row">/g)];
  for (let i = 0; i < rowStarts.length; i++) {
    const from = rowStarts[i].index + rowStarts[i][0].length;
    const to = i + 1 < rowStarts.length ? rowStarts[i + 1].index : panel.length;
    const row = panel.slice(from, to);
    const support = (row.match(/data-setting-support="([^"]*)"/) || [])[1];
    if (!support) continue;
    const label = (row.match(/aria-label="([^"]*)"/) || [])[1] || '';
    const btnMatch = row.match(/<button[^>]*data-setting-support="[^"]*"[^>]*>/);
    assert.ok(btnMatch, 'notification control button must be present for ' + label);
    const btn = btnMatch[0];
    rows.push({
      label,
      support,
      button: btn,
      // class attribute token list, and whether `.on` is among them
      classAttr: (btn.match(/class="([^"]*)"/) || [])[1] || '',
      ariaChecked: (btn.match(/aria-checked="([^"]*)"/) || [])[1] ?? null,
      ariaDisabled: (btn.match(/aria-disabled="([^"]*)"/) || [])[1] ?? null,
      // the descriptive copy shown next to the control
      copy: (row.match(/<span class="row-copy">[\s\S]*?<span>([^<]*)<\/span>/) || [])[1] || '',
    });
  }
}

assert.ok(rows.length >= 4, 'expected the notification panel to expose its controls, got ' + rows.length);

const unsupported = rows.filter((r) => r.support === 'needs-backend');
const supported = rows.filter((r) => r.support === 'supported');

// ---------------------------------------------------------------------------
// 1. Every unsupported control starts neutral and read-only.
// ---------------------------------------------------------------------------
assert.equal(
  unsupported.length,
  3,
  'the three unsupported notification controls must still be present: ' +
    unsupported.map((r) => r.label).join(', '),
);

for (const row of unsupported) {
  assert.equal(
    row.ariaChecked,
    'false',
    `unsupported notification control "${row.label}" must not ship aria-checked="true"`,
  );
  assert.ok(
    !/(^|\s)on(\s|$)/.test(row.classAttr),
    `unsupported notification control "${row.label}" must not ship the .on class (got class="${row.classAttr}")`,
  );
  assert.equal(
    row.ariaDisabled,
    'true',
    `unsupported notification control "${row.label}" must ship read-only (aria-disabled="true")`,
  );
}

// ---------------------------------------------------------------------------
// 2. No copy on an unsupported row may imply a persisted preference.
// ---------------------------------------------------------------------------
for (const row of unsupported) {
  assert.doesNotMatch(
    row.copy,
    /끄면|끄면 새 메시지|저장되지|설정을 바꾸|변경하면/,
    `unsupported notification row "${row.label}" must not describe a configurable persisted preference (copy: "${row.copy}")`,
  );
  assert.doesNotMatch(
    row.copy,
    /새 메시지를 받을 수 없/,
    `unsupported notification row "${row.label}" must not imply turning it off changes delivery`,
  );
}

// ---------------------------------------------------------------------------
// 3. The server-backed control is untouched and still hydrates from truth.
//    It is the only one that may legitimately render as enabled initially, and
//    the authoritative path must still exist to correct it.
// ---------------------------------------------------------------------------
assert.equal(
  supported.length,
  1,
  'exactly one notification control should remain server-backed: ' + supported.map((r) => r.label).join(', '),
);
for (const row of supported) {
  assert.equal(
    row.ariaChecked,
    'true',
    `server-backed control "${row.label}" must keep its initial optimistic render for server hydration`,
  );
  assert.ok(
    /(^|\s)on(\s|$)/.test(row.classAttr),
    `server-backed control "${row.label}" must keep the .on class so hydration has a baseline to correct`,
  );
  assert.ok(
    /data-consent-type="service_notifications"/.test(row.button),
    `server-backed control "${row.label}" must keep its service_notifications consent type`,
  );
}

// The authoritative hydration path must still only drive the supported control.
assert.match(
  settingsHtml,
  /function supportedNotificationToggles\(\)\{\s*return notificationToggles\.filter\(function\(btn\)\{return btn\.dataset\.settingSupport==='supported';\}\);/,
  '24 must keep supportedNotificationToggles() filtering on data-setting-support',
);
assert.match(
  settingsHtml,
  /supportedNotificationToggles\(\)\.forEach\(function\(btn\)\{\s*applySwitch\(btn,notificationOn\);\s*btn\.removeAttribute\('aria-disabled'\);/,
  '24 must still hydrate the supported control from serviceNotifications.enabled',
);
assert.match(
  settingsHtml,
  /var notificationOn=pref\.enabled===true;/,
  '24 must still derive the notification truth from the server preference',
);

// Unsupported controls must remain read-only even after hydration runs.
assert.match(
  settingsHtml,
  /if\(btn\.dataset\.settingSupport!=='supported'\)\{\s*btn\.addEventListener\('click',function\(\)\{\s*if\(btn\.getAttribute\('aria-disabled'\)==='true'\)toast\('아직 서버에서 저장하지 못하는 알림 설정입니다\.'\);/,
  '24 must keep unsupported notification controls read-only with a truthful message',
);

// ---------------------------------------------------------------------------
// 4. #1024 retry recovery must be preserved: an unsupported control must never
//    re-enable itself through the retry path, and the supported one must still
//    be re-readable on retry.
// ---------------------------------------------------------------------------
assert.match(
  settingsHtml,
  /loadSettingsTruth\(\);/,
  '24 must keep the #1024 retry-on-truth-read-failure path',
);
assert.match(
  settingsHtml,
  /설정 상태를 불러오지 못했습니다\. 다시 눌러 재시도해 주세요\./,
  '24 must keep the truthful #1024 retry copy',
);
// The retry must not blanket-clear aria-disabled on every control; only the
// supported set is re-enabled by applyServerSettings.
assert.equal(
  /notificationToggles\.forEach\(function\(btn\)\{btn\.removeAttribute\('aria-disabled'\);\}/.test(settingsHtml),
  false,
  '24 must not clear aria-disabled on every notification control, or unsupported ones would become interactive',
);

// ---------------------------------------------------------------------------
// 5. Mutation proof: re-introducing the enabled render on an unsupported
//    control must be rejected by the same rules used above.
// ---------------------------------------------------------------------------
{
  const row = unsupported[0];
  const mutatedButton = row.button
    .replace('aria-checked="false"', 'aria-checked="true"')
    .replace('class="toggle"', 'class="toggle on"');
  const mutated = settingsHtml.replace(row.button, mutatedButton);
  assert.notEqual(mutated, settingsHtml, 'mutation must actually change the document');
  assert.match(mutated, /data-setting-support="needs-backend"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-setting-support="needs-backend"/, 'mutation: unsupported control re-enabled');

  // Re-parse the mutated document with the same parser and rules.
  const mutatedPanel = mutated.match(/<article class="panel" id="notifications">([\s\S]*?)<\/article>/)[1];
  const mutatedButtons = [...mutatedPanel.matchAll(/<button[^>]*data-setting-support="needs-backend"[^>]*>/g)].map((x) => x[0]);
  const target = mutatedButtons.find((b) => b === mutatedButton);
  assert.ok(target, 'mutation: the re-enabled unsupported control must be found');

  const mutatedClass = (target.match(/class="([^"]*)"/) || [])[1] || '';
  const mutatedAria = (target.match(/aria-checked="([^"]*)"/) || [])[1] ?? null;

  assert.equal(
    mutatedAria,
    'true',
    'mutation: unsupported control re-enabled aria-checked — the rule above must reject it',
  );
  assert.ok(
    /(^|\s)on(\s|$)/.test(mutatedClass),
    'mutation: unsupported control re-enabled the .on class — the rule above must reject it',
  );
}

console.log('leaf-1033-unsupported-notification-neutral-contract: PASS');
