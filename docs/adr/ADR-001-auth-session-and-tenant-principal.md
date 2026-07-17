# ADR-001: Server-managed auth sessions and verified tenant principals

## Status

Accepted

## Context

The current authentication flow uses long-lived JWT access and refresh tokens with
the same expiry. Logout only clears cookies, refresh tokens can be replayed, and
tenant authorization can consume a stale `branchRole` claim instead of the latest
membership.

User object endpoints also accept global user IDs without requiring an active
tenant, while mobile registration collects seven fields but submits only three.

## Decision

1. Access tokens remain JWTs but expire after 15 minutes and must contain a
   server-managed session ID (`sid`).
2. Refresh tokens become opaque `tokenId.secret` values. Only a SHA-256 hash of
   the secret is stored.
3. `auth_session` represents one login/device token family and
   `auth_refresh_token` records every rotation.
4. Refresh consumption is conditional and atomic. A successor token is issued
   exactly once.
5. A replay within five seconds is treated as a concurrent request and rejected
   without revoking the session. A later replay revokes the session family.
6. Existing JWT refresh tokens and access JWTs without `sid` are rejected at
   cutover, requiring one re-login.
7. `TenantGuard` writes a verified principal to `request.tenant`. Authorization
   code must not trust JWT `branchRole`.
8. Branch-admin user operations use
   `/branches/:branchId/users/:userId`. Global user operations remain owner-only.
9. Branch-admin deletion removes the membership only. Global user deletion is
   owner-only.
10. Schema changes are additive and are applied before code that requires them.

## Alternatives Considered

1. Keep JWT refresh tokens and increment `tokenVersion` on logout.
   - Rejected because it logs out every device and cannot provide session-specific
     rotation or reuse detection.
2. Temporarily accept both legacy JWT refresh tokens and opaque refresh tokens.
   - Rejected because it weakens the revocation guarantee and extends the insecure
     token path.
3. Continue reading `branchRole` from JWT and invalidate tokens on membership
   changes.
   - Rejected because every membership mutation would need perfect invalidation.
     Reading the current membership in `TenantGuard` is simpler and fail-closed.

## Consequences

### Positive

- Logout, logout-all, password reset, and token replay can revoke server-side
  sessions.
- Role downgrade and membership removal affect the next authorized request.
- Cross-tenant user object access is denied at the repository boundary.
- The refresh endpoint and cookie names remain compatible with both Next.js apps.

### Negative

- Existing users must log in again once at cutover.
- Authentication continues to require a database lookup per protected request.
- Two additive session tables and operational cleanup are required.

### Risks

- Legitimate concurrent refresh requests can resemble theft. A short concurrency
  grace prevents false family revocation while still rejecting the duplicate.
- Code deployed before the schema would fail authentication. Deployment order is
  schema first, then backend, then both Next.js apps.
- Rolling back to the legacy backend invalidates opaque refresh cookies and
  requires another login; additive tables remain in place.
