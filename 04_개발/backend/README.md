# DanjiOn Backend — Cloudflare Worker API

Same-origin `/api` Worker over Neon PostgreSQL. This file documents the
canonical **local** install / check / test flow and its Windows-native
portability contract (#383). It does not change runtime, API, migration, or
auth behavior.

## Prerequisites (Windows-native, no WSL)

- **Node 24** and npm (Linux CI pins Node 24; local Node 22 also works).
- **Git for Windows** — provides Git Bash, the accepted native bash for the
  Postgres lifecycle helpers. The WSL launcher
  (`C:\Windows\System32\bash.exe`) is **not** a valid portability proof and is
  rejected by the helper below.
- **PostgreSQL 18 client** (`psql`) on `PATH` — only needed for the Postgres
  lifecycle scripts. The plain contract tests do not require a database.

## Deterministic install

Both `package-lock.json` files are tracked and already contain the Windows
`optionalDependencies` binaries (`@cloudflare/workerd-windows-64`,
`@esbuild/win32-*`). Install with `npm ci` from PowerShell/cmd:

```powershell
npm ci
```

`npm ci` on Windows resolves the platform-specific optional packages from the
lockfile, so workerd/esbuild native binaries install without network guessing.

## Canonical local checks (PowerShell/cmd)

These are the commands CI and local developers share. They launch only
`node`/`tsx`/`tsc`, so they run identically on Windows and Linux with no shell
shims:

```powershell
npm run typecheck
npm run check
```

`npm run check` chains every contract test through npm's own script runner
(`&&`), which npm executes via `cmd.exe` on Windows and `sh` on POSIX. No entry
in the `check`/`typecheck` chains invokes bash.

## Postgres lifecycle scripts

The `tests/*-postgres-lifecycle.sh` helpers are POSIX bash scripts and require
a **non-production scratch** database. Set `DATABASE_URL` to that scratch DB
(never production):

```powershell
$env:DATABASE_URL = "postgresql://postgres@127.0.0.1:5433/danjion_scratch"
```

- **POSIX / Linux CI:** run them directly, e.g.
  `bash tests/report-rb-postgres-lifecycle.sh`.
- **Windows-native:** run them through the portability shim, which resolves a
  real Git Bash and rejects the WSL launcher:

```powershell
node tests/run-postgres-lifecycle.mjs tests/business-application-photos-044-postgres-lifecycle.sh
```

The shim passes the script path as a forward-slash argument through `spawnSync`
argv (no shell string), so spaces and non-ASCII path segments are handled
without manual quoting. Set `DANJION_BASH` to override interpreter discovery.

> Note: `run-postgres-lifecycle.mjs` is a thin bash-discovery shim for local
> Windows runs, not a test runner framework. The four supported local
> lifecycle npm scripts route through this shim. The remaining lifecycle
> helpers are CI-only inventory entries and stay direct bash jobs.

## Known environment caveat (not Windows-specific)

`report-rb-postgres-lifecycle.sh` currently fails on PostgreSQL 18 at a
PL/pgSQL `variable_conflict` ambiguity (`category_id`), independent of client
OS. It is not part of `backend-ci.yml`. This is a database-version issue, not a
Windows portability defect, and is out of scope for #383.
