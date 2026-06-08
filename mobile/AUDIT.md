# SaaS-Readiness Audit — `babyjamjam-admin` (mobile)

- **Date:** 2026-06-03
- **App:** `mobile/` (Next.js 16.1.6 · React 19 · TypeScript strict) — multi-tenant SaaS admin
- **Branch:** `feature/mobile-dashboard-redesign`
- **Method:** parallel read-only scouts across 6 dimensions + hard-metric scans, every load-bearing claim verified against source before inclusion.

---

## Verdict

A **solid foundation with genuinely good security fundamentals** (httpOnly cookie tokens, server-side OAuth code exchange, JWT-embedded `branchId` enforced in `middleware.ts` with tests, token-refresh race handling). The weakness is **consistency**: the same operation is done 3–4 different ways across the proxy layer, validation, error handling, and i18n.

The through-line is **convention-by-example, not convention-by-enforcement.** Shared utilities exist but adoption sits at ~20–25%, and nothing mechanically prevents drift — there was no CI, no `type-check` script, and the one custom lint rule is `warn`. The recent "harden proxies / tenant attribution" effort is the right instinct and is actively in progress.

---

## Tier 1 — Critical

### 1. Dead dashboard components rendered hardcoded MOCK data  ✅ FIXED (this pass)
`PendingClientsTable`, `TodayScheduleList`, `ServiceDistributionChart` imported fabricated data from `@/mocks/dashboard`. They were **superseded by `components/app/mobile-redesign/DashboardRedesign`** and imported nowhere — dead code carrying a mock-data import. Deleted along with the now-orphaned `src/mocks/dashboard.ts`. (No real endpoint exists for pending-clients / today-schedules / monthly-comparison; `useDashboardAnalytics` returns aggregate counts only.)

### 2. No input validation at server trust boundaries
`zod` is imported in **1 file** (`src/lib/validations/auth.ts`) and used **only for client-side form validation** (`register`/`login`/`forgot-password`/`reset-password` pages). On the server, **22 / 91 API routes call `request.json()` with no schema validation** and forward the raw body upstream — including the eformsign webhook (`api/eformsign-docs/events`) and `api/ai/chat/stream`. Client-side zod is trivially bypassed; the server boundary is unguarded.
**Standard:** validate every route body/param/query + every webhook + env with zod `safeParse` at entry.

### 3. Proxy-layer hardening only ~24% rolled out
`src/lib/api/route-utils.ts` provides the right helpers, but across 91 routes:

| Shared standard | Adopted | Gap |
|---|---|---|
| `backendJsonResponse()` (preserve upstream status) | 22 / 91 | ~69 can collapse 4xx/5xx → 200 |
| `readJsonObjectBody()` (safe parse) | 17 / 91 | rest throw on bad JSON |
| shared `getAuthToken` / `getAuthHeaders` | — | 15 routes redefine locally |
| raw `fetch()` instead of `serverAPIClient` | — | 23 `fetch()` call-sites (`ai/chat/*`) |

Error-response shape also varies (`.data?.error` vs `.data?.message` vs `axiosError.message`).
**Standard:** every plain-JSON proxy route = thin wrapper of {`getAuthToken` → `serverAPIClient` + `getAuthHeaders` → `readJsonObjectBody` → `backendJsonResponse` → `errorResponse`}; gold reference: `api/clients/route.ts`, `api/employees/route.ts`. (Streaming/multipart/auth-cookie routes keep their transport but standardize error handling.)

### 4. Zero error boundaries + zero observability
**0** `error.tsx` / `global-error.tsx` / `not-found.tsx` across **41 pages** → any render throw = white screen. No Sentry / structured logger; **169 `console.*` calls** (63 in API routes) are the only "logging," some leaking system internals (`api/auth/token/route.ts` logs backend URL + env on error).
**Standard:** `global-error.tsx` + `not-found.tsx` + per-segment `error.tsx`; one logger + error-monitoring service; ban `console.*` in prod paths via lint.

---

## Tier 2 — High

### 5. Tenant attribution still partly client-supplied
`api/file-storage/files/route.ts` accepts `orgId` / `uploadedBy` from client form-data; most routes correctly rely on the JWT `branchId`. The "derive upload attribution from tenant" commit targets this — **verify it's complete for every write path.** `selected_branch_id` is also set `httpOnly:false` (unnecessary XSS surface; not read anywhere).
**Standard:** tenant/branch is **always** server-derived from the JWT; never trust a client-supplied org/branch field.

### 6. Cookie + logout inconsistencies
`sameSite:"none"` in prod at `api/auth/token/route.ts:63,71` (commented intentional for OAuth) vs `"lax"` at the 4 other cookie-setting sites. Token exchange is same-site, so `none` is likely unnecessary — at minimum undocumented divergence. `select-branch/page.tsx` logs out via `document.cookie` only, **skipping** the server `/auth/logout` revocation that `logout/actions.ts` performs.
**Standard:** one cookie policy; one server-side logout path.

### 7. Four competing data-fetching paradigms
react-query (primary), `useEffect`+`useState`+axios, raw `fetch()` for SSE, and **server cache duplicated into zustand** (`template-store.ts` holds `templates` + `isLoading` react-query already owns). Query-key factories exist in 8 hooks but `useEformsignDocuments`/`usePushNotification` invalidate with hardcoded arrays; `staleTime` has 7+ ad-hoc values.
**Standard:** react-query owns all server cache (key factories everywhere + a 3-tier `staleTime` constant); zustand = UI/form state only; custom hooks only for streaming.

### 8. ~200+ hardcoded strings despite i18n infra
`next-intl` + `src/texts` + `src/lib/i18n` exist, yet user copy is hardcoded throughout (`select-branch`, `prices`, `clients/new`, `messages/new`, `chat`…), and `t()` falls back to the raw key — so `en` users see Korean or bare keys.
**Standard:** no string literals in JSX; enforce ko/en parity.

---

## Tier 3 — Medium (the enforcement vacuum)

### 9. Quality gates  ✅ PARTLY FIXED (this pass)
- **CI** — none existed. Added `.github/workflows/mobile-ci.yml` (pnpm-monorepo-aware: type-check · lint · jest, path-filtered to `mobile/**`).
- **`type-check` script** — none existed. Added `"type-check": "tsc --noEmit"` to `mobile/package.json`; now wired into CI.
- **`data-component` rule = `warn`, scoped to `src/app` only** — `components/app`'s ~430 annotations are unenforced. Flipping to `error` requires backfilling ~31 unannotated `src/app` files first (otherwise it breaks CI immediately). Sequenced as a follow-up.
- **No Prettier** — formatting by convention.

### 10. No centralized/validated config
27 scattered `process.env.*` reads; backend-host resolution duplicated in `lib/api/client.ts` + `services/api.ts`, both falling back to a hardcoded `"http://localhost:3001"`. No `.env.example`. (Build artifacts *are* correctly gitignored — `tsconfig.tsbuildinfo` untracked.)
**Standard:** one `src/lib/env.ts` with a zod-validated `env` object + `.env.example`.

### 11. Type drift (minor)
Mock `Client`/`Employee` types in `src/mocks/mock-data.ts` diverge from canonical `features/*/types`. Type escapes are genuinely low: **3** `any`, **2** `@ts-expect-error` (tests), **6** `eslint-disable`, **2** TODOs.

---

## Standardization Charter

| Domain | The one standard | Enforced by |
|---|---|---|
| Proxy routes | thin wrapper: auth-forward → `serverAPIClient` → `backendJsonResponse` → `errorResponse`; no local helpers, no raw `fetch` for plain JSON | finish migration + lint |
| Validation | zod `safeParse` at every server boundary (body/params/webhooks/env) | code review + CI |
| Tenancy | branch/tenant always JWT-derived server-side | audit every write path |
| Errors | per-segment `error.tsx` + global-error + monitoring + one logger; no `console.*` in prod | `error.tsx` files + `no-console` lint |
| Data | react-query owns server cache (key factories + tiered `staleTime`); zustand = UI only | ESLint + `ARCHITECTURE.md` |
| i18n | all copy via `next-intl`; ko/en parity | lint rule (no JSX literals) |
| Config | single validated `env` module + `.env.example` | startup validation |
| Gates | `type-check` + lint + test on every PR | GitHub Actions ✅ |

---

## What's genuinely good (don't regress)
httpOnly cookie tokens · server-side OAuth code exchange · JWT `branchId` enforced in `middleware.ts` with `__tests__/middleware.test.ts` (403 path) · token-refresh dedup/queue in `lib/api/client.ts` · query-key factories in 8 hooks · the `features/*/types` canonical-type pattern · very low `any` count · 303 passing unit tests.

---

## Remediation log

| # | Item | Status |
|---|---|---|
| 1 | Delete dead mock-rendering dashboard components + orphaned `mocks/dashboard.ts` | ✅ done |
| 9 | Add `type-check` script + pnpm-aware CI (type-check · lint · test) | ✅ done |
| 3 | Standardize all `api/**` proxy routes onto `route-utils` helpers | in progress — owned by repo author (live, route-by-route with tests) |
| 2 | zod validation at server boundaries | ⏳ follow-up |
| 4 | error boundaries + observability | ⏳ follow-up |
| 9b | backfill `data-component` annotations → flip rule to `error` | ⏳ follow-up |
| 10 | centralized validated `env` module + `.env.example` | ⏳ follow-up |
| 7/8 | data-layer + i18n standardization | ⏳ follow-up |
