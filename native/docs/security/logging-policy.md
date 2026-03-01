# Security Logging and Audit Policy

## 1. Goals

1. Provide actionable forensic evidence for security and operational incidents.
2. Prevent sensitive data leakage through logs and telemetry.
3. Standardize log schema across native clients and backend services.

## 2. Scope

- Native Android/iOS app logs and crash telemetry.
- KMP shared module network/auth/deep-link events.
- Backend API, authorization, and audit logs.

## 3. Structured logging schema

All security-relevant events should include these fields where applicable:

| Field | Description |
|---|---|
| `timestamp` | ISO-8601 UTC timestamp |
| `level` | debug/info/warn/error/security |
| `service` | `android-app`, `ios-app`, `kmp-shared`, `backend-api` |
| `environment` | dev/stage/prod |
| `event_type` | canonical event id (for example `auth.login.failed`) |
| `request_id` | per-request correlation id |
| `trace_id` | distributed trace id |
| `actor_id_hash` | hashed user id, never raw token |
| `organization_id` | tenant scope |
| `resource_type` | client/employee/contract/file/admin |
| `resource_id` | target resource id (if non-sensitive) |
| `result` | success/failure/denied |
| `error_code` | normalized machine-readable code |

## 4. Redaction and prohibited content

Never log:

1. access or refresh tokens,
2. passwords, OTPs, secrets, API keys,
3. raw phone, address, email, birth date, recording contents,
4. full auth headers, cookie values, or provider credential payloads.

Required handling for sensitive identifiers:

- user identifiers: hash/tokenize before logging.
- phone/email: masked form only when operationally necessary.
- deep-link and push payload data: log validated route id, not raw payload body.

## 5. Required security event catalog

| Event type | Minimum level | Required context |
|---|---|---|
| `auth.login.succeeded` | info | actor hash, org id, device id hash |
| `auth.login.failed` | warn | reason code, ip/device fingerprint hash |
| `auth.refresh.succeeded` | info | session id hash, rotation id |
| `auth.refresh.failed` | warn | reason code, replay flag |
| `auth.logout` | info | session scope (single/all devices) |
| `auth.step_up.failed` | warn | action target, challenge type |
| `authz.access.denied` | security | role, permission id, resource scope |
| `deeplink.rejected` | warn | parser reason, source |
| `push.payload.rejected` | warn | schema violation code |
| `recording.access` | security | consent state, action type |
| `recording.upload` | security | file class, result, checksum status |
| `secret.scan.detected` | security | detection source, severity |

## 6. Environment-specific behavior

- Development: debug logs allowed, still no secret/PII logging.
- Staging: production-like redaction and retention settings.
- Production: info/warn/error/security only by default; debug requires temporary approval and expiry.

## 7. Retention and access control

1. Security/audit logs: 12 months minimum retention.
2. Application operational logs: 30-90 days (based on cost and compliance needs).
3. Access to security logs is restricted to authorized engineering/security roles.
4. All log access actions are themselves auditable.

## 8. Alerting requirements

Alert on:

1. spike in `auth.login.failed` or `auth.refresh.failed`,
2. repeated `authz.access.denied` on privileged endpoints,
3. secret scanner findings in default branch or release artifacts,
4. unusual recording access/upload failure patterns,
5. sudden crash increase in auth/deep-link/push pathways.

## 9. Quality controls and validation

- Unit tests for redaction formatter and event schema.
- Integration tests for correlation id propagation.
- Periodic sampling to confirm no sensitive payload leakage.
- Incident postmortems must include logging adequacy review.

## 10. Example safe log (reference)

```json
{
  "timestamp": "2026-02-18T06:10:23Z",
  "level": "security",
  "service": "backend-api",
  "environment": "prod",
  "event_type": "authz.access.denied",
  "request_id": "req_1f3b6c",
  "trace_id": "tr_8df42d",
  "actor_id_hash": "usr_4f9a2d",
  "organization_id": "org_102",
  "resource_type": "admin-feedback",
  "resource_id": "feedback_381",
  "result": "denied",
  "error_code": "RBAC_PERMISSION_DENIED"
}
```
