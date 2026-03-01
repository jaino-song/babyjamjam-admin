# Data Classification Policy (Native Program)

## 1. Purpose

This policy classifies data handled by native apps and defines minimum controls for storage, transmission, logging, retention, and deletion.

## 2. Classification levels

| Level | Label | Definition | Minimum controls |
|---|---|---|---|
| L1 | Restricted | Highest sensitivity; exposure creates severe legal/security impact | strict access control, encryption at rest/in transit, audit trail, least privilege, explicit retention |
| L2 | Confidential | Sensitive internal/business data with user privacy impact | role-based access, encrypted transport, controlled retention, redacted logs |
| L3 | Internal | Operational data for internal use with limited external impact | authenticated access, integrity checks, limited log visibility |
| L4 | Public | Approved for public disclosure | integrity control and change management |

## 3. Domain data inventory

| Data domain | Examples | Level |
|---|---|---|
| Auth credentials and tokens | access/refresh tokens, session ids, device ids, auth headers | L1 |
| Direct PII | name, email, phone, address, birth date, profile image links | L1 |
| Care/service context | client service history, schedules, assigned provider data | L1 |
| Recording/media payloads | call recordings, captured documents/photos, metadata | L1 |
| Financial configuration | voucher price tables, bank account data for notices | L2 |
| Contract and document workflow | contract fields, template variables, sign status | L2 |
| Admin and feedback artifacts | feedback text, moderation outcomes, internal notes | L2 |
| Operational telemetry | request ids, timing, endpoint status, retry counts | L3 |
| Static app metadata | app version, public route map, non-secret config | L4 |

## 4. Handling requirements by level

| Control area | L1 Restricted | L2 Confidential | L3 Internal | L4 Public |
|---|---|---|---|---|
| Access | explicit role + scope + ownership check | role + org scope | authenticated internal users | public or authenticated as needed |
| Storage | encrypted; secure store only for tokens | encrypted in backend stores | standard protected storage | standard storage |
| Transport | TLS 1.3 mandatory | TLS mandatory | TLS mandatory | TLS preferred |
| Logging | no raw value; hash/tokenize only | redact sensitive fields | avoid unnecessary detail | standard |
| Sharing | prohibited unless approved workflow | approved internal workflows | internal only | unrestricted per policy |
| Retention | shortest practical, explicit deletion schedule | defined retention windows | operational retention | as needed |

## 5. Retention and deletion baseline

1. Tokens/session artifacts: delete on logout and expiration; no archival.
2. Audit events for privileged access: retain 12 months minimum.
3. Application logs/telemetry: retain 30-90 days based on environment.
4. Recording/media data: retention window must be explicitly configured and enforced with auto-delete.
5. User deletion/export requests: traceable workflow with completion audit record.

## 6. Localization and regulatory posture

- Data handling must align with Korean PIPA expectations for consent, minimization, purpose limitation, and deletion rights.
- Recording features require explicit consent evidence before first access and before upload flow activation.

## 7. Data minimization rules

1. Collect only fields required for current workflow.
2. Do not copy L1 data into analytics dimensions or free-form logs.
3. Avoid long-lived offline caching of L1/L2 data.
4. Use short-lived in-memory handling for tokens and clear buffers on logout/error.

## 8. Verification requirements

- Schema validation at API/input boundaries.
- Redaction tests for logs and crash payloads.
- Retention/deletion job tests for recording and audit data.
- Periodic classification review when new fields/features are introduced.
