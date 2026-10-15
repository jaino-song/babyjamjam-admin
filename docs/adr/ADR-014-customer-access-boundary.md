# ADR-014: Customer principal, provider login, and client-record access boundary

Date: 2026-10-15 (Asia/Seoul)
Status: Proposed; `READY_FOR_OWNER_DECISIONS`
Scope: BJJ-459 Phase 1 decision contract
Source base: `037ed2bdde6188869017bbb7173f54cace9739b2`

## Context

The repository currently authenticates staff through an opt-in `JwtGuard`,
`JwtStrategy`, and `TenantGuard`. `JwtStrategy` reads `auth_session`, checks
expiry/revocation/token version and staff approval, and returns a staff
principal. `TenantGuard` authorizes owner or `user_branch` membership. The
Prisma schema has `user`, `auth_session`, `auth_refresh_token`, and
`auth_rate_limit`, but no customer principal or customer-to-client link.

`client.branchId + phoneNormalized` is a data constraint, not identity proof.
`service_record_token` and `receipt_link_token` are narrow bearer links and
must never become customer-account authorization. Existing Aligo SMS is an
outbound notification path; the inspected source did not establish OTP auth.

The owner requires phone verification by SMS one-time code, Kakao login, and
Naver login. SMS proves number possession only. A separate customer-record
link confirmation and configured operational approval are required before
sensitive customer data is exposed. Provider account IDs, delivery account,
recovery proof, link multiplicity, retention, app signing, and Apple review
route remain unresolved.

## Decision (proposed)

1. Create a distinct internal customer principal ID. Keep provider bindings,
   phone verification, recovery proof, sessions, and operational client links
   as separate concepts. Never use a phone number, email match, staff user ID,
   or provider subject alone as the client-record owner.
2. Require all three capabilities in the future customer flow: SMS OTP phone
   possession proof, Kakao login, and Naver login. A phone-only entry is a
   proposed UX option, not an owner-selected requirement. Apple login is not
   selected; its 4.8 compliance route needs a separate decision.
3. Validate Kakao proofs for issuer, audience, expiry, nonce, and signature.
   Treat Kakao `phone_number_verified` as provider evidence only. Validate Naver
   state and server token/profile data for a stable subject without claiming
   OIDC or PKCE support without new evidence. Never log raw provider proofs.
4. Keep customer and staff token realms mutually exclusive. Use distinct
   issuer, audience, purpose, signing key/strategy, cookie names, and
   authoritative session state. Every protected request checks session,
   revocation, expiry, token version, and active customer link; staff roles and
   selected branch are not customer authority.
5. Model client-record access as `no_link → pending → active | rejected →
   revoked`. SMS OTP can start a request but cannot activate it. Activation
   requires the owner-selected operational approver and an auditable,
   single-use proof binding. Values for TTL, attempts, replay grace, and
   retention remain unset until owner decisions.
6. Reserve `/customer/v1` for a future provider-proof exchange, phone proof,
   session refresh/revoke, self, link request/status, and minimum home
   projection. Unknown or wrong-owner requests are non-enumerating. Staff
   endpoints, service-record links, and receipt links are not customer routes.
7. Prefer a new root `customer/` React Native + Expo app and a pure
   `packages/customer-contracts/` package only when a real shared consumer
   exists. Do not copy the staff `mobile/` Next.js app, `native/` KMP app, staff
   auth, or staff stores. App IDs, signing accounts, SDK versions, workspace
   edits, and provider environment keys require later scoped approval.

## Alternatives considered

1. Reuse staff JWTs, cookies, `user.role`, or `selectedBranch` for customers.
   Rejected: staff approval and tenant membership do not establish a customer
   principal-to-client link, and shared realms make cross-role leakage likely.
2. Treat phone equality or Kakao phone assertion as ownership proof.
   Rejected: numbers can be shared or recycled, and provider assertions are
   not fresh ownership of an operational record.
3. Reuse `service_record_token` or `receipt_link_token` as account login.
   Rejected: each is scoped to one record/document and has a different threat
   model, expiry, and audit boundary.
4. Automatically merge Kakao/Naver/phone accounts when values match.
   Rejected: collisions require reauthentication and fresh target-provider
   proof; silent merges can transfer links.

## Consequences

### Positive

- Customer ownership is explicit and separable from staff tenant authority.
- SMS, Kakao, and Naver can evolve without turning a provider subject into an
  operational record owner.
- Server-side revocation and link checks remain effective before writes,
  including after logout, unlink, account switch, or provider changes.
- A small public home projection limits accidental exposure while later record,
  document, notification, and billing contracts are designed independently.

### Negative and unresolved

- New principal/session/link data boundaries and customer guards will require a
  later schema and implementation review.
- Provider app IDs, delivery account, recovery, approver, multiplicity, TTL,
  retention, signing ownership, and Apple review path remain downstream owner
  decisions. They may be explicitly deferred to the Phase 2/3 gates without
  preventing review of this Phase 1 boundary draft.
- Customer app and staff app must maintain separate native configuration and
  release evidence.

## Verification and rollback

The plan at `docs/plans/BJJ-459-customer-phase1-contract.md` carries AUTH-01~08
and AUTH-X01~10 traceability, expected success/failure assertions, and the
future phase gates. This ADR is not implementation or Phase 2 authorization.
The documentation rollback is a Git revert. Any future schema or token-realm
rollback requires its own additive migration and revocation plan.
