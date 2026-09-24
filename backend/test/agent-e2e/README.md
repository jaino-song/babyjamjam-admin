# Agent E2E suites

Two distinct E2E suites live under `test/agent-e2e/`, and they are partitioned
by database on purpose:

## `runtime/agent-task-*.e2e.spec.ts` — isolated conversation-task suite

These specs (`agent-task-action`, `agent-task-api`,
`agent-task-automation-*`, `agent-task-conversation*`, `agent-task-lifecycle`,
`agent-task-persistence`, …) read/write a real Postgres database directly.

They are guarded by
`test/agent-e2e/runtime/agent-task-persistence.helper.ts`, which refuses to
construct a Prisma client — or even validate `DATABASE_URL`/`DIRECT_URL` —
unless both are **exactly**:

```
postgresql://bjj_test@127.0.0.1:55433/bjj_conversation_test
```

Protocol `postgresql:`, host `127.0.0.1`, port `55433`, user `bjj_test`, no
password, no query string, no fragment. `DATABASE_URL` and `DIRECT_URL` must
match each other too. This guard is intentional and is never weakened: it
exists so nobody can accidentally point this suite at the shared dev
database. Because of it, a developer physically cannot run this suite against
anything but a disposable, local-only Postgres instance.

### Running it locally

This machine (and most dev machines) has no Docker, so the CI job's ephemeral
`conversation-postgres` service container isn't available locally. Instead,
run:

```sh
bash backend/scripts/agent/run-agent-task-e2e-local.sh
```

Extra arguments are forwarded to Jest (e.g. pass a `-t` pattern to run a
single test).

What it does:

1. Refuses to start if `127.0.0.1:55433` is already in use (the port is
   fixed by the guard above — there is no override).
2. Creates a throwaway Postgres data directory under a fresh `mktemp -d`
   temp dir, using Homebrew PostgreSQL's `initdb`/`pg_ctl`/`createdb`, bound
   only to `127.0.0.1:55433`.
3. Creates the `bjj_conversation_test` database owned by `bjj_test`.
4. Exports `DATABASE_URL`/`DIRECT_URL` pinned to the exact approved target
   above, and re-checks that literal value before every migrate/test
   invocation.
5. Exports the same CI job-level environment
   `.github/workflows/backend-ci.yml`'s `auth-e2e` job sets for this step
   (dummy JWT/HMAC secrets, `VALKEY_URL` pointing at a port nothing listens
   on locally, etc.) — no live service, no real credential.
6. Reads only the **key names** (never the values) declared in
   `backend/.env` and exports an **empty** value for every key it does not
   already own, so NestJS `ConfigModule`'s env-file fallback — which loads
   `backend/.env` and fills in any key not already set — can never
   backfill the shared dev database URL or a real vendor credential from
   that file into the process. (`backend/.env` in this worktree holds the
   shared remote database address and live vendor keys; this is the
   mechanism that keeps them out of reach.)
7. Runs `pnpm run db:migrate:deploy`, then runs exactly the suite CI runs:
   `pnpm run test:agent-e2e --testPathPatterns='test/agent-e2e/runtime/agent-task-.*\.e2e\.spec\.ts$'`
   with `AGENT_E2E=1`.
8. On exit — success, failure, `Ctrl-C`, or `TERM` — stops the throwaway
   Postgres (`pg_ctl ... stop -m fast`) and deletes the temp directory
   unconditionally.

Nothing this script touches is a suite database change, a package.json
change, or a CI/jest config change; it only orchestrates the existing
scripts against a disposable local database.

## `runtime/agent-runtime.e2e.spec.ts` — deterministic agent runtime suite

This suite needs Valkey (for its deterministic scheduling/lease behavior)
and a seeded auth fixture set up by `db:seed:auth-e2e`. Neither Valkey nor
that seed step exists in a plain local setup on this machine (no Docker), so
**this suite is CI-only** — see the `auth-e2e` job in
`.github/workflows/backend-ci.yml`, which runs it against the `postgres`,
`valkey`, and `mailpit` service containers before the isolated
conversation-task suite above runs against the separate
`conversation-postgres` service container. Do not try to run it locally with
the script above; it is intentionally out of scope for
`run-agent-task-e2e-local.sh`.
