# Authentication and Session Policy (Native)

## 1. Purpose and scope

This policy defines authentication, session, and authorization requirements for native Android/iOS apps and the shared KMP layer communicating with the NestJS backend.

## 2. Core principles

1. Server-side checks are authoritative for authentication and authorization.
2. Deny by default for all protected endpoints and actions.
3. No credential, token, or secret is persisted outside approved secure stores.
4. Any invalid auth state fails secure (session invalidation and controlled re-auth).

## 3. Authentication methods

### Supported methods

- Email/password login.
- Kakao OAuth login with backend token exchange.

### Token model

- Access token: bearer JWT used on every API request.
- Refresh token: one-time-use rotation token for renewing sessions.
- Required claims: `sub`, `role`, `organizationId`, `orgRole`, `sid` (session id), `deviceId`, `exp`, `iat`, `jti`.

### Transport and storage

- Transport: `Authorization: Bearer <accessToken>` over TLS 1.3.
- iOS storage: Keychain only.
- Android storage: Keystore-backed encrypted storage only.
- Forbidden storage: plaintext files, SharedPreferences, UserDefaults, logs, crash breadcrumbs.

## 4. Session lifecycle policy

1. **Login**: issue access and refresh tokens, bind session to `deviceId`.
2. **Organization selection**: session context must include selected organization before protected business APIs are allowed.
3. **Refresh rotation**: every refresh request issues a new refresh token and invalidates the previous one.
4. **Idle timeout**: session expires after 30 minutes of inactivity.
5. **Absolute lifetime**: refresh sessions expire at backend-defined hard limit (recommended 7 days max for privileged roles).
6. **Remote logout**: backend supports revoking all active sessions for a user.
7. **Role change propagation**: role downgrade invalidates elevated capabilities at next token check/refresh.

## 5. Step-up authentication

Step-up auth (biometric or equivalent strong re-auth) is required before:

1. Recording access/upload actions.
2. Admin feedback moderation and privileged settings changes.
3. Account/security changes (password link, session revoke-all, sensitive profile changes).

Step-up session window should be short-lived (recommended <= 10 minutes).

## 6. Authorization policy

- Role matrix source: `native/docs/security/rbac-matrix.md`.
- Required decision inputs for protected resources:
  - principal identity
  - role
  - organization scope
  - resource ownership/assignment
- All authorization failures return `403` and are audit-logged.
- UI guards may hide blocked actions, but backend must independently enforce.

## 7. Fail-secure requirements

1. Token decode/validation failure -> clear local auth state and require login.
2. Refresh failure (expired/revoked/replay) -> force logout and session reset.
3. Missing org context -> block protected routes, redirect to org selection.
4. Invalid deep link target or malformed push payload -> drop input silently and log security event.
5. Permission loss at runtime -> block action immediately and refresh user claims.

## 8. API security controls tied to auth

1. Rate limit auth and refresh endpoints.
2. Apply idempotency keys for non-idempotent mutations.
3. Validate all client inputs with schema validation at API boundaries.
4. Use correlation IDs on auth flows and include in audit events.

## 9. Audit and monitoring requirements

The following events are mandatory:

- login success/failure
- token refresh success/failure (include replay detection)
- logout and logout-all-devices
- role/organization context changes
- step-up success/failure
- access denied (`403`) for privileged routes

Audit events must exclude raw tokens and sensitive PII.

## 10. Change management and rollback

Any auth-impacting change (token claims, lifetime, guard behavior, storage mechanism) requires:

1. documented rationale,
2. backward compatibility notes,
3. rollback procedure,
4. regression tests for login/refresh/logout/403 paths.
