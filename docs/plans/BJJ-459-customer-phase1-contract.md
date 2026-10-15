TL;DR: Phase 1은 고객용 계정 주체·전화번호 인증·Kakao/Naver 로그인·기존 고객 기록 연결과 직원 권한의 분리 경계를 실행 가능한 계약으로 고정한다. 문자 인증번호(SMS OTP)는 번호 보유 확인으로 확정하고, 고객 기록 연결 확인은 별도 직원 승인으로 둔다. 제공업체·회수·보존·앱 서명 등 소유자 결정이 남아 있으므로 상태는 `READY_FOR_OWNER_DECISIONS`이며, 이 문서는 Phase 1 종료나 Phase 2 실행 승인이 아니다.

# BJJ-459 고객 앱 Phase 1 결정 계약

Date: 2026-10-15 (Asia/Seoul)
Status: `READY_FOR_OWNER_DECISIONS`
Mode: PLAN/document authoring only
Issue/project: BJJ-459 / Linear project `b625abbd4639`
Plan revision: 0.1 (Phase 0 source snapshots + latest owner binding)

## 1. Source, revision, and authority

| Source | Revision/evidence | Use in this contract |
| --- | --- | --- |
| `/tmp/bjj-459-phase1-20261015/implementation-plan.md` | 2026-10-15 draft | Phase ordering, non-goals, app target proposal |
| `/tmp/bjj-459-phase1-20261015/mapping.md` | Revision 1, base `037ed2bdde6188869017bbb7173f54cace9739b2` | Read-only admin route and data evidence |
| `/tmp/bjj-459-phase1-20261015/feature-spec.md` | Revision 0.2 | FR-01~07 scope and public-field limits |
| `/tmp/bjj-459-phase1-20261015/test-spec.md` | Revision 0.2 | Existing 62 test IDs; AUTH-01~08 traceability |
| `/tmp/bjj-459-phase1-20261015/latest-binding.md` | Latest clarification | Mandatory phone verification plus Kakao and Naver |
| `scout-evidence.md` | Current scout additions | Guard placement, schema anchors, command limits |
| Repository `dev` | `037ed2bdde6188869017bbb7173f54cace9739b2` | Source snapshot only; not deployment/runtime proof |

Authority order is: current user/owner binding, this contract, then the cited
source snapshots. An older login-choice paragraph is superseded. No provider
console action, purchase, schema migration, dependency change, app creation,
runtime start, or deployment is authorized here.

## 2. Current worktree binding and scope

| Item | Binding |
| --- | --- |
| Unit worktree | `/Users/jaino/Development/babyjamjam-admin/unit-bjj-459-contract` |
| Unit branch | `codex/unit/bjj-459-contract` |
| Exact base | `037ed2bdde6188869017bbb7173f54cace9739b2` |
| Integration worktree/branch | `/Users/jaino/Development/babyjamjam-admin/bjj-459-phase1-plan` / `docs/BJJ-459-phase1-plan` |
| Allowed writes | This plan and `docs/adr/ADR-014-customer-access-boundary.md` only |
| Execution | `LUNA`, local sandbox, one documentation commit |
| Audit | Independent SOL PLAN review; no implementation or close approval |

Phase 1 documents the customer security/shared contract. It does not implement
auth, API controllers, DTO files, Prisma models, environment variables, app
source, SDKs, signing, or provider configuration. The main orchestrator owns
integration, final audit, and Linear updates.

## 3. Product identity and login contract

### 3.1 Customer principal

1. The customer has an internal stable `customerPrincipalId`. It is the owner
   of customer sessions, provider bindings, phone-verification state, recovery
   evidence, and operational client-record links.
2. A credential binding is separate from the principal and contains a provider,
   issuer, provider client/app scope, and provider subject. A phone number is
   never the principal ID or a sufficient client-record owner proof.
3. Matching email or phone values never create or merge provider accounts
   automatically. A collision requires an already authenticated session,
   reauthentication, and fresh proof from the target provider.
4. Account recovery, social-identity linking, and operational client links are
   different workflows with different audit events.
5. The proposed safe default is one active principal per client record. A
   principal may have explicitly approved links across branches only after the
   owner decides multiplicity and approval authority. Family sharing is out of
   scope.

### 3.2 Required login capabilities

| Capability | Phase 1 contract | Still owner-controlled |
| --- | --- | --- |
| Phone verification | **Required and confirmed:** SMS one-time code proves current number possession before sensitive customer data is returned. | Delivery account/provider, message template, abuse limits, recovery proof, retention value |
| Kakao login | **Required:** server validates the provider proof and binds a stable subject under the Kakao issuer/client scope. | Exact client/app IDs, redirect/signing configuration, console ownership |
| Naver login | **Required:** state-bound server validation of the provider token/profile and stable subject. | Exact client/app IDs, redirect configuration, console ownership |
| Phone-only entry | Proposed option for customers without social login; not selected as a separate entry point. | Owner decides whether this UX exists and how it is rate-limited |
| Apple login | Not selected. | Review whether Sign in with Apple is needed for Apple guideline 4.8 compliance |

SMS OTP is number-possession proof, not proof that a person owns an existing
client record. A successful code must be followed by a separate record-link
confirmation and, where required, staff review before sensitive data appears.
The existing Aligo integration is outbound messaging evidence only; no OTP
authentication service was found. Evaluating Aligo as a future delivery option
is allowed, but no setup, purchase, or send is authorized by this document.

Provider-specific minimums are deliberately explicit:

- Kakao ID-token proofs require issuer, audience, expiry, nonce, and signature
  validation. `phone_number_verified=true` from Kakao is a provider assertion,
  not fresh project phone proof or ownership of a client record. Tokeninfo is
  debug-only and is not production authenticity proof.
- Naver uses state binding and server-validated token/profile data with a stable
  subject. This contract does not claim that Naver is OIDC or supports PKCE
  without separate evidence. Static state or URL-logged tokens are forbidden.

Neither social provider may silently merge links when a subject collision is
found. Raw provider proofs are transient inputs and are not stored in audit
records.

## 4. Existing auth reuse and segregation

| Existing anchor | Reusable mechanism | Staff-only assumption that must stay out of customer auth | Proposed customer boundary |
| --- | --- | --- | --- |
| `backend/interface/controllers/auth.controller.ts` | Request validation and existing token/refresh flow patterns | `/auth/token` and `/auth/refresh-token` issue staff sessions and routes | New customer controller under a future `/customer/v1` namespace |
| `backend/infrastructure/auth/jwt.strategy.ts` | Server lookup, expiry, `sid`, revocation, token-version checks, fail-closed store errors | `user.role`, `approvalStatus`, `branchId`, `organizationId`, and selected staff branch | Customer strategy validates a customer issuer/audience/purpose and principal session |
| `backend/infrastructure/auth/jwt.guard.ts` | Opt-in guard composition pattern | It authenticates the staff Passport strategy | Separate customer guard; no role-string or cookie fallback |
| `backend/infrastructure/tenant/tenant.guard.ts` | Current membership lookup can inform a later link-owner check | Owner/`user_branch` membership and staff-selected branch authority | Customer authorization uses active principal-to-client link, never request body branch |
| `auth_session` | Server-managed device/session family and revocation fields | Existing relation is to `user` and carries selected staff branch | New realm discriminator or separate customer session boundary requires schema review |
| `auth_refresh_token` | Hashed opaque secret, atomic rotation, replacement marker | Existing rows are staff realm data | Reuse mechanics only after realm/data-boundary review; never cross-read rows |
| `auth_rate_limit` | Rate-limit storage/policy precedent | Existing keys and thresholds may encode staff/login assumptions | Customer phone/provider/link keys require a separate reviewed policy |
| `docs/adr/ADR-001-auth-session-and-tenant-principal.md` | 15-minute access/session lookup, opaque refresh, replay handling, fail-closed authorization | Staff tenant principal and route shape | Adopt mechanics by explicit customer ADR amendment, not by copying staff identity |
| `service_record_token`, `receipt_link_token` | Single-use hash/expiry/replay patterns for their narrow links | Bearer link tokens authorize a particular service record/document only | They never authorize a customer principal, customer session, or client link |

No customer principal or link model exists in the inspected schema. Do not
choose table reuse, a realm discriminator, or a migration until ownership,
retention, and data-boundary review is complete.

## 5. Session and authorization boundary

Customer and staff credentials use distinct issuer, audience, purpose, signing
key/strategy, cookie names, and session-state interpretation. A token is not
authorized merely because its payload contains a role or a branch identifier.

1. Customer routes reject staff access tokens and staff cookies. Staff routes
   reject customer access tokens and customer cookies. Both directions are
   required tests.
2. Guard ordering is: transport extraction → realm signature/issuer/audience/
   purpose validation → authoritative session lookup → revocation/expiry/
   token-version/link-state checks → route-specific ownership check. Public
   metadata is never a blanket customer-auth bypass.
3. Access-token expiry is not the revocation boundary. A server-side request
   check must reject logged-out, revoked, blocked, expired, or unlinked sessions
   before reads and before precommit writes.
4. Refresh rotation follows the reviewed opaque-secret/hash and reuse-handling
   mechanics in ADR-001, with customer realm rows isolated. Exact access/refresh
   TTLs, replay grace, cleanup, and retention are owner decisions; no default is
   invented here.
5. On logout, account switch, provider unlink, phone change/recycle, link
   revocation, or block, customer cache and in-flight response handling must
   fail closed. A delayed response from account A cannot populate account B.
6. Refresh secrets never appear in URLs, analytics, exceptions, or logs.

## 6. Client-record link lifecycle

The conceptual state machine is:

`no_link → pending → active | rejected → revoked`

`pending` is a request by an authenticated principal after the required phone
proof. It contains a one-time proof binding, expiry, replay/attempt controls,
and an audit reference without raw SMS/provider proof. Exact TTLs and attempt
counts remain owner decisions.

`active` is granted only after the configured operational approver confirms the
record-link evidence. `rejected` gives a safe reason code and no candidate PII.
`revoked` blocks the link on the next server request and invalidates dependent
customer reads/writes. An unlink cannot leave an in-flight approval usable.

The implementation must define behavior for simultaneous approvals, a second
request for the same record, account switch during review, phone change or
recycled number, app reinstall, multiple devices, provider account collision,
expired/replayed proof, and staff revocation. None of these cases may enumerate
candidate customers or infer ownership from phone equality alone.

## 7. Proposed `/customer/v1` contract (conceptual only)

These are allowlists for a future contract, not executable OpenAPI or DTO files.
Transport and exact field names may change after the provider and retention
decisions, but the boundary may not broaden silently.

| Endpoint | Request allowlist | Response allowlist and safe failures |
| --- | --- | --- |
| `POST /customer/v1/auth/provider-proof/exchange` | provider, authorization proof, redirect/state binding, nonce where applicable | opaque customer session handle, short-lived access credential, safe principal state; invalid proof returns generic auth failure |
| `POST /customer/v1/auth/phone-proof/start` | normalized phone input, challenge intent, client idempotency key | challenge reference and expiry metadata only; rate-limit/unknown responses do not reveal account existence |
| `POST /customer/v1/auth/phone-proof/verify` | challenge reference, one-time code, idempotency key | phone verification state and next-step link state; wrong/replayed/expired code is a safe verification failure |
| `POST /customer/v1/auth/session/refresh` | opaque refresh secret/handle in the approved secure transport | rotated session credentials and expiry metadata; reuse/revocation is generic auth failure |
| `POST /customer/v1/auth/session/revoke` | current customer session and optional all-device intent | success status only; already revoked is idempotent |
| `GET /customer/v1/self` | authenticated customer session | opaque principal reference, verification state, provider names, link summary; no staff roles or candidate records |
| `POST /customer/v1/links` | authenticated principal, client-link proof reference, user-entered confirmation, idempotency key | link ID and `pending` status; unknown/not-owner is indistinguishable from no eligible record |
| `GET /customer/v1/links/:linkId` | active customer session and link ID | link state, safe timestamps, safe reason code, minimal client display only when active |
| `GET /customer/v1/home` | active customer session and active link | minimum home projection below; revoked/unlinked returns an unavailable state, never staff data |

Unknown identifiers, wrong owners, revoked links, and unlinked sessions use
safe, non-enumerating problem codes. Internal error details, provider tokens,
refresh secrets, raw phone numbers, staff notes, signatures, addresses, and
candidate PII are excluded from responses and logs.

## 8. Minimum home projection

The first home response contains only server-authorized, customer-safe fields:

- link state and an opaque link reference;
- service period dates and a server-derived lifecycle label with a clear
  meaning (for example, contract period or confirmation pending);
- pending source representation such as `pending_review` or
  `unavailable_after_revocation`, with source/version metadata where needed;
- approved next action and safe notification summary, if a later contract
  provides one.

Date-derived `active` or `completed` does not mean a real visit started or
ended. Do not expose internal notes, signatures, addresses, staff contact
snapshots, payment/receipt outcomes, or full booking/outbox/billing schema in
this projection. Rich records belong to a later Phase 5 contract and must use
their own field allowlist and revocation rules.

## 9. App boundary and protected-change inventory

The recommended target is a new root `customer/` React Native + Expo app. The
existing `mobile/` is an admin Next.js app and `native/` is an admin KMP/
Compose/SwiftUI app; neither is copied or treated as the customer target.
Retain the 203-token customer visual baseline. Share only pure customer DTOs or
types in `packages/customer-contracts/` when an actual second consumer exists;
do not import staff auth, cookies, selected-branch state, or whole stores.

| Future protected change | Why it is listed | Binding still required |
| --- | --- | --- |
| `customer/package.json`, `customer/tsconfig.json` | New app package and strict config | Expo/RN versions and dependency approval |
| app config and native identifiers/signing files under `customer/` | Separate iOS/Android identity | Bundle/package IDs, signing account, secrets, ownership |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Explicit workspace membership and lock update | Exact package path and approved dependency set |
| `packages/customer-contracts/` | Pure DTO/types only when shared consumers exist | Consumer list and versioning policy |
| future backend customer auth/session/link paths | Principal, provider proof, phone OTP, link authorization | Exact module/file paths, realm schema, transaction boundaries |
| future env/provider configuration | Issuer, client IDs, keys, SMS credentials | Names, owners, secret storage, provider approval |

No exact versions, app IDs, signing values, environment variable names, schema
migration, or customer backend path is chosen by this document.

### Phase 2 sample-only prerequisites

Phase 2 may run only after Phase 1 decisions are closed and a dedicated plan
binds the SDK/package versions, Android/iOS identifiers, signing ownership, and
sample-only paths. A minimal home shell may be built without real customer data,
provider calls, or push delivery.

The read-only environment discovery supplied for planning found Node
`22.23.2`, pnpm `10.33.0`, Xcode `26.6 (17F113)` at the selected developer
directory, and Temurin Java `21.0.12`. `adb`, emulator, `sdkmanager`, and
Watchman were not found in `PATH`; `~/Library/Android/sdk` was absent. This is
known-path discovery, not exhaustive Android absence proof. No install, native
build, device run, or customer runtime verification occurred. Any proposed
Phase 2 commands remain future/nonexistent until that plan binds them.

## 10. Owner decisions and close gate

| Question | Safe recommendation/fact | Why it is needed | Can wait until implementation? | Phase 1 status |
| --- | --- | --- | --- | --- |
| SMS delivery account/provider | Evaluate existing Aligo only after capability and ownership review; no setup/send here | Current Aligo code is outbound SMS, not OTP auth | Provider adapter can wait; proof semantics cannot | **Owner/provider pending** |
| Recovery proof | Require a separately approved proof path; do not use phone/email match alone | Recycled numbers and lost provider access can transfer risk | No; policy needed before sensitive recovery | **Owner pending** |
| Link approval authority | Named operational role and audit event for accepting a client link | SMS possession is not record ownership | No; blocks active-link implementation | **Owner pending** |
| Multiple records/branches | Start with one active link; allow explicit cross-branch links only if approved | Prevents accidental family sharing and ambiguity | No; data boundary depends on it | **Owner pending** |
| Session/link/proof TTL and retention | No arbitrary defaults; owner chooses per artifact | Retention affects privacy, replay, recovery, and cleanup | No for contract closure | **Owner pending** |
| App IDs/signing/developer account | Separate customer identities and named owners | Prevents staff/customer app collision and release ambiguity | No for Phase 2 | **Owner pending** |
| Apple guideline 4.8 route | Recommend evaluating Sign in with Apple or a documented exception; Apple login is not selected | Third-party login may require an equivalent privacy-preserving option | No for iOS release planning | **Owner pending** |
| Phone-only entry UX | Keep proposed until product owner chooses the entry point | Avoids inferring a new login surface | Yes, after policy is fixed | **Proposed, unselected** |

Phase 1 can close only when the owner resolves the items marked required for
implementation, the independent SOL review approves the exact candidate, and
the main records the close gate. Provider console setup, app creation, native
builds, schema migration, and Phase 2 execution remain later gates.

## 11. Traceability and verification contract

The existing 62 test IDs remain unchanged. AUTH-01~08 retain their source
meanings; the following extensions are new IDs for this customer boundary and
must not renumber or replace the existing set.

| ID | Success assertion | Failure assertion |
| --- | --- | --- |
| AUTH-01 | Unlinked principal receives link guidance only | No reservation/record detail or candidate PII is returned |
| AUTH-02 | A’s active link returns only A-owned projection | B/C IDs, files, and writes are rejected without enumeration |
| AUTH-03 | Phone mismatch or duplicate candidate enters proof/review path | Phone equality alone never activates a link |
| AUTH-04 | Account A logs out and B logs in while A request is delayed | A data/cache/response cannot appear in B |
| AUTH-05 | Revoked link is blocked after foreground/server recheck | Direct URL or cached data cannot bypass revocation |
| AUTH-06 | Concurrent expiry coordinates one refresh and recovers safely | Reuse/revocation cannot loop or mint an unauthorized session |
| AUTH-07 | Reinstall requires server session/link validation before private screen | Revoked server session is not trusted because a device credential remains |
| AUTH-08 | Customer token cannot call staff controller and staff token cannot call customer controller | Staff cookie, role, or `selectedBranch` never becomes customer authority |
| AUTH-X01 | Correct SMS OTP marks number possession and advances to link flow | Wrong, expired, replayed, or rate-limited code is safe and non-enumerating |
| AUTH-X02 | Kakao proof passes issuer/audience/expiry/nonce/signature checks | Tokeninfo/debug data, bad signature, wrong audience, or stale proof is rejected |
| AUTH-X03 | Naver state and server token/profile bind one stable subject | Static state, URL token logging, or invented OIDC/PKCE assumption is rejected |
| AUTH-X04 | Existing-session reauthentication links a new provider safely | Email/phone collision never silently merges principals or links |
| AUTH-X05 | Staff-approved request becomes `active` exactly once | Concurrent approval, replayed proof, unlink, or expiry cannot activate twice |
| AUTH-X06 | Server checks revocation/link state before every protected read/write | JWT expiry alone, stale cache, or body-supplied owner bypass cannot authorize |
| AUTH-X07 | Unknown/not-owner/link-revoked responses have safe generic codes | Candidate lookup, phone existence, or staff data cannot be inferred |
| AUTH-X08 | Home status describes a contract/source state with provenance | Date-derived status is not presented as real visit or payment evidence |
| AUTH-X09 | Recovery, phone change/recycle, reinstall, and multi-device policies are explicit | Unresolved recovery proof cannot silently transfer a client link |
| AUTH-X10 | Future app identity/signing and Apple review route are recorded before build | Sample build or social login does not imply release/signing compliance |

This task verifies Markdown structure, source anchors, path allowlist, and a
credential-pattern scan only. Backend `type-check`, `lint`, `test`, `build`,
`test:auth-e2e`, native builds, provider calls, app QA, and database checks are
`NOT RUN` because no executable implementation exists.

## 12. Risks, rollout, and rollback

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Phone number is recycled or shared | Wrong client record may be exposed | Stable principal plus separate staff-approved link and recovery proof |
| Staff/customer realm is accidentally shared | Cross-role data or write access | Distinct issuer/audience/purpose/key/strategy and both-direction tests |
| Provider proof semantics drift | False authentication or account collision | Server-side validation, stable subject binding, provider contract review |
| Link approval/replay race | Duplicate or unauthorized activation | One-time bound proof, idempotency, atomic review transition, revocation recheck |
| Retention/TTL is guessed | Privacy or recovery failure | Keep values unresolved; owner decision before schema/code |
| App signing or Apple review path is unclear | Release rejection or app identity collision | Separate IDs/accounts and 4.8 review gate before Phase 2 release work |
| Android tooling is missing from known paths | False build confidence | Treat discovery as `NOT RUN`; bind tooling and device evidence in Phase 2 |

Rollout boundaries: later code must land customer schema/realm boundaries before
customer controllers, then a sample app, then provider-backed login/link flows,
then richer home data. Each phase needs its own plan, tests, and audit. No
customer data or provider send is used in a sample-only spike.

Rollback for this document is a Git revert of the documentation commit. Future
code rollback must disable new customer issuance/link activation while retaining
auditable revocation and unresolved-result lookup; schema/data rollback needs a
separate migration plan and is not authorized here.

Next resumption steps are: resolve owner table items; update ADR-014 if a
decision changes the boundary; obtain independent SOL review of the exact
candidate; bind Phase 2 paths/versions/signing; then create a separate
implementation contract. Until then, status remains `READY_FOR_OWNER_DECISIONS`
and `NOT_BUILT`.

## 13. Evidence anchors and official references

The source facts used by this contract are pinned to the inspected repository:

- `backend/interface/controllers/auth.controller.ts` contains the existing
  staff token routes and opt-in guard usage; it is not a customer controller.
- `backend/infrastructure/auth/jwt.strategy.ts:29-109` extracts Bearer or
  `auth_token`, then checks `auth_session`, expiry, revocation, token version,
  selected branch, and staff approval. `jwt.guard.ts:5-12` is an opt-in
  Passport guard.
- `backend/infrastructure/tenant/tenant.guard.ts:24-33` checks staff owner or
  `user_branch` membership. `backend/app.module.ts:107` registers
  `JwtStrategy` as a module provider, while the inspected app module contains
  no `APP_GUARD`/`useGlobalGuards`; `auth.module.ts:41` registers the same
  strategy for the staff module. Route opt-in remains material.
- `backend/prisma/schema.prisma:851` (`auth_rate_limit`), `:875`
  (`auth_session`), `:894` (`auth_refresh_token`), `:1184`
  (`service_record_token`), and `:1562` (`receipt_link_token`) are existing
  staff or narrow-link records, not a customer principal/link model.
- `docs/adr/ADR-001-auth-session-and-tenant-principal.md` is the reuse source
  for opaque refresh hashing, rotation, replay handling, and server checks.
  `docs/aligo-preparation.md` documents outbound Aligo setup examples only.

Official reference links retained for the later implementation review:

- Kakao REST/userinfo and ID-token guidance:
  <https://developers.kakao.com/docs/ko/kakaologin/rest-api> and
  <https://developers.kakao.com/docs/ko/kakaologin/utilize>.
- Naver login API:
  <https://developers.naver.com/docs/login/api/api.md>.
- Apple guideline 4.8:
  <https://developer.apple.com/app-store/review/guidelines/#login-services>.
- JWT audience and mutually exclusive validation:
  <https://www.rfc-editor.org/rfc/rfc8725>.
- Expo monorepo and secure-storage behavior for a future sample-only spike:
  <https://docs.expo.dev/guides/monorepos/> and
  <https://docs.expo.dev/versions/latest/sdk/securestore/>.
- Aligo outbound SMS API candidate (read-only reference; no account or send
  was verified): <https://smartsms.aligo.in/admin/api/spec.html>.
