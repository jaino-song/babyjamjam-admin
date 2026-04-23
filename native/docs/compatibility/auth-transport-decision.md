# Native App Authentication Transport Decision

**Document Version**: 1.0  
**Date**: February 2026  
**Status**: Phase 0 - Architecture Decision  
**Scope**: Native iOS/Android apps authentication with NestJS backend

---

## Executive Summary

Native applications (iOS/Android) will authenticate with the NestJS backend using **Bearer token transport** in the `Authorization` header. This decision leverages the existing JWT infrastructure already implemented in the backend while eliminating cookie-based transport limitations in native environments.

**Key Decision**: Native apps bypass the Next.js middleware layer and call NestJS endpoints directly with Bearer tokens.

---

## 1. Decision Rationale

### Current State Analysis

| Component | Current Implementation | Native Compatibility |
|-----------|----------------------|----------------------|
| **Web Frontend** | httpOnly cookies → Bearer tokens | ✓ Works via Next.js middleware |
| **NestJS Backend** | JwtStrategy accepts Bearer tokens | ✓ Native-ready |
| **JWT Extraction** | Bearer token + cookie fallback | ✓ Bearer token path works |
| **Token Storage** | httpOnly cookies (web) | ✗ Not available in native |

### Why Bearer Tokens for Native

1. **No Cookie Support**: Native apps (iOS/Android) cannot use httpOnly cookies
2. **Backend Ready**: NestJS `JwtStrategy` already extracts Bearer tokens via `ExtractJwt.fromAuthHeaderAsBearerToken()`
3. **Direct API Access**: Native apps call NestJS directly, no middleware layer needed
4. **Industry Standard**: Bearer tokens are the standard for mobile app authentication
5. **Existing Infrastructure**: No backend changes required

### Architecture Flow

```
Native App
    ↓
[Login Request] → NestJS /auth/login
    ↓
[Receive accessToken + refreshToken]
    ↓
[Store in Secure Storage]
    ↓
[Subsequent Requests] → Authorization: Bearer {accessToken}
    ↓
NestJS JwtStrategy validates token
```

---

## 2. Endpoint Compatibility Matrix

| Endpoint | Method | Web Transport | Native Transport | Backend Support | Status |
|----------|--------|---------------|------------------|-----------------|--------|
| `/auth/login` | POST | Cookie + Bearer | Bearer | ✓ JwtStrategy | Ready |
| `/auth/me` | GET | Cookie + Bearer | Bearer | ✓ JwtStrategy | Ready |
| `/auth/refresh` | POST | Cookie + Bearer | Bearer | ✓ JwtStrategy | Ready |
| `/auth/logout` | POST | Cookie + Bearer | Bearer | ✓ JwtStrategy | Ready |
| `/auth/register` | POST | None | None | ✓ No auth required | Ready |
| `/auth/verify-email` | POST | None | None | ✓ No auth required | Ready |
| `/auth/forgot-password` | POST | None | None | ✓ No auth required | Ready |
| `/auth/reset-password` | POST | None | None | ✓ No auth required | Ready |
| `/auth/kakao` | POST | Cookie + Bearer | Bearer | ✓ JwtStrategy | Ready |
| `/auth/link-password` | POST | Cookie + Bearer | Bearer | ✓ JwtStrategy | Ready |
| `/auth/resend-verification` | POST | Cookie + Bearer | Bearer | ✓ JwtStrategy | Ready |
| `/auth/select-branch` | POST | Cookie + Bearer | Bearer | ✓ JwtStrategy | Ready |
| **Clients** (CRUD + actions) | Multiple | Bearer | Bearer | ✓ JwtGuard + RolesGuard | Ready |
| **Employees** (List, detail, status) | Multiple | Bearer | Bearer | ✓ JwtGuard + RolesGuard | Ready |
| **Notifications** (7 endpoints) | Multiple | Bearer | Bearer | ✓ JwtGuard | Ready |
| **Documents** (7 endpoints) | Multiple | Bearer | Bearer | ✓ JwtGuard | Ready |
| **Templates** (6 endpoints) | Multiple | Bearer | Bearer | ✓ JwtGuard + RolesGuard | Ready |
| **Chat** (5 endpoints) | Multiple | Bearer | Bearer | ✓ JwtGuard | Ready |
| **Files** (3 endpoints) | Multiple | Bearer | Bearer | ✓ JwtGuard | Ready |
| **Settings** (10 endpoints) | Multiple | Bearer | Bearer | ✓ JwtGuard + RolesGuard | Ready |

**Total**: 59+ endpoints, all compatible with Bearer token authentication.

**Legend**:
- **Web Transport**: How web app sends credentials (via Next.js middleware)
- **Native Transport**: How native app sends credentials (direct Bearer token)
- **Backend Support**: Whether NestJS endpoint accepts the transport method
- **Status**: Implementation readiness

---

## 3. Session Policy Gaps Analysis

### Gap 1: Token Storage Security

**Issue**: Native apps must securely store Bearer tokens in device storage.

**Current State**: 
- Web: httpOnly cookies (browser-managed, secure by default)
- Native: No standardized secure storage mechanism defined

**Impact**: 
- iOS: Must use Keychain
- Android: Must use EncryptedSharedPreferences or Keystore
- Risk: Tokens could be stored in plaintext if not implemented correctly

**Mitigation**: 
- Document secure storage requirements per platform
- Implement platform-specific secure storage in native SDKs
- Never store tokens in SharedPreferences (Android) or UserDefaults (iOS)

---

### Gap 2: Token Refresh Strategy

**Issue**: Native apps need a clear token refresh mechanism without cookie-based session management.

**Current State**:
- Web: Refresh token stored in httpOnly cookie, automatic refresh via middleware
- Native: No automatic refresh mechanism defined

**Impact**:
- Native apps must manually handle token expiration
- Refresh token must be stored securely alongside access token
- Risk: Expired token errors if refresh not implemented

**Mitigation**:
- Implement refresh token rotation on `/auth/refresh` endpoint
- Native apps must intercept 401 responses and refresh tokens
- Implement exponential backoff for refresh failures
- Clear guidance on refresh token storage (same secure storage as access token)

---

### Gap 3: Logout and Token Revocation

**Issue**: httpOnly cookies are automatically cleared on logout; Bearer tokens require explicit handling.

**Current State**:
- Web: Logout clears httpOnly cookies automatically
- Native: No token revocation mechanism defined

**Impact**:
- Native apps must manually clear stored tokens on logout
- No server-side token blacklist for immediate revocation
- Risk: Stolen tokens could be used until expiration

**Mitigation**:
- Implement token blacklist/revocation endpoint (optional, for high-security scenarios)
- Document logout flow: clear local storage + call `/auth/logout` endpoint
- Consider short-lived access tokens (15-30 min) to limit exposure window
- Implement refresh token rotation to invalidate old refresh tokens

---

### Gap 4: CORS and Cross-Origin Requests

**Issue**: Native apps make direct API calls; CORS policies may block requests.

**Current State**:
- Web: Same-origin requests, no CORS issues
- Native: Direct API calls from different origin

**Impact**:
- NestJS must allow requests from native app origins
- Risk: Requests blocked if CORS not properly configured

**Mitigation**:
- Configure NestJS CORS to accept native app requests
- Use origin validation instead of wildcard CORS
- Implement API key or client ID validation for native apps (optional)

---

### Gap 5: Token Expiration Handling

**Issue**: Native apps must handle expired tokens gracefully.

**Current State**:
- Web: Middleware handles token expiration transparently
- Native: No automatic expiration handling

**Impact**:
- Native apps receive 401 Unauthorized on expired tokens
- User experience degradation if not handled properly
- Risk: Silent failures if error handling is incomplete

**Mitigation**:
- Implement HTTP interceptor for 401 responses
- Automatically attempt token refresh on 401
- Redirect to login only after refresh fails
- Implement exponential backoff to prevent refresh loops

---

### Gap 6: Multi-Device Session Management

**Issue**: Users may have multiple native app instances on different devices.

**Current State**:
- Web: Single session per browser
- Native: Multiple sessions possible (phone, tablet, etc.)

**Impact**:
- No mechanism to invalidate sessions on other devices
- Risk: Compromised device could maintain access indefinitely

**Mitigation**:
- Implement device fingerprinting (optional)
- Add device management endpoint to list/revoke sessions
- Consider session metadata (device ID, app version) in JWT
- Implement logout-all-devices endpoint

---

## 4. Change Requests (CR-AUTH-01 through CR-AUTH-06)

### CR-AUTH-01: Native App Token Storage Documentation

**Title**: Document secure token storage requirements for iOS and Android

**Description**: Create platform-specific guides for secure token storage in native apps.

**Acceptance Criteria**:
- [ ] iOS Keychain integration guide
- [ ] Android EncryptedSharedPreferences guide
- [ ] Code examples for both platforms
- [ ] Security best practices document
- [ ] Token encryption at rest recommendations

**Priority**: P0 (Critical)  
**Effort**: 2 days  
**Dependencies**: None

---

### CR-AUTH-02: Token Refresh Mechanism Implementation

**Title**: Implement automatic token refresh for native apps

**Description**: Add refresh token rotation and automatic refresh on 401 responses.

**Acceptance Criteria**:
- [ ] `/auth/refresh` endpoint returns new access + refresh tokens
- [ ] Refresh token rotation implemented (old token invalidated)
- [ ] HTTP interceptor handles 401 and triggers refresh
- [ ] Exponential backoff for failed refreshes
- [ ] Clear error handling when refresh fails
- [ ] Unit tests for refresh flow

**Priority**: P0 (Critical)  
**Effort**: 3 days  
**Dependencies**: CR-AUTH-01

---

### CR-AUTH-03: CORS Configuration for Native Apps

**Title**: Configure NestJS CORS to accept native app requests

**Description**: Update CORS policy to allow requests from native app origins.

**Acceptance Criteria**:
- [ ] CORS configured for native app origins
- [ ] Origin validation implemented (no wildcard)
- [ ] Credentials included in CORS headers
- [ ] Preflight requests handled correctly
- [ ] Integration tests verify CORS behavior

**Priority**: P0 (Critical)  
**Effort**: 1 day  
**Dependencies**: None

---

### CR-AUTH-04: Token Expiration and Error Handling

**Title**: Implement comprehensive token expiration handling in native apps

**Description**: Add HTTP interceptors and error handling for expired tokens.

**Acceptance Criteria**:
- [ ] HTTP interceptor detects 401 responses
- [ ] Automatic token refresh attempted on 401
- [ ] Exponential backoff implemented (max 3 retries)
- [ ] User redirected to login after refresh fails
- [ ] Error messages logged for debugging
- [ ] Unit tests for all error scenarios

**Priority**: P0 (Critical)  
**Effort**: 2 days  
**Dependencies**: CR-AUTH-02

---

### CR-AUTH-05: Logout and Token Revocation

**Title**: Implement logout flow with token revocation

**Description**: Add server-side token blacklist and client-side token clearing.

**Acceptance Criteria**:
- [ ] `/auth/logout` endpoint invalidates refresh tokens
- [ ] Token blacklist implemented (Redis or database)
- [ ] Native app clears local token storage on logout
- [ ] Logout-all-devices endpoint (optional)
- [ ] Integration tests verify token revocation
- [ ] Documentation for logout flow

**Priority**: P1 (High)  
**Effort**: 2 days  
**Dependencies**: CR-AUTH-01, CR-AUTH-02

---

### CR-AUTH-06: Multi-Device Session Management

**Title**: Implement device-aware session management

**Description**: Add device tracking and multi-device session management.

**Acceptance Criteria**:
- [ ] Device ID generation and storage
- [ ] Device metadata in JWT (device ID, app version)
- [ ] Device management endpoint to list active sessions
- [ ] Revoke-session endpoint for specific devices
- [ ] Logout-all-devices endpoint
- [ ] Integration tests for device management
- [ ] Documentation for device management API

**Priority**: P2 (Medium)  
**Effort**: 3 days  
**Dependencies**: CR-AUTH-01, CR-AUTH-05

---

## 5. Risk Assessment

### Risk 1: Token Theft and Unauthorized Access

**Severity**: HIGH  
**Probability**: MEDIUM  
**Impact**: Attacker gains access to user account and data

**Mitigation Strategies**:
1. Store tokens in secure device storage (Keychain/Keystore)
2. Implement short-lived access tokens (15-30 minutes)
3. Use refresh token rotation to invalidate old tokens
4. Implement token blacklist for logout
5. Add device fingerprinting to detect anomalies
6. Implement rate limiting on token refresh endpoint

**Residual Risk**: LOW (with all mitigations)

---

### Risk 2: Token Expiration and Service Disruption

**Severity**: MEDIUM  
**Probability**: HIGH  
**Impact**: Users unable to access app, poor user experience

**Mitigation Strategies**:
1. Implement automatic token refresh on 401
2. Use exponential backoff for refresh failures
3. Provide clear error messages to users
4. Implement offline mode with cached data
5. Add monitoring and alerting for refresh failures
6. Document token expiration handling in SDK

**Residual Risk**: LOW (with all mitigations)

---

### Risk 3: CORS Misconfiguration

**Severity**: MEDIUM  
**Probability**: MEDIUM  
**Impact**: Native app requests blocked, service unavailable

**Mitigation Strategies**:
1. Explicitly configure CORS for native app origins
2. Avoid wildcard CORS policies
3. Implement origin validation
4. Add integration tests for CORS behavior
5. Monitor CORS errors in production
6. Document CORS configuration requirements

**Residual Risk**: LOW (with all mitigations)

---

### Risk 4: Insecure Token Storage

**Severity**: CRITICAL  
**Probability**: MEDIUM  
**Impact**: Tokens exposed in plaintext, complete account compromise

**Mitigation Strategies**:
1. Mandate secure storage (Keychain/Keystore)
2. Provide code examples and templates
3. Implement security audits of native app code
4. Add static analysis to detect insecure storage
5. Document security best practices
6. Implement token encryption at rest

**Residual Risk**: MEDIUM (depends on developer implementation)

---

### Risk 5: Refresh Token Abuse

**Severity**: HIGH  
**Probability**: LOW  
**Impact**: Attacker uses stolen refresh token indefinitely

**Mitigation Strategies**:
1. Implement refresh token rotation (one-time use)
2. Store refresh tokens in secure storage
3. Implement token blacklist on logout
4. Add device fingerprinting to refresh endpoint
5. Implement rate limiting on refresh endpoint
6. Monitor for suspicious refresh patterns

**Residual Risk**: LOW (with all mitigations)

---

### Risk 6: Multi-Device Session Hijacking

**Severity**: MEDIUM  
**Probability**: LOW  
**Impact**: Attacker maintains access on compromised device

**Mitigation Strategies**:
1. Implement device ID tracking
2. Add device metadata to JWT
3. Implement device management endpoint
4. Allow users to revoke sessions on specific devices
5. Implement logout-all-devices functionality
6. Monitor for unusual device activity

**Residual Risk**: LOW (with all mitigations)

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] CR-AUTH-01: Token storage documentation
- [ ] CR-AUTH-03: CORS configuration
- [ ] Backend: Verify JwtStrategy accepts Bearer tokens

### Phase 2: Core Functionality (Week 3-4)
- [ ] CR-AUTH-02: Token refresh mechanism
- [ ] CR-AUTH-04: Error handling and interceptors
- [ ] Integration tests for auth flow

### Phase 3: Security Hardening (Week 5-6)
- [ ] CR-AUTH-05: Token revocation and logout
- [ ] Security audit of token storage
- [ ] Penetration testing

### Phase 4: Advanced Features (Week 7-8)
- [ ] CR-AUTH-06: Multi-device session management
- [ ] Device management UI
- [ ] Analytics and monitoring

---

## 7. Verification Checklist

Before native app release, verify:

- [ ] Bearer token extraction works in JwtStrategy
- [ ] CORS allows native app requests
- [ ] Token refresh endpoint returns new tokens
- [ ] Tokens stored securely in device storage
- [ ] 401 responses trigger automatic refresh
- [ ] Logout clears tokens from device storage
- [ ] Token expiration handled gracefully
- [ ] Refresh token rotation implemented
- [ ] Rate limiting prevents token refresh abuse
- [ ] Device fingerprinting implemented (optional)
- [ ] Integration tests pass for all auth flows
- [ ] Security audit completed
- [ ] Documentation complete and reviewed

---

## 8. References

### Backend Implementation
- `backend/infrastructure/auth/jwt.strategy.ts` - Bearer token extraction
- `backend/infrastructure/auth/jwt.guard.ts` - JWT validation guard
- `backend/infrastructure/auth/auth.module.ts` - Auth module configuration

### Web Implementation
- `frontend/src/lib/auth/cookies.ts` - Token handling in web app
- `frontend/src/app/api/auth/login/route.ts` - Login endpoint
- `mobile/src/lib/auth/cookies.ts` - Mobile web token handling

### Related Documentation
- JWT RFC 7519: https://tools.ietf.org/html/rfc7519
- OAuth 2.0 Bearer Token: https://tools.ietf.org/html/rfc6750
- NestJS Passport Integration: https://docs.nestjs.com/security/authentication
- iOS Keychain: https://developer.apple.com/documentation/security/keychain
- Android Keystore: https://developer.android.com/training/articles/keystore

---

## 9. Approval and Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Architecture Lead | TBD | | |
| Backend Lead | TBD | | |
| Mobile Lead | TBD | | |
| Security Lead | TBD | | |

---

## 10. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Feb 2026 | Architecture Team | Initial document creation |

---

**Document Classification**: Internal - Architecture Decision  
**Last Updated**: February 2026  
**Next Review**: After Phase 1 completion
