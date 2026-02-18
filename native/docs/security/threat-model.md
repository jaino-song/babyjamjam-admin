# Threat Model (STRIDE-lite)

## 1. Scope

- Target system: native Android (Jetpack Compose) + iOS (SwiftUI) clients with shared KMP domain/network layer.
- API path: native apps call NestJS backend directly with bearer tokens.
- Security-critical features: JWT auth/session, org selection, RBAC, push notifications, deep links, camera/media, Android call recording upload.
- This document focuses on application and API threats, not low-level cloud/network appliance hardening.

## 2. Architecture and trust boundaries

### Components

1. Native app UI layer (Android/iOS)
2. KMP shared module (API client, auth/session manager, deep-link router, notification manager)
3. Device secure storage (Keychain / Android Keystore-backed storage)
4. NestJS API (auth, clients, employees, contracts, messages, files, admin)
5. PostgreSQL/Supabase data plane and object/file storage
6. External providers (Kakao OAuth, FCM, APNs)

### Trust boundaries

- `TB-1` Device boundary: app runtime vs OS/device storage and permissions.
- `TB-2` Network boundary: mobile network/Wi-Fi and internet transport.
- `TB-3` Backend boundary: API layer vs data/storage systems.
- `TB-4` Third-party boundary: OAuth and push providers.

## 3. Security objectives

1. Preserve confidentiality of PII, auth artifacts, and recording data.
2. Enforce integrity of authorization decisions and business mutations.
3. Maintain availability for critical workflows (auth, client access, contract lifecycle, notifications).
4. Guarantee auditability for privileged actions and sensitive data access.
5. Fail secure when tokens, payloads, or deep links are invalid.

## 4. Critical assets

| Asset | Examples | CIA Priority |
|---|---|---|
| Auth artifacts | access token, refresh token, device/session identifiers | High / High / Medium |
| Identity and RBAC context | user id, org id, role, assignment scope | High / High / Medium |
| Customer and staff PII | name, phone, address, care history, schedules | High / High / Medium |
| Recording and media payloads | call recordings, uploaded files, metadata | High / High / Medium |
| Contract and template data | contract details, template variables, status | Medium / High / Medium |
| Admin and feedback data | internal feedback, moderation history | Medium / High / Medium |
| Observability stream | logs, traces, audit events, crash telemetry | High / High / High |

## 5. STRIDE-lite threat register

| ID | STRIDE | Threat scenario | Boundary | Impact | Primary controls | Residual risk |
|---|---|---|---|---|---|---|
| T-01 | Spoofing | Stolen token reused from compromised device | TB-1/TB-2 | Account takeover | secure storage, short access-token TTL, refresh rotation, device binding, remote logout | Medium |
| T-02 | Spoofing | Forged deep link triggers privileged screen/action | TB-2/TB-4 | Unauthorized action attempt | deep-link allowlist, strict URI parser, authz re-check on target action, drop unknown links | Low |
| T-03 | Tampering | Mutation payload altered in transit/replay | TB-2 | Corrupted business state | TLS 1.3, server-side schema validation, idempotency keys, nonce/timestamp validation where needed | Low |
| T-04 | Tampering | Local recording/media cache modified before upload | TB-1 | Evidentiary integrity loss | encrypted temp files, checksum/hash at upload, metadata signing, immediate temp-file deletion | Medium |
| T-05 | Repudiation | Admin denies destructive change or data export | TB-3 | Compliance/audit failure | immutable audit events, actor id + org id + correlation id, clock sync, retention policy | Low |
| T-06 | Information disclosure | PII/tokens leaked via logs or crash payloads | TB-1/TB-3 | Regulatory breach | redaction policy, denylist/allowlist log formatter, client telemetry scrubbers, secret scanners in CI | Medium |
| T-07 | Information disclosure | Secrets exposed via repo, app bundle, CI logs | TB-3/TB-4 | Credential compromise | secrets manager, no secrets in code, least-privilege service accounts, rotation SLA | Medium |
| T-08 | Denial of service | API abuse, retry storms, chat stream exhaustion | TB-2/TB-3 | Service degradation | server rate limiting, client exponential backoff with jitter, circuit breakers, queue/timeout limits | Medium |
| T-09 | Denial of service | Push payload flood or malformed payload causes app instability | TB-4/TB-1 | UX outage, battery drain | payload schema validation, payload size caps, dedupe ids, notification throttling | Low |
| T-10 | Elevation of privilege | Client-only role checks bypassed | TB-1/TB-3 | Unauthorized admin access | server-side guard enforcement, deny-by-default RBAC, 403 contract tests | Medium |
| T-11 | Elevation of privilege | Cross-organization access via IDOR | TB-3 | Tenant data breach | mandatory org scoping in all queries, ownership checks, integration tests for negative paths | Medium |
| T-12 | Elevation of privilege | Missing step-up auth for sensitive actions | TB-1/TB-3 | High-impact unauthorized actions | biometric step-up gate for recording/admin/account changes, short step-up session window | Low |

## 6. Mandatory security controls

1. **Server-side authorization is source of truth**: every sensitive API path validates `user`, `role`, `organization`, and resource scope.
2. **Session policy**: refresh token rotation on each use, idle timeout at 30 minutes, per-device session tracking, remote logout endpoint.
3. **Fail-secure behavior**: token parse failure forces logout, unknown deep link is dropped, permission loss blocks action.
4. **Input hardening at trust boundaries**: validate deep links, push payloads, file MIME/size/name, and API inputs.
5. **Privacy-safe observability**: token/PII redaction in logs, strict log schema, audit trail for privileged actions.
6. **Recording compliance gate**: explicit consent, encryption in transit/at rest, retention and deletion workflow, legal sign-off before release.

## 7. Security validation plan

| Category | Required checks |
|---|---|
| Auth/session | refresh rotation tests, idle-timeout test, remote logout test, invalid token fail-secure test |
| RBAC/authz | role matrix 403 tests, cross-org negative tests, resource ownership checks |
| Input validation | deep-link fuzz tests, push payload schema tests, file upload validation tests |
| Secrets/logging | secret scan in CI, redaction unit tests, log schema conformance checks |
| Resilience | rate-limit behavior tests (429), retry/backoff tests, stream timeout tests |
| Compliance | consent capture verification, retention job test, deletion/export traceability test |

## 8. Open risks and decisions to track

1. Certificate pinning decision remains open; capture decision and rollback plan before production cut.
2. Android call recording feature requires explicit legal and policy approval before enabling in release channels.
3. Offline cache scope for sensitive data must stay minimal and encrypted; no unencrypted PII cache allowed.

## 9. Review cadence

- Review this threat model at each major phase gate (Phase 2, 3, 6, 8) and after any auth/RBAC architecture change.
- Add new threats when new native capabilities or third-party integrations are introduced.
