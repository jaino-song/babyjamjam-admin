# API Receipt

Overview of public HTTP endpoints exposed by the Imirae Incheon back-office backend. All routes are mounted on the NestJS server (default port `3001`). Unless otherwise noted, endpoints expect and return JSON and require appropriate authentication/authorization middleware.

## Users (`/users`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/users` | Create a new Kakao-based user. Body: `{ kakaoId: string, name?: string, email?: string, profileImage?: string }`. Returns created user. |
| `GET` | `/users/kakao?kakaoId=xxx` | Fetch user by Kakao identifier. |
| `GET` | `/users/id?id=xxx` | Fetch user by internal UUID. |
| `PATCH` | `/users?id=xxx` | Update profile fields and/or `role`. Body: `{ name?, email?, profileImage?, role? }`. Returns updated user. |
| `DELETE` | `/users?id=xxx` | Remove a user permanently. |

## Bank Account Info (`/bank-account-infos`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/bank-account-infos` | Create bank account info for an administrative area. Body: `{ area: string, bankName: string, accNum: string }`. |
| `GET` | `/bank-account-infos/area?area=xxx` | Retrieve bank account info by area code/name. |
| `PATCH` | `/bank-account-infos?area=xxx` | Update bank name and/or account number: `{ bankName?, accNum? }`. |
| `DELETE` | `/bank-account-infos?area=xxx` | Delete the entry for the area. |

## Messages (`/messages`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/messages` | Create a notice board message. Body: `{ title: string, text: string }`. |
| `GET` | `/messages/id?id=1` | Retrieve message by id. |
| `PATCH` | `/messages?id=1` | Update message title/text (marks `editedAt`). Body: `{ title: string, text: string }`. |
| `DELETE` | `/messages?id=1` | Delete message. |

## Employees (`/employees`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/employees` | Create employee. Body: `{ name, workArea, phone, grade, openToNextWork, registeredDate }`. |
| `GET` | `/employees` | List all employees. |
| `GET` | `/employees/work-area?workArea=xxx` | Filter by work area. |
| `GET` | `/employees/grade?grade=xxx` | Filter by grade. |
| `GET` | `/employees/open-status?openToNextWork=true` | Filter by availability. Query: `openToNextWork=true|false` (default `true`). |
| `GET` | `/employees/registered-date?date=YYYY-MM-DD` | Employees registered on specific date. |
| `GET` | `/employees/registered-range?startDate=xxx&endDate=xxx` | Employees registered between dates. |
| `GET` | `/employees/open-to-next-work` | Convenience list of employees open to next work. |
| `GET` | `/employees/id?id=1` | Fetch employee by id. |
| `PATCH` | `/employees/open-status?id=1` | Toggle availability. Body: `{ openToNextWork: boolean }`. Returns updated employee. |
| `PATCH` | `/employees?id=1` | Update profile fields / availability. Body accepts partial `{ name?, workArea?, phone?, grade?, openToNextWork? }`. |
| `DELETE` | `/employees?id=1` | Delete employee. |

## Employee Schedules (`/employee-schedules`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/employee-schedules` | Create schedule entry. Body: `{ employeeId: number, workAddress: string, startDate: string (ISO), endDate: string (ISO), replaced: boolean }`. |
| `GET` | `/employee-schedules` | List all schedules. |
| `GET` | `/employee-schedules/employee?employeeId=1` | List schedules for a specific employee. |
| `GET` | `/employee-schedules/id?id=1` | Fetch schedule by id. |
| `PATCH` | `/employee-schedules?id=1` | Update schedule fields. Body fields optional (`workAddress`, `startDate`, `endDate`, `replaced`). |
| `DELETE` | `/employee-schedules?id=1` | Remove schedule entry. |

## Clients (`/clients`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/clients` | Create client record. Body includes `{ name, primaryEmployeeId, secondaryEmployeeId?, address?, phone?, type?, duration?, fullPrice?, grant?, actualPrice?, startDate?, endDate?, careCenter, voucherClient }`. |
| `GET` | `/clients` | List all clients. |
| `GET` | `/clients/id?id=1` | Fetch client by id. |
| `PATCH` | `/clients?id=1` | Update client profile fields; accepts the same shape as creation (all optional). |
| `DELETE` | `/clients?id=1` | Delete client record. |

## Voucher Price Info (`/voucher-price-infos`)

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/voucher-price-infos` | Create voucher pricing entry. Body: `{ type: string, duration: string (numeric), fullPrice, grant, actualPrice }`. Duration is parsed to bigint. |
| `GET` | `/voucher-price-infos` | List all voucher price entries. |
| `GET` | `/voucher-price-infos/type?type=A가1형` | Find vouchers by type (returns array). |
| `GET` | `/voucher-price-infos/id?id=1` | Retrieve voucher by id. |
| `PATCH` | `/voucher-price-infos?id=1` | Partial update. Body fields optional; `duration` string is converted to bigint when provided. |
| `DELETE` | `/voucher-price-infos?id=1` | Delete voucher entry. |

## Auth & Eformsign (existing)

| Method(s) | Path(s) | Notes |
| --------- | ------- | ----- |
| `POST`, etc. | `/auth/*` | Kakao OAuth flow, JWT issuance (see controller for specifics). |
| Various | `/eformsign/*` | Eformsign integrations exposed by existing controller. |

## Validation & Error Handling

- DTOs leverage `class-validator` annotations; invalid payloads return `400 Bad Request` with validation details.
- Repository and usecase layers surface `NotFoundException` when records do not exist (mapped to `404`).
- Additional guards/interceptors can be added per module as needed (e.g., `@UseGuards(AuthGuard("jwt"))`).

## Common Response Shapes

- **Entities** are returned as serialized domain objects (e.g., `UserEntity`, `EmployeeEntity`).
- **Deletion** endpoints return `204 No Content` by default (per Nest convention) if controller method resolves to `void`.

## Notes

- All route paths assume the Nest app is mounted at root (`/`). Adjust if a global prefix is configured (e.g., `app.setGlobalPrefix('api')`).
- Ensure appropriate auth/role guards wrap mutating routes in production. The current receipt documents functionality, not authorization policies.

