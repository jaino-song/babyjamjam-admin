# State-integrity tests (real PostgreSQL)

Executable integrity tests for five state areas against a real, throwaway
PostgreSQL: **clients**, **employees**, **SMS messages**
(`message_trigger_job` / `message_log` / rules), **contracts**
(`eformsign_doc` and its jobs), and **user accounts** (`user`, `user_branch`,
`auth_session`, `auth_refresh_token`).

The specs run against real SQL — CHECK constraints, partial indexes, FK
actions (`Restrict`/`NoAction`) — because most of the invariants these tests
protect live in the database, not in TypeScript. They build on the existing
real-DB convention in `backend/test/prisma/*.real-db.spec.ts` (same throwaway
guard, same service-over-`PrismaService` construction).

## Folder layout

```
backend/test/integrity/
├── harness.real-db.spec.ts   smoke spec: factories + tracker + guard end to end
├── README.md                 this file
├── helpers/
│   ├── real-db.ts            describeReal gate + throwaway guard + createIntegrityPrisma
│   ├── factories.ts          minimal-valid-default row factories (tracker-registered)
│   ├── tracker.ts            RowTracker: FK-safe cleanup (app-row sweep + fixed model rank, leaked reporting)
│   ├── known-defect.ts       knownDefect / invariant id-prefixed test wrappers
│   └── known-defect.spec.ts  pure unit tests for the knownDefect expectedFailure guard
└── <area>/*.real-db.spec.ts  one folder per area: clients | employees | sms | contracts | users
```

Spec files end in `.real-db.spec.ts` so the default jest `testMatch` picks them
up (they skip themselves without the env flag — the unit suite stays hermetic)
while making their real-database nature obvious in test listings.

## Running

`scripts/run-state-integrity.mjs` (npm script `test:integrity`) owns the whole
lifecycle: drop → create `bjj_state_integrity_throwaway` → `prisma migrate
deploy` (migrations, NOT `db push`: the tests need the SQL-only CHECKs and
partial indexes only migrations create) → jest `test/integrity` in-band → drop.

```bash
cd backend
pnpm run test:integrity                                  # all areas
node scripts/run-state-integrity.mjs test/integrity/clients   # one area (args forwarded to jest)
node scripts/run-state-integrity.mjs -t SI-CLIENT        # flag-only args still run only test/integrity
```

Flag-only invocations (no positional path argument) still run ONLY
`test/integrity`: the runner appends the default path to whatever flags you
forward, so `-t <pattern>` can never leak into the wider unit or e2e suites.
The jest config's own `testPathIgnorePatterns` (node_modules, dist, e2e) stays
in charge — the runner never overrides it.

Environment variables, by NAME only (the runner sets them; do not paste values):

- `STATE_INTEGRITY_REAL_DB=1` — arms `describeReal`; without it every real-DB
  describe is skipped and only pure unit tests (like the guard test) run.
- `NODE_ENV=test`, `E2E_VENDOR_STUBS=1` — same test runtime as the e2e runner.
- `DATABASE_URL` / `DIRECT_URL` — set by the runner to the throwaway database.
  They must be identical and the database name must contain `throwaway`;
  `assertThrowawayTarget()` refuses anything else. The guard is called inside
  `beforeAll`, never at import time: the unit suite imports every spec with no
  database available.
- `PGUSER` — local PostgreSQL role for `createdb`/`dropdb` (defaults to
  `postgres`). Host is `localhost`.
- `PGPORT` — local PostgreSQL port (defaults to `5432`); used consistently for
  `DATABASE_URL`, `createdb` and `dropdb`.

Requires a local PostgreSQL that accepts
`postgresql://postgres@localhost:5432/<db>` with no password. Never point these
specs at a real database.

## Writing a spec

```ts
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, assertThrowawayTarget } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { createBranch, createClient } from "../helpers/factories";
import { invariant, knownDefect } from "../helpers/known-defect";

describeReal("client phone identity (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    invariant("SI-CLIENT-01", "two clients in one branch cannot share a normalized phone", async () => {
        const branchRow = await createBranch(handle.raw, tracker);
        await createClient(handle.raw, tracker, { branchId: branchRow.id, phoneNormalized: "01012345678" });
        await expect(
            createClient(handle.raw, tracker, { branchId: branchRow.id, phoneNormalized: "01012345678" }),
        ).rejects.toThrow();
    });
});
```

Rules:

- Every database touch sits inside `describeReal` + `beforeAll`. No Prisma
  client is constructed at import time.
- Create rows only through `helpers/factories.ts` (extend it when a factory is
  missing). Factories register every created row in your `RowTracker`.
- **Cleanup is rank-based, not registration-based.** `tracker.cleanup(raw)`
  deletes tracked rows by a fixed FK-safe model rank derived from
  `prisma/schema.prisma` (children before parents; reverse registration order
  only breaks ties within one model), so a foreign key set AFTER registration
  — e.g. `branch.update({ ownerId })` or re-pointing
  `employee_schedule.primary_employee_id` — is still deleted safely.
  `cleanup` does not throw when a test already deleted a row itself.
- **App-created rows are swept.** A service under test can create rows in
  models the factories don't cover; before the ranked deletes, cleanup deletes
  untracked child rows referencing tracked parents in: `eformsign_doc_file`,
  `client_draft`, `call_record`, `end_date_review_item`,
  `schedule_change_request`, `service_record_assignment`, `service_record_day`,
  `service_record`, `service_record_revision_document_state`,
  `service_record_edit_draft`, `service_record_day_edit_log`,
  `service_record_case`, `eformsign_document_job`,
  `eformsign_dispatch_intent`, `notification`, and app-created `message_log` /
  `message_trigger_job` rows (by tracked `branchId`/`clientId`).
  `admin_audit_event` is deliberately NOT swept: it has no FK constraints
  (nothing can be kept alive through it) and an append-only trigger blocks its
  DELETE.
- **Append-only tables and the `leaked` list.** `service_record_revision` is
  append-only by trigger (migration `20260908000000…` blocks UPDATE/DELETE), so
  cleanup never tries to delete it — and any parent it pins (`branch` via
  `branch_id`, `service_record_case` via the composite FK) can then not be
  deleted either. Such parents are NOT a failure: `cleanup` returns
  `{ deleted, leaked }`, `console.warn`s the leaked rows, and does not throw
  for them — the runner drops the whole throwaway database afterwards. Every
  OTHER deletion error is thrown as one `AggregateError` after all remaining
  deletes ran (one failing delete never aborts the rest, and `rows` is always
  cleared). Revision-adjacent rows WITHOUT an append-only trigger are swept
  like any other app row: `service_record_revision_document_state` (NoAction
  `branch_id`/`client_id`), `service_record_edit_draft`, and
  `service_record_day_edit_log` (NoAction case FKs) all allow DELETE — only
  `edit_draft` UPDATE is trigger-guarded — so none of them can keep a tracked
  client, branch, or swept case alive. `service_record_snapshot_chunk` is
  deliberately NOT swept: a chunk bound to a revision (`revision_id` is
  NoAction) can never be deleted while that revision is append-only, so
  sweeping it would turn the revision's intentional leak into a thrown
  `AggregateError` — and the NoAction parent such a chunk shares with the
  revision (`branch`) is already leaked by that revision.
- Do not invent column values. Derive required fields from
  `prisma/schema.prisma`; when a column has a CHECK constraint
  (`prisma/migrations/**/migration.sql`, e.g. `client_service_status_allowed`,
  `provider_acceptance_state`, `sync_status`) or an application vocabulary, use
  a value the application itself writes. The factories already do this.

## Test ids and the knownDefect lifecycle

Every test name is prefixed with an id `SI-<AREA>-<NN>` — e.g. `SI-CLIENT-01`,
`SI-SMS-03` — via the two wrappers in `helpers/known-defect.ts`:

- `invariant(id, title, fn)` — a plain `it`: an invariant that holds today and
  must keep holding.
- `knownDefect(id, title, fn, expectedFailure?)` — wraps `it.failing`
  (Jest 30). The test states the CORRECT invariant. While the defect exists the
  test fails and `it.failing` keeps the suite green (an expected failure
  passes). When a later fix lands, the test starts passing, `it.failing` turns
  red, and the fix unit must flip the call to a plain `invariant` — same body,
  now asserted to hold.
- **Always pass `expectedFailure` in phase-2 specs.** Plain `it.failing` turns
  ANY error green, including setup and infra failures that have nothing to do
  with the tracked defect. The optional `expectedFailure` argument (a `RegExp`
  tested against the error message, or a plain substring) closes that
  false-pass hole: a failure matching it is rethrown (suite stays green), while
  a failure for any OTHER reason — or a body that passes — returns normally,
  which `it.failing` counts as an unexpected pass and reports RED, after
  `console.error` names the mismatched error. `helpers/known-defect.spec.ts`
  proves all three outcomes.

Area codes: `CLIENTS`→`CLIENT`, `EMPLOYEES`→`EMPLOYEE`, `SMS`, `CONTRACTS`,
`USERS`. Number sequentially within an area (`SI-CLIENT-01`, `SI-CLIENT-02`, ...).
