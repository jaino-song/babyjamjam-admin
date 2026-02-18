# Certificate Pinning Decision (Native)

## 1. Decision summary

- **Date**: 2026-02-18
- **Status**: Accepted for Phase 2
- **Decision**: Do not enable certificate pinning in this phase. Keep TLS 1.3 as baseline and prepare a staged pinning rollout plan for later phases.

## 2. Context

The native apps (Android/iOS with KMP shared transport) call backend APIs directly over HTTPS. The threat model identifies TLS interception and transport tampering as relevant threats, but also notes that incorrect pinning operations can create availability incidents.

This decision is required before Phase 2 transport hardening is finalized.

## 3. Options considered

### Option A: Enable strict certificate pinning now

Pros:

1. Strong protection against hostile CA trust and enterprise proxy interception.
2. Reduces risk of active man-in-the-middle attacks in hostile networks.

Cons:

1. High outage risk during certificate rotation mistakes.
2. Operational burden for dual-platform pin lifecycle management.
3. Emergency recovery is difficult without pre-built remote kill switch.

### Option B: Staged pinning (recommended future state)

Pros:

1. Introduces pinning safely with backup pins and kill switch.
2. Allows telemetry-only observation before enforcement.
3. Preserves security uplift while controlling release risk.

Cons:

1. Requires additional platform and backend coordination work.
2. Security benefit is delayed until enforcement is enabled.

### Option C: No pinning, TLS only

Pros:

1. Lowest operational complexity.
2. No certificate rotation outage risk from client pin logic.

Cons:

1. Weaker transport trust posture than pinning-enabled clients.
2. Less resilient to mis-issued certificates or trusted-root abuse.

## 4. Decision rationale

For Phase 2, choose a constrained form of Option C and defer implementation to a staged Option B rollout. This preserves delivery safety while maintaining core protections:

1. TLS 1.3 remains mandatory.
2. Auth/session controls, idempotency keys, and rate-limit handling are prioritized.
3. Logging and monitoring remain privacy-safe and avoid token/PII leakage.

Pinning is not rejected; it is deferred until operational safeguards are in place.

## 5. Preconditions for pinning rollout

Before enforcement, all of the following must exist:

1. At least two valid pins (active + backup) for each target host.
2. Remote-config kill switch with tested propagation path.
3. Rotation runbook and rehearsal in non-production environments.
4. Alerting for handshake failures and pin mismatch rates.
5. Support playbook for emergency certificate incidents.

## 6. Rollout plan (future)

1. **Phase 1 (observe)**: collect handshake telemetry, no enforcement.
2. **Phase 2 (soft-fail)**: pin checks emit security events but do not block.
3. **Phase 3 (enforce)**: block on pin mismatch for production builds.

## 7. Rollback plan

If pinning causes production failure after future enablement:

1. Disable enforcement via remote kill switch.
2. Revert to TLS-only transport path.
3. Rotate to backup pin set if certificate chain changed.
4. Publish incident report with root cause and action items before re-enabling.

## 8. Security impact statement

- **Immediate impact**: no client behavior change in Phase 2; transport remains TLS-only.
- **Risk acceptance**: temporary acceptance of higher MITM exposure than pinned clients.
- **Compensating controls**: strict TLS usage, server-side authz checks, audit logging, rate limiting, and retry/backoff protections.
