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
│   ├── tracker.ts            RowTracker: FK-safe cleanup (children before parents)
│   └── known-defect.ts       knownDefect / invariant id-prefixed test wrappers
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
```

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

Requires a local PostgreSQL that accepts `postgresql://postgres@localhost:5432/<db>`
with no password. Never point these specs at a real database.

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
  missing). Factories register every created row in your `RowTracker`; create
  parents before children — cleanup deletes in reverse registration order, so
  rows referenced by `Restrict`/`NoAction` foreign keys disappear first.
  `cleanup` does not throw when a test already deleted a row itself.
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
- `knownDefect(id, title, fn)` — wraps `it.failing` (Jest 30). The test states
  the CORRECT invariant. While the defect exists the test fails and `it.failing`
  keeps the suite green (an expected failure passes). When a later fix lands,
  the test starts passing, `it.failing` turns red, and the fix unit must flip
  the call to a plain `invariant` — same body, now asserted to hold.

Area codes: `CLIENTS`→`CLIENT`, `EMPLOYEES`→`EMPLOYEE`, `SMS`, `CONTRACTS`,
`USERS`. Number sequentially within an area (`SI-CLIENT-01`, `SI-CLIENT-02`, ...).
