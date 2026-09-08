# Phase 3.1 integration verification

This report records the deterministic mobile verification run on the integrated
Phase 2 baseline plus the integrated audit corrections. The Playwright config in
`mobile/phase3-e2e.config.mjs` uses port 4317, a test-only JWT-shaped storage
state, browser API fixtures, and an explicit HTTP-loopback-only `BASE_URL`
guard. It does not change the application's auth policy or write to the
backend.

## Matrix evidence

1. **Client period confirmation** — the fixture selected duration 15 and dates
   2026-09-03 through 2026-09-08. Cancel closed the confirmation without a
   POST and preserved both dates. Changing the end date to 2026-09-09 reopened
   confirmation; two confirm clicks produced one POST with duration 15 and
   `allowBusinessDayMismatch: true`. The edit hydration case preserved the
   saved period and kept a manually cleared end date blank after a deferred
   e-form response containing a real non-empty end date. The pre-fix run
   reproduced the bug by restoring `2026-10-02`; the integrated fix then passed
   the same handshake. Cached client/e-form first-render coverage also preserves
   the latest real Zustand dates instead of replacing saved values with stale
   document values. Native Chrome separately verified the cancel, changed-end,
   voucher-preservation, and keyboard clear/blur path; it did not submit a
   client mutation.
2. **Employee selection** — reopening the autocomplete retained the selected
   employee id/label while allowing the known focus-plus-click refresh pattern;
   the fixture bounded the refresh count.
3. **Edit hydration** — the fixture normalized a six-digit birthday and
   document date while leaving due/start/end fields unchanged. The deferred
   response could not overwrite a user-cleared end date after the correction.
4. **Receipt/PDF contract** — the existing contracts row test now uses the
   receipt-PNG URL (`format=receipt-png`), `image/png`, and a `.png` download
   name; the ordinary document remains an `application/pdf` `.pdf`. The test
   fetched PNG signature bytes and PDF `%PDF-` bytes, verified the share file
   name/MIME, and verified preview anchors. Existing `receipt-share` unit tests
   cover unsupported-share fallback, browser download wiring, and
   user-cancelled share. Native Chrome showed the finalized document's receipt
   link and PDF preview; Chrome's download policy prevented confirming a saved
   filename, and no native share/SMS action was claimed.
5. **Query retry observations** — the browser fixture recorded exact transport
   totals of `401=2`, `403=1`, `network=4`, and resolved `5xx=2`. The 401 pair
   includes the existing auth-refresh replay. The repository's query-client
   and API-client tests are the policy proof for zero 401/403 query retries and
   one network/5xx retry; browser totals are reported as observed transport
   evidence, not substituted for those unit assertions.
6. **Error handling** — duplicate-phone `P2002` returned the localized safe
   message. The integrated client-route correction suppresses unsafe non-Prisma
   HTTP 409 fields (Bearer, SQL, and stack details) in its route contract tests.
   The completed SQL grammar rejects single-column projections, projection lists,
   quoted identifiers, function projections such as `COUNT(*)`, and terminated
   `SELECT ... FROM ...` diagnostics while preserving ordinary validation
   near-misses. An unsafe 500 fixture exposed none of those details in the UI.
7. **Messages** — loading rendered the separate upcoming/past skeleton sets;
   an upcoming zero state kept both headers and rendered the empty message;
   a partial upcoming failure marked unavailable counts while preserving the
   past count and card.

The service-record UI fixture supplied `totalSessions: 4` and rendered exactly
four slots (no fifth slot). The integrated backend service-record regression at
`backend/test/services/service-record-entry.service.spec.ts` remains the
business-day/helper evidence for a four-session record; the Playwright fixture
is intentionally synthetic and read-only.

The integrated source corrections are `f1f195b02` (preserve a cleared service
end date during late hydration), `ec62a3b05` (sanitize unsafe client conflict
payloads), `ea2c8874f` (preserve latest real client/e-form dates on first render),
`d50cb7c9f` (redact SQL conflict diagnostics), and `788d7ede3` (complete the SQL
projection grammar, including single-column and `COUNT(*)` forms). The
verification unit owns only the test/config/report changes.

The correction evidence includes the local deferred-hydration red reproduction
and its green rerun (`phase3-hydration-red.log` and
`phase3-hydration-green.log`). The first-render correction's owning unit run
covered 32 suites/168 tests after proving that stale e-form values could replace
saved dates. The initial SQL red case still allowed `SELECT phone FROM Client`
and `SELECT COUNT(*) FROM Client`; the completed grammar correction's focused
error suite covered 64 passing tests, and the integrated run below passed the
full suite.

## Native Chrome evidence supplied by the integration run

- `/messages/history` at measured 375×812 had no horizontal overflow; the
  all/upcoming/past counts were 69/0/69, and selecting upcoming zero rendered
  zero cards plus the empty-state copy.
- The finalized existing contract rendered nine PDF canvases and exposed the
  receipt-PNG link at the restored normal Chrome viewport (measured 2133 CSS
  px). The actual saved download name was not inspected because Chrome blocked
  the downloads page.
- Safari/iOS native hardware was not available; no native Web Share or SMS
  delivery result is represented here.

## Verification commands

All commands below exited 0. Logs are kept outside the worktree at
`/tmp/mobile-parity-phase3-artifacts/`.

- `pnpm --dir mobile exec jest --runInBand` — 216 suites, 1337 tests, 0
  snapshots (`mobile-jest-final6.log`).
- `pnpm lint:ui-architecture` — baseline matches current state; frontend
  23/4/31/536 and mobile 18/5/101/147 debt totals
  (`root-ui-architecture-final7.log`; the five unchanged shifted findings were
  re-anchored in `root-ui-architecture-reanchor-final.log`).
- `pnpm --dir mobile lint` — 0 errors, 407 warnings
  (`mobile-lint-final6.log`).
- `pnpm --dir mobile type-check` — pass (`mobile-typecheck-final6.log`).
- `pnpm lint:e2e-strings` — 9 changed phrases, none still asserted
  (`root-e2e-strings-final6.log`).
- `PHASE3_TEST_MATCH='phase3-*.spec.ts' pnpm exec playwright test
  --config=phase3-e2e.config.mjs` — 8 tests passed in 20.7s
  (`phase3-playwright-final6.log`).
- `PHASE3_TEST_MATCH='contracts-mobile-list-row.spec.ts' pnpm exec playwright
  test --config=phase3-e2e.config.mjs --grep='shows the PDF preview below
  contract actions'` — 1 test passed (`contracts-receipt-final6.log`).
- The strengthened hydration case passed after the source correction
  (`phase3-hydration-green.log`); its pre-fix red reproduction is preserved in
  `phase3-hydration-red.log`.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --dir mobile build` —
  pass (`mobile-build-final6.log`).

## PR647 review-fix integration

The final integrated source for the five review fixes is
`2d73c7bdd2dac3fe39e5857d41ec0dcf4b1a8c3f`. The P1 SQL recognizer follow-up
was included after a focused audit found that an aliased relation with a
`WHERE` clause could still expose a diagnostic. The source-sensitive reruns
for that final commit are recorded under `/tmp/mobile-pr647-review-fixes/`:

- `pnpm --dir mobile exec jest --runInBand` — 216 suites, 1,363 tests, 0
  snapshots (`mobile-jest-final.log`).
- `pnpm --filter ./mobile run type-check` — pass
  (`mobile-typecheck-final.log`).
- `pnpm --filter ./mobile run lint` — 0 errors, 407 warnings
  (`mobile-lint-final.log`).
- `NEXT_PUBLIC_API_BASE_URL=https://ci-build.invalid pnpm --filter ./mobile
  run build` — pass; static generation logs the expected DNS failure for the
  placeholder backend and completes successfully (`mobile-build-final.log`).
- `PHASE3_TEST_MATCH='phase3-integration.spec.ts' pnpm exec playwright test
  --config=phase3-e2e.config.mjs --grep='shows localized duplicate-phone
  validation and hides unsafe server details'` — 1 test passed
  (`phase3-error-browser-final.log`).

The following deterministic evidence was captured at the immediately
preceding integrated source `c1efe3083e11098ae593bafd972455841d455bb1` and is
unchanged by the P1-only error-recognizer correction: the cookie-host,
server-port, and shared-auth-path Node regressions passed 17/17
(`phase3-node-regressions.log`); the synthetic Phase 3 matrix passed 9/9,
including the new fixture-routing test and receipt/PDF matrix
(`phase3-playwright.log`); the standalone receipt contract passed 1/1
(`receipt-playwright.log`); and the standalone fixture-routing test passed
1/1 (`new-fixture-playwright.log`).
