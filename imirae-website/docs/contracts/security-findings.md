# Security Audit Findings - imirae-incheon.com

**Auditor:** security-eng (Claude Sonnet)
**Date:** 2026-03-07
**Scope:** Full codebase audit of imirae-incheon.com marketing website
**Stack:** Next.js 16.1.6, React 19.2.3, Resend (email), Zod 4.3.6 (validation)

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 1     |
| MEDIUM   | 3     |
| LOW      | 2     |
| INFO     | 3     |

**Overall Assessment:** The codebase is well-structured with good security fundamentals. No critical vulnerabilities were found. One HIGH severity finding (missing security headers) should be addressed before production deployment. The application follows security best practices for input validation, HTML escaping, and environment variable handling.

---

## Findings

### [HIGH] Missing Security Headers

**Category:** Security Misconfiguration (OWASP A05)
**Location:** `next.config.ts:1-7`
**Description:** The application has no `next.config.ts` security header configuration and no middleware for setting security headers. Critical headers like `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, and `Referrer-Policy` are not set.

**Impact:** Without these headers, the site is vulnerable to:
- **Clickjacking** (no `X-Frame-Options` / CSP `frame-ancestors`)
- **MIME-type sniffing attacks** (no `X-Content-Type-Options`)
- **Protocol downgrade attacks** (no `Strict-Transport-Security`)
- **Information leakage via Referrer** (no `Referrer-Policy`)

**Recommendation:** Add security headers via `next.config.ts`:

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

---

### [MEDIUM] Email Subject Line Injection (Partial)

**Category:** Injection (OWASP A03)
**Location:** `src/lib/email.ts:36` and `src/lib/email.ts:74`
**Description:** The `subject` field in `sendContactEmail` is interpolated directly into the email subject line without escaping:
```typescript
subject: `[website inquiry] ${subject}`,
```
Similarly, in `sendConsultationEmail`:
```typescript
subject: `[consultation] ${name}`,
```

While Zod validates `subject` (max 100 chars) and `name` (max 50 chars), the subject line is not sanitized for email header injection characters (CRLF sequences). An attacker could potentially inject CRLF sequences to add additional email headers (e.g., `Bcc:`, `Cc:`), though Resend's SDK likely sanitizes these internally.

**Impact:** If Resend's SDK does not strip CRLF from subject lines, an attacker could inject additional email headers. However, since the `to` recipient is hardcoded server-side, the blast radius is limited -- the attacker cannot redirect emails to arbitrary recipients.

**Recommendation:** Add CRLF stripping to a sanitize utility:

```typescript
function sanitizeEmailField(str: string): string {
  return str.replace(/[\r\n]/g, "");
}
```

Apply to both subject line interpolations and the `replyTo` field.

---

### [MEDIUM] In-Memory Rate Limiter Not Production-Ready

**Category:** Insufficient Anti-Automation
**Location:** `src/lib/rate-limit.ts:1-21`
**Description:** The rate limiter uses an in-memory `Map` to store request timestamps. This has several limitations:

1. **Serverless reset:** In serverless deployments (Vercel), each function invocation may run in a different instance. The in-memory Map resets with each cold start, making rate limiting ineffective.
2. **No memory cleanup:** The Map grows unbounded. Expired entries are only cleaned when the same IP makes a new request. IPs that send exactly `MAX_REQUESTS` and never return leave stale entries forever.
3. **IP spoofing via `x-forwarded-for`:** The IP is extracted from `x-forwarded-for` header (line 18 of both route files). In some deployment configurations, this header can be spoofed by the client unless the CDN/proxy strips and rewrites it. On Vercel, this is handled correctly, but other hosts may not.

**Impact:** An attacker can bypass rate limiting by:
- Waiting for cold starts (serverless)
- Spoofing `x-forwarded-for` (if not behind a trusted proxy)
- Distributing requests across a botnet

**Recommendation:**
- For Vercel deployments, use Vercel's built-in rate limiting or an external store (Redis/Upstash).
- For the current deployment, this is acceptable as a basic defense layer, but document its limitations.
- Consider using `request.ip` (Next.js built-in) instead of manually parsing `x-forwarded-for` for more reliable IP detection on Vercel.

---

### [MEDIUM] Unhandled JSON Parse Error in API Routes

**Category:** Error Handling
**Location:** `src/app/api/v1/contact/route.ts:34` and `src/app/api/v1/consultation/route.ts:32`
**Description:** Both API routes call `await request.json()` before Zod validation. If the request body is not valid JSON (e.g., empty body, malformed JSON, or wrong Content-Type), this will throw an unhandled exception that falls through to the generic catch block, returning a 500 `EMAIL_SEND_FAILED` error -- which is misleading.

```typescript
const body = await request.json(); // Throws on invalid JSON
const result = contactSchema.safeParse(body);
```

**Impact:** Misleading error codes returned to the client. No security vulnerability per se, but could confuse debugging and monitoring. An attacker sending malformed JSON will see "email send failed" rather than "invalid request."

**Recommendation:** Wrap the JSON parse in a try-catch:

```typescript
let body: unknown;
try {
  body = await request.json();
} catch {
  return NextResponse.json<ApiErrorResponse>(
    {
      success: false,
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request body.",
      },
    },
    { status: 400 }
  );
}
```

---

### [LOW] Fallback Email in Source Code

**Category:** Sensitive Data Exposure (OWASP A02)
**Location:** `src/lib/email.ts:12`
**Description:** The `CONTACT_EMAIL` has a hardcoded fallback:
```typescript
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "forchildrenbysongs@gmail.com";
```

This email address is also present in `src/types/models.ts:28` as part of `COMPANY_INFO`. While this is a publicly displayed business email and not a secret, having it hardcoded as a fallback in server-side code means:
1. If the environment variable is misconfigured, emails silently go to the hardcoded address.
2. The email is exposed in the client bundle via `COMPANY_INFO`.

**Impact:** Low. The email is intentionally public (displayed on the contact page), so this is primarily a code hygiene concern.

**Recommendation:** Consider making `CONTACT_EMAIL` a required environment variable (throw on startup if missing) rather than silently falling back. This prevents silent misconfiguration.

---

### [LOW] No Request Body Size Limit

**Category:** Denial of Service
**Location:** `src/app/api/v1/contact/route.ts` and `src/app/api/v1/consultation/route.ts`
**Description:** There is no explicit request body size limit on the API routes. While Zod validates individual field lengths (e.g., `message` max 2000 chars), there is no top-level `Content-Length` or body size check. An attacker could send a very large JSON payload with many extra keys.

**Impact:** Limited. Zod's `safeParse` will reject unknown fields if using `.strict()`, but the current schemas use default mode which strips unknown keys. The JSON parsing itself could consume memory with very large payloads before Zod validates. Next.js has a default body size limit (typically 1MB), which provides some protection.

**Recommendation:** This is low risk due to Next.js's built-in limits. For defense in depth, consider adding body size limits in route segment config if supported, or documenting reliance on Next.js defaults.

---

### [INFO] No CSRF Protection on API Routes

**Category:** Cross-Site Request Forgery
**Location:** `src/app/api/v1/contact/route.ts` and `src/app/api/v1/consultation/route.ts`
**Description:** The API routes do not implement CSRF protection (no CSRF tokens, no `Origin` header checking).

**Impact:** Minimal. These are contact/consultation form endpoints that send email to the business owner. There is no authenticated state, no user sessions, and no state-changing operations on behalf of a user. The worst case is that a malicious site could auto-submit the form on behalf of a visitor, but this would only result in a contact email to the business -- functionally equivalent to the attacker filling out the form themselves. Rate limiting provides some protection here.

**Recommendation:** No action needed for the current use case. If authentication is added in the future, CSRF protection should be implemented.

---

### [INFO] External Links Have Proper `rel` Attributes

**Category:** Frontend Security
**Location:** `src/components/layout/footer.tsx:58,76`
**Description:** External links to Instagram and Naver Blog correctly use `rel="noopener noreferrer"` and `target="_blank"`. This prevents reverse tabnapping attacks.

**Impact:** None -- this is a positive finding.

**Recommendation:** No action needed.

---

### [INFO] No Unsafe DOM Injection Usage

**Category:** Cross-Site Scripting (OWASP A07)
**Location:** Entire `src/` directory
**Description:** The codebase does not use any unsafe DOM injection patterns anywhere. All user-facing content is rendered through React's JSX, which auto-escapes values. The `escapeHtml()` function in `src/lib/email.ts:79-86` properly escapes all five critical HTML entities (`&`, `<`, `>`, `"`, `'`) in email body construction.

**Impact:** None -- this is a positive finding. The email HTML construction is server-side only, and the escaping is thorough.

**Recommendation:** No action needed.

---

## Audit Checklist

| Category | Status | Notes |
|----------|--------|-------|
| **Input Validation** | PASS | Zod schemas enforce type, length, and format constraints on all API inputs |
| **XSS Prevention** | PASS | No unsafe DOM injection; `escapeHtml()` covers all 5 critical entities |
| **Email Injection** | WARN | Subject/name interpolated without CRLF stripping (mitigated by SDK) |
| **Rate Limiting** | WARN | In-memory only; ineffective in serverless; no memory cleanup |
| **Authentication** | N/A | No auth required for this application |
| **Authorization** | N/A | No auth required for this application |
| **CORS** | PASS | No custom CORS config; Next.js defaults are appropriate (same-origin) |
| **Security Headers** | FAIL | No security headers configured |
| **Environment Variables** | PASS | Secrets server-side only; `.env*` in `.gitignore`; no `NEXT_PUBLIC_` prefixed secrets |
| **Dependencies** | PASS | `pnpm audit` reports 0 known vulnerabilities |
| **Client-Side Exposure** | PASS | No sensitive data in client bundle; only public business info |
| **Error Handling** | WARN | JSON parse errors return misleading error codes |
| **Robots/Sitemap** | PASS | `/api/` disallowed in robots.txt |

---

## Deployment Recommendation

**No blocking issues for production deployment.** The HIGH severity finding (missing security headers) should be prioritized but is not a deployment blocker for a marketing site with no authentication. All MEDIUM findings are defense-in-depth improvements that should be addressed in the next iteration.

### Priority Order for Fixes:
1. **[HIGH]** Add security headers in `next.config.ts`
2. **[MEDIUM]** Sanitize email subject/name for CRLF injection
3. **[MEDIUM]** Wrap `request.json()` in try-catch for proper error codes
4. **[MEDIUM]** Document rate limiter limitations (or upgrade for serverless)
