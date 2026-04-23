# API Receipt

Canonical backend endpoint receipt for the BabyJamJam Staff server.
This document supersedes the old `frontend/API_RECEIPT.md` and `mobile/API_RECEIPT.md`.

## Scope

- Base backend URL: `http://localhost:3001`
- This receipt documents NestJS backend routes in `backend/interface/controllers`
- Next.js proxy routes under `frontend/src/app/api/*` and `mobile/src/app/api/*` are intentionally excluded
- Unless noted otherwise, endpoints exchange JSON

## Auth Legend

- `Public`: no controller guard
- `JWT`: `JwtGuard`
- `JWT + Tenant`: `JwtGuard` + `TenantGuard`
- `JWT + Owner`: `JwtGuard` + `OwnerGuard` (owner role only)
- `JWT + Owner/Admin`: `JwtGuard` + owner/admin guard
- `Webhook`: bearer-token style webhook guard

## Auth (`/auth`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/auth/kakao` | `Public` | Start Kakao OAuth redirect flow. |
| `GET` | `/auth/kakao/callback` | `Public` | Kakao callback; redirects frontend with auth code or onboarding code. |
| `GET` | `/auth/me` | `JWT` | Current user profile with `branchName`. |
| `POST` | `/auth/token` | `Public` | Exchange auth code for access/refresh tokens. |
| `GET` | `/auth/kakao/pending-signup` | `Public` | Get pending Kakao signup payload via header or query token. |
| `POST` | `/auth/kakao/complete-signup` | `Public` | Complete Kakao signup onboarding (`phone`, `birthDate`, `branchId`, `role`). |
| `GET` | `/auth/onboarding/pending` | `Public` | Get pending account-completion onboarding payload. |
| `POST` | `/auth/onboarding/complete` | `Public` | Complete existing-account onboarding (`phone`, `birthDate`, `branchId`, `role`). |
| `POST` | `/auth/refresh-token` | `Public` | Refresh JWT pair. |
| `POST` | `/auth/register` | `Public` | Rate-limited email registration. |
| `GET` | `/auth/check-email` | `Public` | Rate-limited email existence/linkable check. |
| `POST` | `/auth/login` | `Public` | Rate-limited email login. |
| `POST` | `/auth/verify-email` | `Public` | Verify email token. |
| `POST` | `/auth/forgot-password` | `Public` | Rate-limited password reset request. |
| `POST` | `/auth/reset-password` | `Public` | Complete password reset. |
| `POST` | `/auth/resend-verification` | `Public` | Rate-limited resend verification email. |
| `POST` | `/auth/link-password` | `JWT` | Link password to an OAuth account. |
| `GET` | `/auth/kakao/link` | `JWT` | Start Kakao account-link flow for logged-in user. |
| `GET` | `/auth/branches` | `JWT` | List branches available to current user. |
| `GET` | `/auth/branches/all` | `Public` | List all active branches for onboarding/registration. |
| `POST` | `/auth/select-branch` | `JWT` | Select branch and reissue auth cookies/tokens. |
| `POST` | `/auth/switch-branch` | `JWT` | Switch current branch and reissue auth cookies/tokens. |
| `POST` | `/auth/logout` | `Public` | Clear auth cookies. |

## Users (`/users`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/users` | `JWT + Owner/Admin` | User directory. `owner` sees all users, `admin` is branch-scoped. |
| `POST` | `/users` | `Public` | Create Kakao-based user. |
| `GET` | `/users/kakao?kakaoId=...` | `Public` | Find user by Kakao ID. |
| `GET` | `/users/id?id=...` | `Public` | Find user by internal UUID. |
| `PATCH` | `/users?id=...` | `Public` | Update profile fields and/or `role`. |
| `DELETE` | `/users?id=...` | `Public` | Delete user. |

## Clients (`/clients`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/clients` | `JWT + Tenant` | Create client from `CreateClientDto`. |
| `GET` | `/clients` | `JWT + Tenant` | List clients. Supports `page`, `limit`, `search`, `filter`. |
| `GET` | `/clients/stats` | `JWT + Tenant` | Client dashboard stats. |
| `GET` | `/clients/:id` | `JWT + Tenant` | Get client by numeric ID. |
| `PATCH` | `/clients/:id` | `JWT + Tenant` | Update client from `UpdateClientDto`. |
| `DELETE` | `/clients/:id` | `JWT + Tenant` | Delete client. |
| `PATCH` | `/clients/:id/terminate` | `JWT + Tenant` | Terminate service. |
| `PATCH` | `/clients/:id/request-replacement` | `JWT + Tenant` | Request provider replacement. |
| `PATCH` | `/clients/:id/complete-replacement` | `JWT + Tenant` | Complete provider replacement. |

## Employees (`/employees`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/employees` | `JWT + Tenant` | Create employee. |
| `GET` | `/employees` | `JWT + Tenant` | List all employees. |
| `GET` | `/employees/work-area?workArea=...` | `JWT + Tenant` | Filter by work area. |
| `GET` | `/employees/grade?grade=...` | `JWT + Tenant` | Filter by grade. |
| `GET` | `/employees/open-status?openToNextWork=true|false` | `JWT + Tenant` | Filter by open status. Default `true`. |
| `GET` | `/employees/registered-date?date=YYYY-MM-DD` | `JWT + Tenant` | Filter by registered date. |
| `GET` | `/employees/registered-range?startDate=...&endDate=...` | `JWT + Tenant` | Filter by registered date range. |
| `GET` | `/employees/open-to-next-work` | `JWT + Tenant` | Convenience list of open employees. |
| `GET` | `/employees/id?id=...` | `JWT + Tenant` | Find employee by ID. |
| `PATCH` | `/employees/open-status?id=...` | `JWT + Tenant` | Change open status only. |
| `PATCH` | `/employees?id=...` | `JWT + Tenant` | Update employee profile. |
| `DELETE` | `/employees?id=...` | `JWT + Tenant` | Delete employee. |

## Employee Schedules (`/employee-schedules`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/employee-schedules` | `JWT + Tenant` | Create schedule. |
| `GET` | `/employee-schedules` | `JWT + Tenant` | List schedules. |
| `GET` | `/employee-schedules/primary-employee?primaryEmployeeId=...` | `JWT + Tenant` | Find by primary employee. |
| `GET` | `/employee-schedules/secondary-employee?secondaryEmployeeId=...` | `JWT + Tenant` | Find by secondary employee. |
| `GET` | `/employee-schedules/id?id=...` | `JWT + Tenant` | Find schedule by ID. |
| `PATCH` | `/employee-schedules?id=...` | `JWT + Tenant` | Update schedule. |
| `DELETE` | `/employee-schedules?id=...` | `JWT + Tenant` | Delete schedule. |

## Messages (`/messages`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/messages` | `JWT + Tenant` | List branch messages. |
| `POST` | `/messages` | `JWT + Tenant` | Create message. |
| `GET` | `/messages/id?id=...` | `JWT + Tenant` | Get message by ID. |
| `PATCH` | `/messages?id=...` | `JWT + Tenant` | Update title/text. |
| `DELETE` | `/messages?id=...` | `JWT + Tenant` | Delete message. |

## Message Templates (`/message-templates`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/message-templates` | `JWT + Tenant` | Create custom template. |
| `GET` | `/message-templates` | `JWT + Tenant` | List templates. |
| `GET` | `/message-templates/:id` | `JWT + Tenant` | Get template by ID. |
| `PATCH` | `/message-templates/:id` | `JWT + Tenant` | Update template. |
| `DELETE` | `/message-templates/:id` | `JWT + Tenant` | Delete template. |

## Message Deliveries (`/message-deliveries`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/message-deliveries/sms` | `JWT + Tenant` | Send immediate or scheduled SMS/LMS/MMS through Aligo. |

## Notifications (`/notifications`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/notifications/vapid-key` | `Public` | Get VAPID public key for web push subscription. |
| `POST` | `/notifications/subscribe` | `JWT` | Subscribe current device/browser. |
| `POST` | `/notifications/unsubscribe` | `JWT` | Unsubscribe by endpoint. |
| `GET` | `/notifications` | `JWT + Tenant` | List current user's notifications. Supports `limit`/`offset`. |
| `GET` | `/notifications/unread/count` | `JWT + Tenant` | Unread count for current user. |
| `PATCH` | `/notifications/:id/read` | `JWT + Tenant` | Mark one notification as read. |
| `PATCH` | `/notifications/read-all` | `JWT + Tenant` | Mark all notifications as read. |
| `POST` | `/notifications/send` | `JWT + Tenant` + owner/admin | Send to specific user. |
| `POST` | `/notifications/broadcast` | `JWT + Tenant` + owner/admin | Broadcast to all users. |
| `POST` | `/notifications/test-broadcast` | `Public` | Development-only broadcast test endpoint. |

## Admin Feedback (`/admin/feedback`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/admin/feedback` | `JWT + Owner/Admin` | Paginated feedback list. Supports `page`, `limit`, `type`. |
| `GET` | `/admin/feedback/stats` | `JWT + Owner/Admin` | Positive/negative/total counts. |
| `GET` | `/admin/feedback/:id` | `JWT + Owner/Admin` | Feedback detail with session messages. |

## AI Chat (`/ai/chat`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/ai/chat/stream` | `JWT` | SSE streaming chat endpoint. |
| `GET` | `/ai/chat/sessions/:id` | `JWT` | Get a single chat session if owned by current user. |
| `GET` | `/ai/chat/history?offset=0&limit=20` | `JWT` | Paginated chat history for current user. |
| `POST` | `/ai/chat/cleanup` | `JWT` + admin | Cleanup expired sessions. |
| `DELETE` | `/ai/chat/sessions/:id` | `JWT` | Delete owned session. |
| `POST` | `/ai/chat/feedback` | `JWT` | Save positive/negative feedback for chat message. |
| `POST` | `/ai/chat/persist` | `JWT` | Persist user/assistant messages. |

## Bank Account Info (`/bank-account-infos`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/bank-account-infos` | `Public` | Create bank account info. |
| `GET` | `/bank-account-infos` | `Public` | List all bank account infos. |
| `GET` | `/bank-account-infos/area?area=...` | `Public` | Find by area. |
| `PATCH` | `/bank-account-infos?area=...` | `Public` | Update by area. |
| `DELETE` | `/bank-account-infos?area=...` | `Public` | Delete by area. |

## Area Templates (`/area-templates`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/area-templates` | `JWT + Tenant` | Create area-to-template mapping. |
| `GET` | `/area-templates/area?area=...` | `JWT + Tenant` | Find mapping by area. |
| `GET` | `/area-templates` | `JWT + Tenant` | List mappings. |
| `PATCH` | `/area-templates?area=...` | `JWT + Tenant` | Update mapping by area. |
| `DELETE` | `/area-templates?area=...` | `JWT + Tenant` | Delete mapping by area. |

## Voucher Price Infos (`/voucher-price-infos`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/voucher-price-infos` | `Public` | Create voucher price row. |
| `GET` | `/voucher-price-infos` | `Public` | List voucher price rows. |
| `GET` | `/voucher-price-infos/type?type=...&year=...` | `Public` | Find by type and optional year. |
| `GET` | `/voucher-price-infos/years` | `Public` | List distinct years. |
| `GET` | `/voucher-price-infos/id?id=...` | `Public` | Find by ID. |
| `PATCH` | `/voucher-price-infos?id=...` | `Public` | Update voucher price row. |
| `DELETE` | `/voucher-price-infos?id=...` | `Public` | Delete voucher price row. |
| `POST` | `/voucher-price-infos/parse-image` | `Public` | Multipart image parse endpoint. |
| `POST` | `/voucher-price-infos/bulk-update` | `Public` | Bulk upsert parsed voucher prices. |

## Documents (`/documents`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/documents/upload` | `JWT + Tenant` | Multipart upload with metadata. |
| `POST` | `/documents` | `JWT + Tenant` | Create document metadata directly. |
| `GET` | `/documents` | `JWT + Tenant` | List documents; optional `categoryId`. |
| `GET` | `/documents/:id` | `JWT + Tenant` | Get document by ID. |
| `GET` | `/documents/org/:branchid` | `JWT + Tenant` | List by org ID field. |
| `GET` | `/documents/category/:categoryId` | `JWT + Tenant` | List by category. |
| `PUT` | `/documents/:id` | `JWT + Tenant` | Update metadata. |
| `DELETE` | `/documents/:id` | `JWT + Tenant` | Delete metadata and file storage object. |
| `GET` | `/documents/:id/download?attachment=true|false` | `JWT + Tenant` | Download or inline preview. |

## Document Categories (`/document-categories`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/document-categories` | `Public` | List categories. |
| `POST` | `/document-categories` | `Public` | Create category. |
| `DELETE` | `/document-categories/:id` | `Public` | Delete category. |

## eformsign Proxy API (`/api`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/api/generate-signature` | `JWT + Tenant` | Generate eformsign signature. |
| `POST` | `/api/access-token` | `JWT + Tenant` | Get eformsign access token. |
| `POST` | `/api/refresh-token` | `JWT + Tenant` | Refresh eformsign access token. |
| `POST` | `/api/generate-document` | `JWT + Tenant` | Build eformsign document options from contract data. |
| `GET` | `/api/documents?accessToken=...` | `JWT + Tenant` | Combined document list from eformsign API. |
| `GET` | `/api/documents/in-progress?accessToken=...` | `JWT + Tenant` | In-progress eformsign documents. |
| `GET` | `/api/documents/completed?accessToken=...` | `JWT + Tenant` | Completed eformsign documents. |
| `GET` | `/api/documents/rejected?accessToken=...` | `JWT + Tenant` | Rejected eformsign documents. |
| `DELETE` | `/api/documents?accessToken=...&is_permanent=true|false` | `JWT + Tenant` | Delete one or more eformsign documents. |
| `GET` | `/api/documents/:documentId?accessToken=...` | `JWT + Tenant` | Get single eformsign document. |
| `GET` | `/api/documents/:documentId/download_files?accessToken=...&fileType=document|audit_trail` | `JWT + Tenant` | Download document/audit trail file. |
| `POST` | `/api/documents/:documentId/re_request_outsider` | `JWT + Tenant` | Re-request outsider document to current recipient. |

## eformsign Local Records (`/eformsign-docs`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/eformsign-docs` | `JWT + Tenant` | Create local DB record for an eformsign document. |
| `GET` | `/eformsign-docs` | `JWT + Tenant` | List local eformsign document records. |
| `GET` | `/eformsign-docs/id?id=...` | `JWT + Tenant` | Find local record by DB ID. |
| `GET` | `/eformsign-docs/document-id?documentId=...` | `JWT + Tenant` | Find local record by eformsign document ID. |
| `GET` | `/eformsign-docs/client?clientId=...` | `JWT + Tenant` | Find local records by client ID. |
| `POST` | `/eformsign-docs/access-token` | `JWT + Tenant` | eformsign API token helper. |
| `POST` | `/eformsign-docs/refresh-token` | `JWT + Tenant` | eformsign API refresh helper. |
| `POST` | `/eformsign-docs/fetch-all` | `JWT + Tenant` | Fetch all eformsign API docs. |
| `POST` | `/eformsign-docs/fetch` | `JWT + Tenant` | Fetch one eformsign API doc by `documentId`. |

## eformsign Webhook (`/webhooks/eformsign`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/webhooks/eformsign` | `Webhook` | eformsign status callback. Always returns success payload to avoid retries. |

## Alimtalk

### Template Upload (`/alimtalk-templates`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `POST` | `/alimtalk-templates` | `JWT + Tenant` | Create alimtalk template; supports multipart image upload. |

### Trigger Rules / Logs / Jobs

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/alimtalk-trigger-rules` | `JWT + Tenant` | List rules. |
| `POST` | `/alimtalk-trigger-rules` | `JWT + Tenant` | Create rule. |
| `GET` | `/alimtalk-trigger-rules/:id` | `JWT + Tenant` | Get rule by ID. |
| `PATCH` | `/alimtalk-trigger-rules/:id` | `JWT + Tenant` | Update rule. |
| `DELETE` | `/alimtalk-trigger-rules/:id` | `JWT + Tenant` | Delete rule. |
| `GET` | `/alimtalk-trigger-jobs/upcoming?limit=...` | `JWT + Tenant` | Upcoming scheduled jobs. |
| `GET` | `/alimtalk-logs?limit=...` | `JWT + Tenant` | Delivery / execution history. |
| `GET` | `/alimtalk-trigger-templates?provider=aligo&eventType=...&recipientType=...` | `JWT + Tenant` | Trigger template catalog. |

## Settings (`/settings`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/settings/alimtalk-provider` | `JWT` | Current alimtalk provider and enabled flag. |
| `PUT` | `/settings/alimtalk-provider` | `JWT` | Update alimtalk provider. |
| `GET` | `/settings/notification-preferences` | `JWT` | Current user's notification preferences. |
| `PUT` | `/settings/notification-preferences` | `JWT` | Update current user's notification preferences. |
| `GET` | `/settings/ribbon-config` | `Public` | Homepage ribbon banner configuration (read by main site). |
| `PUT` | `/settings/ribbon-config` | `JWT + Owner` | Update ribbon banner configuration. Body: `{ enabled, message, backgroundColor, textColor, linkText, linkHref, linkColor }`. |
| `GET` | `/settings/message-sender-approval` | `JWT + Tenant` | Sender approval state for current branch. |
| `POST` | `/settings/message-sender-approval/request` | `JWT + Tenant` | Request sender-phone approval for current branch. |

## System Templates (`/system-templates`)

| Method | Path | Auth | Notes |
| ------ | ---- | ---- | ----- |
| `GET` | `/system-templates` | `JWT` | List all system templates with registry metadata. |
| `GET` | `/system-templates/:key` | `JWT` | Get template by key. |
| `PUT` | `/system-templates/:key` | `JWT` | Update template content/custom variables. |
| `POST` | `/system-templates/:key/validate` | `JWT` | Validate template content. |
| `POST` | `/system-templates/:key/preview` | `JWT` | Preview rendered template. |
| `GET` | `/system-templates/:key/versions` | `JWT` | Version history list. |
| `GET` | `/system-templates/:key/versions/:versionNumber` | `JWT` | Get specific version content. |
| `POST` | `/system-templates/:key/rollback/:versionNumber` | `JWT` | Roll back to a version. |
| `POST` | `/system-templates/:key/reset` | `JWT` | Reset to default template. |

## Notes

- Several older endpoints still use query-style identifiers like `?id=...`; newer resources increasingly use RESTful `/:id` paths. This receipt follows the current controller implementation exactly.
- Some endpoints are intentionally public in the controller layer today, even if production deployment may place them behind additional infrastructure or proxy controls.
- For exact request/response DTO fields, use the matching files under `backend/interface/dto`.
