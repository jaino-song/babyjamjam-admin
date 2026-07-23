# ADR-003: Refresh the application session after an API 401

## Status

Accepted

## Context

Access tokens expire after 15 minutes. Protected page navigation can refresh an
expired session, but browser calls under `/api` bypass that navigation path. A
long-lived page therefore redirected to login as soon as its first API request
received 401, even when a valid refresh cookie existed.

## Decision

1. Add `POST /api/auth/refresh` as a same-origin session refresh route.
2. The route reads the HTTP-only refresh cookie, rotates tokens through the
   backend, and writes HTTP-only session cookies. Tokens are never returned to
   browser JavaScript.
3. The Axios response interceptor performs at most one app-session refresh for a
   failed request and then retries the original request once.
4. Concurrent 401 responses in one browser context share a single refresh
   promise, preventing refresh-token rotation races.
5. Authentication endpoints and already retried requests are not refreshed
   recursively. Eformsign token refresh remains a separate mechanism.
6. A rejected refresh clears local session cookies and redirects to login. A
   transient upstream failure is surfaced without clearing the session.

## Alternatives Considered

1. Increase the access-token lifetime.
   - Rejected because it weakens the short-lived access-token security boundary.
2. Refresh on a timer.
   - Rejected because background timers are unreliable in suspended tabs and
     create unnecessary refresh traffic.
3. Redirect immediately on every 401.
   - Rejected because a valid refresh session should keep the user signed in.

## Consequences

### Positive

- Long-lived pages recover transparently after access-token expiry.
- Refresh tokens remain inaccessible to client JavaScript.
- One refresh and one replay bound prevents infinite retry loops.

### Negative

- A failed request may take one additional network round trip.
- Multi-tab refresh races still rely on the backend's concurrent-replay policy;
  single-flight coordination applies within each JavaScript context.

### Risks and rollback

- The refresh route is same-origin, cookie-based, `SameSite=Lax`, and returns
  `Cache-Control: no-store`.
- Rollback removes the interceptor branch and route; page-navigation refresh
  behavior remains unchanged.
