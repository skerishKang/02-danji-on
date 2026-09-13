# DANJION OWNER / CENTRAL / LOCAL AGENT OPERATING POLICY — 2026-09-14

This is a standing operating rule for DanjiOn work. It is not a one-session note.

## Core rule

```text
USER_IS_NOT_AN_OPERATOR
CENTRAL_FIRST
LOCAL_AGENT_SECOND
OWNER_MANUAL_ACTION_LAST_RESORT
```

The Owner is the product/authority decision-maker, not the default terminal operator, CI operator, deploy operator, or GitHub button-clicker.

## Required execution order

For any routine operational step such as:

- GitHub Actions workflow dispatch
- deployment
- `gh` CLI commands
- branch / PR / CI inspection
- exact-head verification
- production readback
- smoke verification
- artifact / provenance inspection
- routine secret-name presence checks that do not expose values

the agent must use this order:

1. CENTRAL performs the action directly through available connected tools.
2. If CENTRAL lacks the exact action but a local/KILO/other authorized agent can do it, delegate a bounded command/task to that agent.
3. Only if neither CENTRAL nor an authorized agent/tool can perform the action may the Owner be asked to act manually.
4. When Owner action is truly required, explain exactly why it cannot be automated/delegated and request only the irreducible step.

## Prohibited default behavior

Do **not** tell the Owner to:

- click GitHub Actions buttons,
- run routine `gh` commands,
- copy ordinary deployment commands,
- check CI manually,
- fetch run IDs manually,
- redeploy manually,
- inspect routine logs manually,

when CENTRAL or an authorized local agent can do the same work.

Do not treat "the current connector cannot do workflow_dispatch" as sufficient reason to hand the task to the Owner. First check whether an authorized local agent / CLI path can do it.

## Owner-only / genuinely manual exceptions

Manual Owner action is appropriate only when an external service requires human-only interaction or credential authority that cannot be safely delegated, for example:

- interactive OAuth/provider console consent
- MFA / passkey / hardware-key confirmation
- billing/legal acceptance
- CAPTCHA
- entering a secret into a secure UI when no approved secret-preserving automation path exists
- explicit Owner policy approval for destructive/high-risk production changes

Even in these cases, CENTRAL should prepare everything else before asking.

## Production rule

A production mutation still requires the existing DanjiOn authority and safety gates. This policy does not weaken:

- fresh main read
- exact-head CI GREEN before merge
- no rebase / force push
- bounded production scope
- no secret disclosure
- no unauthorized DB / grant / Worker mutation
- explicit stop/report boundaries

It only changes **who performs routine mechanics**: use tools/agents first; do not offload routine operations onto the Owner.

## Handoff requirement

When CENTRAL delegates to a local/KILO agent, the task must include:

- repository
- expected main SHA
- exact allowed action
- explicit forbidden mutations
- success criteria
- final report schema

After the local agent reports, CENTRAL independently verifies the result through GitHub/runtime readback whenever possible.

## Short form

```text
DO_THE_WORK_WITH_TOOLS_OR_AGENTS_FIRST.
DO_NOT_USE_THE_OWNER_AS_A_TERMINAL.
ASK_THE_OWNER_ONLY_FOR_IRREDUCIBLE_HUMAN_AUTHORITY.
```
