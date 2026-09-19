/**
 * #818 — static contract for the hardened Main integration audit in
 * .github/workflows/central-governance-gate.yml.
 *
 * Pins the bounded post-squash association grace, interpolation-safe incident
 * body, and the fact that the authorization verdict itself was NOT weakened:
 * exactly-one merged PR, head-equality, incident creation, trailing exit 1.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/central-governance-gate.yml', import.meta.url), 'utf8');

// --- bounded association grace (#818 defect a) --------------------------------
assert.match(workflow, /max_attempts=6/, 'grace must be bounded at 6 attempts');
assert.match(workflow, /grace_seconds=15/, 'grace interval must be 15s (<= ~75s wall time, never indefinite)');
assert.match(workflow, /while \[ "\$attempt" -lt "\$max_attempts" \]; do/, 'association probe must run inside the bounded loop');
assert.match(workflow, /if \[ "\$count" -ne 0 \]; then break; fi/,
  'retry is permitted ONLY while zero associations are visible; any non-zero count breaks immediately (no delay for normal pushes, no grace wasted on ambiguous count>=2)');

// --- verdict semantics: no fail-open ------------------------------------------
assert.match(workflow, /if \[ "\$count" -ne 1 \]; then/,
  'authorization still requires exactly one associated merged PR');
assert.match(workflow, /reason=associated_merged_pr_count_\$\{count\}\$\{reason_suffix\}/,
  'exhausted-zero grace must fail closed with an after_grace-distinguishable reason');
assert.match(workflow, /if \[ "\$count" -eq 0 \]; then reason_suffix='_after_grace'; fi/,
  'the after_grace suffix may only ever label count==0');
assert.match(workflow, /pulls='\[\]'/,
  'loop must start from an empty association set so API failures cannot fabricate an authorized verdict');
assert.match(workflow, /length' <<<"\$pulls" 2>\/dev\/null \|\| echo 0/,
  'a malformed association response must degrade to 0 and stay on the fail-closed path');

// --- incident body integrity (#818 defect b) ----------------------------------
assert.doesNotMatch(workflow, /<<EOF/, 'no unquoted heredoc may remain; backticks there are executed as command substitutions');
assert.match(workflow, /body="An integration into \\`main\\` did not satisfy the CENTRAL authorization contract\./,
  'incident body must be a fixed string build with escaped literal backticks');
assert.match(workflow, /\- main SHA: \\`\$\{MAIN_SHA\}\\`/, 'incident body must record the exact main SHA');
assert.match(workflow, /\- associated PR: \\`\$\{PR_NUMBER:-none\}\\`/, 'incident body must record the associated PR');
assert.match(workflow, /\- reason: \\`\$\{REASON:-unknown\}\\`/, 'incident body must record the fail-closed reason');

// --- authorization contract preserved bit-for-bit -----------------------------
assert.match(workflow, /grep -Fq 'CENTRAL_MERGE_AUTHORIZED=YES' <<<"\$pr_body"/, 'merged-PR marker requirement must remain');
assert.match(workflow, /reason=missing_central_merge_authorization/, 'missing-marker verdict must remain');
assert.match(workflow, /\[ "\$authorized_head" != "\$pr_head" \]/, 'head-equality verdict must remain');
assert.match(workflow, /reason=authorized_head_mismatch/, 'head-mismatch verdict must remain');
assert.match(workflow, /gh issue create --repo "\$REPO" --title "\$title" --body "\$body"/, 'genuine unauthorized integrations must still open an incident');
assert.match(workflow, /::error::CENTRAL_MAIN_INTEGRATION_AUDIT=FAIL reason=\$\{REASON:-unknown\}"\n\s*exit 1/,
  'unauthorized verdict must still exit 1 (never fail open)');
assert.match(workflow, /if: github\.event_name == 'push'/, 'main audit must keep running on every main push');

console.log('central-governance-main-audit-contract: PASS');
