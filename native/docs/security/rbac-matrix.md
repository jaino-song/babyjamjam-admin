# RBAC Matrix (Native Apps)

## 1. Policy baseline

- Authorization model is **deny-by-default**.
- UI guards are UX aids only; final enforcement happens on server APIs.
- Access decisions require all of: authenticated principal, role, branch scope, and resource ownership/assignment where applicable.
- Canonical native roles: `admin`, `manager`, `employee`.
- Transitional role mapping: legacy `owner` maps to `admin` policy set until a separate owner policy is introduced.

## 2. Permission catalog

| Permission ID | Description | admin | manager | employee |
|---|---|---|---|---|
| `auth.session.manage` | login/logout/refresh/select-org/manage own session | Y | Y | Y |
| `dashboard.read` | read dashboard metrics and alerts | Y | Y | L (assigned scope) |
| `client.read` | read client profile/list | Y | Y | L (assigned scope) |
| `client.write` | create/update/terminate/replacement workflows | Y | Y | N |
| `employee.read` | read employee records | Y | Y | L (self profile only) |
| `employee.write` | create/update/delete employee records | Y | L (no delete) | N |
| `contract.read` | read contract metadata and status | Y | Y | L (assigned scope) |
| `contract.write` | create/send/update contract workflows | Y | Y | N |
| `template.read` | read message/system templates | Y | Y | L (message templates only) |
| `template.write` | create/update templates | Y | Y (message templates only) | N |
| `chat.use` | use chat assistant and chat history | Y | Y | Y (assigned scope) |
| `file.read` | read/download files | Y | Y | L (assigned scope) |
| `file.write` | upload/replace/delete files | Y | Y | L (upload assigned only) |
| `notification.read` | read notifications, unread counts | Y | Y | Y |
| `notification.write` | subscription and read-state updates | Y | Y | Y |
| `settings.profile.write` | update own profile/settings | Y | Y | Y |
| `settings.system.write` | update system-wide settings | Y | N | N |
| `settings.voucher.write` | manage voucher price tables and bulk update | Y | N | N |
| `admin.feedback.read` | read feedback dashboard/detail | Y | N | N |
| `audit.read` | read security/audit artifacts | Y | L (org-limited) | N |

Legend: `Y` full allow, `L` limited allow, `N` deny.

## 3. Screen route matrix (31 routes)

| Route | Screen intent | admin | manager | employee | Notes |
|---|---|---|---|---|---|
| `/` | root routing | Y | Y | Y | redirects by auth state |
| `/all` | app launcher/home shortcuts | Y | Y | Y | hide unauthorized links |
| `/dashboard` | operational dashboard | Y | Y | L | employee sees assigned/own metrics only |
| `/clients` | client list/detail hub | Y | Y | L | employee read-only assigned clients |
| `/clients/new` | client creation | Y | Y | N | write path blocked for employee |
| `/clients/filtered` | filtered client list | Y | Y | N | admin/manager operational view |
| `/employees` | employee management | Y | L | N | manager cannot hard delete |
| `/contracts` | contract list/detail | Y | Y | L | employee read assigned contracts |
| `/contracts/creation` | contract creation/send | Y | Y | N | mutation endpoint protected |
| `/messages` | messaging hub | Y | Y | L | employee limited to assigned context |
| `/messages/templates` | message template list | Y | Y | L | employee read-only |
| `/messages/templates/new` | create message template | Y | Y | N | |
| `/messages/templates/[id]/edit` | edit message template | Y | Y | N | |
| `/messages/system-templates` | system template list | Y | N | N | privileged config |
| `/messages/system-templates/[templateKey]` | system template editor | Y | N | N | privileged config |
| `/chat` | AI chat | Y | Y | Y | scoped data retrieval required |
| `/files` | document/file browser | Y | Y | L | employee limited file scope |
| `/settings` | settings root | Y | Y | Y | page must trim actions by role |
| `/settings/general` | profile/general settings | Y | Y | Y | own profile only |
| `/settings/voucher-price` | voucher pricing admin | Y | N | N | system-wide mutable data |
| `/admin` | admin feedback dashboard | Y | N | N | admin guard + API guard |
| `/admin/feedback/[id]` | admin feedback detail | Y | N | N | admin guard + API guard |
| `/select-branch` | org selection | Y | Y | Y | requires auth token |
| `/logout` | logout endpoint/page | Y | Y | Y | session invalidation |
| `/test` | non-production test page | L | N | N | disabled in production build |
| `/(auth)/login` | login | Public | Public | Public | unauthenticated entry |
| `/(auth)/register` | registration | Public | Public | Public | unauthenticated entry |
| `/(auth)/forgot-password` | password reset request | Public | Public | Public | unauthenticated entry |
| `/(auth)/reset-password` | password reset submit | Public | Public | Public | unauthenticated entry |
| `/(auth)/verify-email` | verify email | Public | Public | Public | unauthenticated entry |
| `/(auth)/callback` | OAuth callback | Public | Public | Public | must validate callback input |

## 4. API family matrix

| API family | Operations | admin | manager | employee |
|---|---|---|---|---|
| Auth (`/auth/*`) | login, refresh, me, logout, select-org | Y | Y | Y |
| Clients | list/get/create/update/terminate/replacement | Y | Y | L (read assigned only) |
| Employees | list/get/create/update/delete/status | Y | L (no delete) | L (self status/profile only) |
| Contracts | list/get/create/send/status updates | Y | Y | L (read assigned only) |
| Message templates | list/get/create/update/delete | Y | Y (non-system templates) | L (read only) |
| System templates | list/get/update | Y | N | N |
| Notifications | list/read/read-all/subscribe/unsubscribe | Y | Y | Y |
| Files/documents | list/get/upload/delete/download | Y | Y | L (assigned only) |
| Settings | read/write profile/system/voucher | Y | L (profile and selected ops) | L (profile only) |
| Admin feedback | list/stats/detail | Y | N | N |
| AI chat | stream/history/feedback/persist/session ops | Y | Y | Y (scoped responses) |

## 5. Enforcement requirements

1. Every protected endpoint enforces role and org scope in guards and service layer checks.
2. Resource-level checks are mandatory (`clientId`, `employeeId`, `contractId`, `fileId`) to prevent IDOR.
3. Unauthorized access returns `403` (not silent success), and is audit-logged with actor and target.
4. Client app must not render privileged actions if role lacks permission, but server checks remain authoritative.
5. Step-up authentication is required for privileged admin actions and recording-related access.

## 6. Required negative contract tests (minimum)

1. Employee calling admin feedback endpoints -> `403`.
2. Manager calling system template update endpoint -> `403`.
3. Employee creating client -> `403`.
4. Employee creating contract -> `403`.
5. Employee reading unassigned client -> `403`.
6. Manager deleting employee record -> `403`.
7. Non-admin updating voucher price tables -> `403`.
8. Cross-branch access with valid token -> `403`.
9. Expired role/session claim used after role downgrade -> `403` after refresh.
10. Deep-link target without permission -> page blocked and server call `403`.

## 7. Governance

- Any role or permission change requires this matrix update plus regression tests.
- Quarterly access review is required for admin and manager assignments.
