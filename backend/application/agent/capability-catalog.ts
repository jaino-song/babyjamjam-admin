import type { AgentCapabilityMeta } from "@babyjamjam/shared";

export type CapabilityCatalogEntry = AgentCapabilityMeta;

type ReadTuple = [string, string, CapabilityCatalogEntry["renderer"], string, string?];
const reads: CapabilityCatalogEntry[] = ([
    ["clients.search", "clients", "entity-choice", "Search for one client (산모) in the current branch by name, phone number, or address, and return a single match or a short list to pick from. Use for: 산모 찾기, 고객 조회, 산모님 성함으로 검색. Input: query text is matched partially, case-insensitively, against the client's name, address, and phone number. Returns: id, name, serviceStatus, startDate, endDate, voucherClient. Requires a specific name, phone number or address; never pass a generic word such as 산모, 고객, 관리사 or 직원 as the query — ask the user instead."],
    ["clients.get", "clients", "text", "Get one client's summary from the current branch by their numeric client id, not by name — use this after clients.search has resolved the id. Use for: 산모 상세정보, 고객 정보 조회, 특정 산모 확인. Input: id (the client's positive integer id). Returns: id, name, serviceStatus, startDate, endDate, voucherClient."],
    ["employees.search", "employees", "entity-choice", "Search for one employee (caregiver/staff) in the current branch by name or work area, and return a single match or a short list to pick from. Use for: 관리사 찾기, 제공인력 조회, 도우미 검색, 선생님 성함으로 찾기. Input: query text is matched partially, case-insensitively, against the employee's name or work area. Returns: id, name, grade, workArea, openToNextWork, and status (available/working/unavailable) when the search can compute it. Does not expose rest days, leave schedules or a detailed availability calendar. Requires a specific name or area; never pass a generic word such as 관리사, 직원 or 도우미 as the query — ask the user instead."],
    ["employees.get", "employees", "text", "Get one employee's summary from the current branch by their numeric employee id, not by name — use this after employees.search has resolved the id. Use for: 관리사 상세정보, 직원 정보 조회. Input: id (the employee's positive integer id). Returns: id, name, grade, workArea, openToNextWork, and status (available/working/unavailable) for today's Korean calendar date when it can be computed."],
    ["employees.list", "employees", "text", "List employees (caregivers/staff) in the current branch, optionally filtered by computed status, work area, or grade. Use for: 관리사 목록, 관리사 몇 명, 쉬는 관리사, 일 없는 관리사, 배정 가능한 관리사. Input: optional status (available/working/unavailable), date (YYYY-MM-DD, defaults to today's Korean calendar date — the status is computed for this date), workArea (partial match), grade (exact match), limit (1-50, default 50). Returns: date, total (count after filters, before limit), employees (sorted by name; excludes soft-deleted employees). There is no rest-day or leave calendar — status only reflects an active client assignment on the given date."],
    ["schedules.list", "schedules", "activity", "List employee work schedules (client assignments) for the current branch, optionally filtered to one calendar date, client, or employee. Use for: 오늘 일정, 이번주 스케줄, 방문 일정 확인, 특정 날짜 배정 확인. Input: optional date (YYYY-MM-DD; when given, only schedules overlapping that date are returned), optional clientId, optional employeeId (matches primary or secondary) — up to 50 rows sorted by start date. Returns: id, clientId, clientName, primaryEmployeeId, primaryEmployeeName, secondaryEmployeeId, secondaryEmployeeName, startDate, endDate, replaced. Names resolve even for a soft-deleted client or employee so history stays readable."],
    ["dashboard.summary", "dashboard", "activity", "Give a quick headline count of clients in the current branch, without exposing any personal contact data. Use for: 전체 산모 수, 진행중인 고객 수, 대시보드 요약. Input: none. Returns: totalClients, activeClients. For a breakdown by service status, use analytics.summary instead."],
    ["vouchers.prices", "vouchers", "text", "Read the branch's voucher price list (government voucher service pricing by type, duration and year) — not an individual client's voucher balance or usage. Use for: 바우처 단가, 정부지원 가격표, 서비스 요금 확인. Input: optional year (2000-2100) and optional type keyword, matched partially. Returns, up to 100 rows: id, type, duration, fullPrice, grant, actualPrice, year."],
    ["bank.accounts", "bank", "text", "Read the branch's registered bank account references, with account numbers masked to the last 4 digits — never the full account number. Use for: 계좌 정보, 입금 계좌, 은행 확인. Input: optional area keyword, matched partially. Returns: area, bankName, accountLast4."],
    ["contracts.status", "contracts", "activity", "Read the eformsign contract/e-signature document status for one specific client. Use for: 계약서 상태, 전자서명 진행상황, 서명 완료 여부 확인. Input: clientId — the client's numeric id; look it up via clients.search first, this does not accept a client name. Returns, per non-deleted document: documentId, documentName, status, statusDetail, updatedDate, expired."],
    ["contracts.recent", "contracts", "activity", "List the most recently updated contracts for the current branch, across all clients. Use for: 최근 계약서, 계약서 현황, 서명 안 된 계약서. Input: optional limit (1-20, default 10), optional status (display status: pending/signed/review/unassigned/completed/expired/unknown) — when given, applied over a bounded window before the limit. Returns, newest updated first: documentId, documentName, clientId, clientName, status, statusDetail, updatedDate, expired. There is no rest-day or leave calendar here — this only covers contract documents, never service-record submissions."],
    ["consultations.list", "consultations", "text", "List consultation inquiries (pre-registration leads) for the current branch, newest first. Use for: 상담 문의 목록, 전체 문의 확인, 최근 문의. Input: optional query — when given, matched partially, case-insensitively, against the mother's name, status, or preferred caregiver name; omit it to list everything. Optional limit (max 50, default 20). Returns: id, motherName, dueDate, voucherType, preferredCaregiverName, referralSource, source, status, readAt, createdAt, updatedAt."],
    ["consultations.search", "consultations", "text", "Search consultation inquiries (pre-registration leads) for the current branch by a specific keyword — behaves like consultations.list but is meant for when you already have a name, status, or caregiver to filter by. Use for: 특정 산모 상담 찾기, 상담 상태로 검색, 담당 관리사로 검색. Input: query, matched partially, case-insensitively, against the mother's name, status, or preferred caregiver name. Returns the same fields as consultations.list. Requires a specific value; a generic word such as 산모 or 고객 will match too broadly — use consultations.list without a query to browse everything instead."],
    ["consultations.unread", "consultations", "text", "List only unread consultation inquiries for the current branch, newest first. Use for: 안읽은 상담, 미확인 문의, 새 문의 확인. Input: optional query (same match fields as consultations.list: mother's name, status, or preferred caregiver name) and optional limit (max 50, default 20). Returns the same fields as consultations.list; every row has readAt = null."],
    ["calls.list", "calls", "text", "List calls for the current branch"],
    ["calls.transcriptSummary", "calls", "text", "List call transcript summaries without exposing raw transcripts"],
    ["drafts.list", "drafts", "text", "List client drafts for the current branch"],
    ["automation.list", "automation", "text", "List message automation rules for the current branch"],
    ["files.search", "files", "attachment", "Search authorized files for the current branch"],
    ["files.metadata", "files", "attachment", "Read authorized file metadata without signed URLs"],
    ["service-records.oversight", "service-records", "text", "Read service-record case oversight rows (session-count and finalization/document tracking) for the current branch — operational status, not the submitted form content. Use for: 제공기록지 진행상황, 서비스 종료 처리 현황, 최종 승인 여부. Input: optional limit (max 50, default 20); any query text is ignored — this capability has no search field. Resolve a client's id via clients.search first, then match it against the returned clientId. Returns: id, clientId, status, startDate, endDate, requiredSessionCount, formVersion, plus finalization/completion timestamps and retry metadata."],
    ["analytics.summary", "analytics", "text", "Read branch-wide client analytics: total and voucher-client counts plus a breakdown by service status. Use for: 서비스 상태별 통계, 바우처 고객 수, 운영 현황 분석. Input: none. Returns: totalClients, voucherClients, byServiceStatus (status and count per service stage). For a simple total/active headline count, use dashboard.summary instead."],
    ["settings.read", "settings", "text", "Read explicitly approved operational policies for the current branch", "1.1.0"],
    ["website.settings", "website", "text", "Read the public ribbon configuration without exposing raw system settings", "1.1.0"],
    ["messages.previewSms", "messages", "activity", "Preview SMS content and cost category"],
    ["messages.deliveryHistory", "messages", "activity", "List SMS delivery lifecycle history for the current branch"],
    ["policy.retrieve", "policy", "text", "Retrieve versioned operational policy for explanatory answers"],
] as ReadTuple[]).map(([name, domain, renderer, description, version = "1.0.0"]) => ({
    name,
    domain,
    renderer,
    description,
    version,
    risk: "read" as const,
    requiredRoles: name === "bank.accounts"
        ? ["owner", "admin"]
        : ["messages.deliveryHistory", "vouchers.prices"].includes(name)
            ? ["owner", "admin", "manager"]
            : ["owner", "admin", "manager", "user"],
    flagKey: `agent.capability.${name}`,
    sideEffect: false,
}));

type WriteTuple = [string, string, string, CapabilityCatalogEntry["risk"], "structured" | "strong", "action-id" | "provider-key", string[]];
const writes: CapabilityCatalogEntry[] = ([
    ["clients.create", "clients", "Create a client: ask only for missing facts, complete read-only lookups first, then invoke the write tool immediately once required facts are resolved. Never ask the user for conversational confirmation; the structured proposal card is the sole mandatory approval.", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["clients.update", "clients", "Update an existing client after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["employees.create", "employees", "Create an employee after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin"]],
    ["employees.update", "employees", "Update an employee after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin"]],
    ["employees.changeAvailability", "employees", "Change employee availability after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin"]],
    ["messages.createTemplate", "messages", "Create a message template after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["messages.updateTemplate", "messages", "Update a message template after explicit approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["consultations.markRead", "consultations", "Mark a consultation inquiry read after approval", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["drafts.update", "drafts", "Update a pending client draft through the canonical draft use case", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["drafts.confirm", "drafts", "Confirm a pending client draft through the canonical draft workflow", "reversible-write", "structured", "action-id", ["owner", "admin", "manager"]],
    ["files.delete", "files", "Delete an authorized file after strong approval", "irreversible-write", "strong", "action-id", ["owner", "admin", "manager"]],
    ["admin.createBranch", "admin", "Create a branch after owner-only strong approval", "privileged-administration", "strong", "action-id", ["owner"]],
    ["website.updateSettings", "website", "Update website settings after approval", "reversible-write", "structured", "action-id", ["owner"]],
    ["contracts.dispatch", "contracts", "Create and send a contract after strong approval", "external-side-effect", "strong", "provider-key", ["owner", "admin", "manager"]],
    ["messages.sendSms", "messages", "Send an SMS after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin"]],
    ["messages.scheduleSms", "messages", "Schedule an SMS after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin"]],
    ["messages.retrySms", "messages", "Retry a provider-rejected SMS after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin"]],
    ["automation.create", "automation", "Create a message automation rule after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["automation.update", "automation", "Update a message automation rule after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["automation.setActive", "automation", "Enable or disable a message automation rule after strong approval", "external-side-effect", "strong", "action-id", ["owner", "admin", "manager"]],
    ["automation.delete", "automation", "Delete a message automation rule and cancel pending jobs after strong approval", "irreversible-write", "strong", "action-id", ["owner", "admin", "manager"]],
    ["notifications.test", "notifications", "Persist a test notification and attempt web push after explicit approval", "external-side-effect", "strong", "action-id", ["owner", "admin"]],
] as WriteTuple[]).map(([name, domain, description, risk, approvalPolicy, idempotencyPolicy, requiredRoles]) => ({
    name,
    domain,
    version: "1.0.0",
    description,
    risk,
    requiredRoles,
    renderer: "action-proposal",
    flagKey: `agent.capability.${name}`,
    sideEffect: true,
    approvalPolicy,
    idempotencyPolicy,
}));

export const CAPABILITY_CATALOG: CapabilityCatalogEntry[] = [...reads, ...writes];
export const CAPABILITY_CATALOG_BY_NAME = new Map(CAPABILITY_CATALOG.map((entry) => [entry.name, entry]));
