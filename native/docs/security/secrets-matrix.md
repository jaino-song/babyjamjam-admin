# Secrets Management Matrix

## 1. Policy summary

- No secrets in source code, git history, screenshots, or logs.
- Secrets are injected at runtime from approved secret stores.
- Each secret has an owner, rotation SLA, and rollback plan.

## 2. Secrets matrix

| Secret | Used by | Environments | Source of truth | Delivery path | Rotation SLA | Rollback plan |
|---|---|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | NestJS auth/signing | dev/stage/prod | secrets manager | backend runtime env | 90 days or incident | revert to previous keyset with dual-validation window |
| `JWT_REFRESH_SECRET` | refresh token signing | dev/stage/prod | secrets manager | backend runtime env | 90 days or incident | dual-key overlap then retire old key |
| `DATABASE_URL` | backend data access | dev/stage/prod | secrets manager | backend runtime env | 180 days | restore previous DSN and connection pool profile |
| `SUPABASE_SERVICE_ROLE_KEY` | backend privileged DB operations | stage/prod | secrets manager | backend runtime env | 60 days | rotate back to prior key, invalidate leaked key |
| `KAKAO_CLIENT_SECRET` | OAuth token exchange | dev/stage/prod | secrets manager | backend runtime env | 90 days | switch app credentials in provider console |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | push send (FCM) | stage/prod | secrets manager (file secret) | backend runtime mount | 90 days | restore prior service account and disable compromised key |
| `APNS_AUTH_KEY` + key id/team id | iOS push delivery | stage/prod | secrets manager | backend runtime env/file | 180 days | roll to backup APNs key and revoke prior key |
| `SENTRY_DSN_PRIVATE` | server-side error reporting | stage/prod | secrets manager | backend runtime env | 180 days | rotate DSN and reconfigure project key |
| `EFORMSIGN_CLIENT_SECRET` | e-form integrations | dev/stage/prod | secrets manager | backend runtime env | 90 days | provider-side key rollback and token revocation |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | file/object storage operations | stage/prod | secrets manager | backend runtime env | 60 days | switch to previous IAM key pair and disable leaked pair |

## 3. Mobile build artifacts and secret posture

| Item | Secret? | Handling rule |
|---|---|---|
| `google-services.json` | Mixed (contains identifiers; treat as sensitive config) | never commit production variant; inject per environment |
| `GoogleService-Info.plist` | Mixed (contains identifiers; treat as sensitive config) | never commit production variant; inject per environment |
| App bundle id / package name | No | may exist in source |
| Public push keys / non-sensitive IDs | No | allowed in app config |

## 4. Environment separation requirements

1. Development, staging, and production secrets are fully isolated.
2. Production secrets are never used in local development.
3. CI uses ephemeral credentials where supported.
4. Secrets access is least-privilege and auditable.

## 5. Rotation and incident response

1. Trigger immediate rotation on suspected leak, unauthorized access, or departed privileged user.
2. Rotate high-risk secrets first: JWT keys, provider credentials, DB/service keys.
3. Record incident id, rotated secrets, cutover time, and validation evidence.
4. Confirm application health after rotation; if failure occurs, execute documented rollback entry from matrix.

## 6. Verification controls

- Secret scanning in CI and pre-merge checks.
- Access log review for secret store operations.
- Quarterly access recertification for secret owners.
- Dry-run key rotation exercise at least once per half-year.
