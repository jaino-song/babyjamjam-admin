/**
 * Seeds (or verifies, in dry-run) the fictional fixture records that
 * `evals/agent/quality/scenarios-v1.json` assumes exist in the eval user's
 * branch. Every fixture client/employee is tagged with a fixed, reserved
 * phone number in the `010-0000-01xx` range so it can be found again,
 * updated idempotently, and safely distinguished from real data.
 *
 * This script is deliberately Prisma-direct: it must NOT go through
 * application services/usecases/controllers/queues, the eformsign client, or
 * any message/notification/automation code, and must never insert into a
 * message/notification/automation/trigger/delivery table. See "Background-job
 * safety" in the module doc below for what the shared dev DB's schedulers
 * might otherwise do with these rows.
 *
 * CLI:
 *   pnpm exec ts-node scripts/agent/seed-chat-quality-fixtures.ts \
 *     --branch-id=<uuid> --database-url-sha=<12 hex> [--today=YYYY-MM-DD] [--apply]
 *
 * Default is a dry run: prints the plan (create/update/unchanged per row,
 * fictional names only) and exits 0 without writing. `--apply` performs the
 * writes in one transaction. `--database-url-sha` must equal the first 12 hex
 * characters of sha256(DATABASE_URL) — this makes the operator confirm the
 * target DB deliberately before anything, even a dry run, runs. Neither
 * DATABASE_URL nor any other .env value is ever printed.
 *
 * Background-job safety (report with file:line — see the task brief):
 *   - `MessageTriggerService.rebuildJobsForRule`
 *     (application/services/message-trigger.service.ts:1809-1837, invoked
 *     from the scheduler at message-trigger-scheduler.service.ts and from
 *     rule create/edit/activate) selects EVERY client in the branch with NO
 *     suppress filter when a trigger rule is created, edited, or activated.
 *     Fixture clients CANNOT be excluded from that selection. This script
 *     only warns: it prints a read-only count of the branch's active
 *     `message_trigger_rule` rows (global + branch-scoped) so the operator
 *     knows the blast radius before enabling/editing any rule while fixtures
 *     exist. `suppressGreetingSms: true` still prevents the *greeting*
 *     trigger specifically, and a non-null `serviceEndNoticeSentAt` would
 *     prevent a service-end-notice job from being built for a client — but
 *     neither prevents the SELECT itself, and this script does not set
 *     `serviceEndNoticeSentAt` because C9 is deliberately "ending soon" for
 *     the synthesis-2 scenario.
 *   - `EformsignDocReconcileSchedulerService` (00:00/06:00/12:00/18:00 KST,
 *     application/services/eformsign-doc-reconcile-scheduler.service.ts)
 *     re-reads documents from the real eformsign vendor API by vendor
 *     document id. Fixture documents (`chat-quality-fixture-*` ids) do not
 *     exist on the vendor, so the vendor never returns them and this sweep
 *     never touches fixture rows. Excluded structurally, not by a field.
 *   - `ContractAutoFinalizeSchedulerService`
 *     (application/services/contract-auto-finalize-scheduler.service.ts)
 *     only acts on review-stage (`070`, doc_request_reviewer) documents.
 *     Fixture docs use `003`/`060`, never `070` — excluded.
 *   - `ClientDueDateSchedulerService.copyUpcomingDueDatesToStartDates`
 *     (application/services/client-due-date-scheduler.service.ts:75-86) acts
 *     on clients with a non-null `dueDate` and a null `startDate`. This
 *     script leaves `client.dueDate` null on every fixture and always sets a
 *     `startDate` — excluded.
 *   - `ServiceRecordFinalizationSchedulerService` operates on
 *     `service_record_case` rows. This script creates none — excluded (no
 *     matching rows exist to select).
 *   - `EformsignMirrorReadinessService.inspect()` counts completed documents
 *     DB-wide without a current PDF file row. Fixture completed docs
 *     (`003`) are marked `syncStatus: "ready"` with `detailSyncedAt` and
 *     `detailSourceUpdatedDate` set, but this script adds no
 *     `eformsign_doc_file` rows, so each completed fixture doc (C1, C2, C9)
 *     adds 1 to `completedWithoutDocumentPdf`/`completedWithoutAuditTrailPdf`
 *     until real files are attached. The dry-run/apply output reports this
 *     count; no fake files are created to hide it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient, Prisma } from "@prisma/client";

// Relative imports (not the `domain/...` baseUrl form used elsewhere in this
// package) so this script also runs under a bare `ts-node` invocation without
// requiring `NODE_PATH=.` — see scripts/repair-eformsign-branch-ownership.ts
// for the same convention.
import { normalizePhone } from "../../domain/utils/normalize-phone";
import { isBusinessDayKr, isoDateInKorea } from "../../domain/utils/business-days";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** First 9 digits shared by every fixture phone; the last 2 digits identify the fixture. */
export const FIXTURE_PHONE_PREFIX9 = "010000001";
export const FIXTURE_PHONE_MARKER_MIN = "01000000100";
export const FIXTURE_PHONE_MARKER_MAX = "01000000199";
export const DOCUMENT_ID_PREFIX = "chat-quality-fixture-";
/** Must never exist anywhere in the branch — used by the eval's lookup-5 "not registered" scenario. */
export const MUST_NOT_EXIST_NAME = "표지안";

const CLIENT_PHONE_SUFFIX: Readonly<Record<string, string>> = {
    C1: "01", C2: "02", C3: "03", C4: "04", C5: "05", C6: "06", C7: "07", C8: "08", C9: "09",
};
const EMPLOYEE_PHONE_SUFFIX: Readonly<Record<string, string>> = {
    E1: "11", E2: "12", E3: "13", E4: "14",
};

function fixturePhoneDisplay(suffix: string): string {
    return `010-0000-01${suffix}`;
}

function fixturePhoneNormalized(suffix: string): string {
    const normalized = normalizePhone(fixturePhoneDisplay(suffix));
    if (!normalized) throw new Error(`Fixture phone suffix "${suffix}" did not normalize`);
    return normalized;
}

/** True when a normalized phone falls in the reserved fixture marker range. */
export function isFixtureMarkerPhone(phoneNormalized: string | null | undefined): boolean {
    if (!phoneNormalized) return false;
    return phoneNormalized >= FIXTURE_PHONE_MARKER_MIN && phoneNormalized <= FIXTURE_PHONE_MARKER_MAX;
}

// ---------------------------------------------------------------------------
// Date helpers (pure)
// ---------------------------------------------------------------------------

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertYmd(value: string, label: string): void {
    if (!YMD_RE.test(value)) throw new Error(`${label} must be a YYYY-MM-DD date, got "${value}"`);
}

function ymdToUtc(ymd: string): Date {
    const match = YMD_RE.exec(ymd);
    if (!match) throw new Error(`Invalid YYYY-MM-DD date "${ymd}"`);
    const [, y, m, d] = match;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

function utcToYmd(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function addDaysYmd(ymd: string, days: number): string {
    const date = ymdToUtc(ymd);
    date.setUTCDate(date.getUTCDate() + days);
    return utcToYmd(date);
}

/** Monday (ISO week start) of the week containing `ymd`. */
export function mondayOfWeek(ymd: string): string {
    const date = ymdToUtc(ymd);
    const dow = date.getUTCDay(); // 0=Sun..6=Sat
    const deltaToMonday = dow === 0 ? -6 : 1 - dow;
    return addDaysYmd(ymd, deltaToMonday);
}

/** Friday of the same ISO week as `ymd`. */
export function fridayOfWeek(ymd: string): string {
    return addDaysYmd(mondayOfWeek(ymd), 4);
}

/**
 * The next Monday strictly after `ymd` — if `ymd` itself is a Monday, this is
 * 7 days later, never the same day (a "starts next Monday" booking is always
 * in the future).
 */
export function nextMonday(ymd: string): string {
    const date = ymdToUtc(ymd);
    const dow = date.getUTCDay();
    const daysUntilNextMonday = ((1 - dow + 7) % 7) || 7;
    return addDaysYmd(ymd, daysUntilNextMonday);
}

/**
 * The date of the `count`-th Korean business day on or after `startYmd`
 * (inclusive: `startYmd` itself counts as day 1 if it is a business day).
 * Weekends and the shared KR public-holiday calendar are both skipped.
 */
export function nthBusinessDayOnOrAfter(startYmd: string, count: number): string {
    if (count < 1) throw new Error("count must be >= 1");
    let cursor = startYmd;
    let remaining = count;
    // Generous bound: even spanning a long holiday cluster, 10 business days
    // never require scanning more than a few weeks of calendar days.
    for (let i = 0; i < 60; i += 1) {
        if (isBusinessDayKr(cursor)) {
            remaining -= 1;
            if (remaining === 0) return cursor;
        }
        cursor = addDaysYmd(cursor, 1);
    }
    throw new Error(`Could not resolve business day ${count} from ${startYmd} within the search window`);
}

// ---------------------------------------------------------------------------
// Fixture data model
// ---------------------------------------------------------------------------

export interface FixtureClientSpec {
    readonly key: string;
    readonly name: string;
    readonly phone: string;
    readonly phoneNormalized: string;
    readonly address: string | null;
    readonly type: string | null;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly serviceStatus: string;
    readonly voucherClient: boolean;
    readonly suppressGreetingSms: boolean;
}

export interface FixtureEmployeeSpec {
    readonly key: string;
    readonly name: string;
    readonly phone: string;
    readonly phoneNormalized: string;
    readonly grade: string;
    readonly workArea: readonly string[];
    readonly openToNextWork: boolean;
}

export interface FixtureScheduleSpec {
    readonly clientKey: string;
    readonly primaryEmployeeKey: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly workAddress: string;
}

export interface FixtureContractDocSpec {
    readonly clientKey: string;
    readonly documentId: string;
    readonly documentName: string;
    readonly statusType: string;
    readonly statusDetail: string;
    readonly stepType: string;
    readonly stepIndex: string;
    readonly stepName: string;
    readonly stepRecipientType: string;
    readonly stepRecipientName: string;
    readonly stepRecipientSms: string;
    readonly customerPhone: string;
    readonly createdDate: string;
    readonly updatedDate: string;
    readonly expiredDate: string;
    readonly syncStatus: string;
    readonly detailSyncedAt: string;
    readonly detailSourceUpdatedDate: string;
}

export interface FixturePlan {
    readonly branchId: string;
    readonly today: string;
    readonly clients: readonly FixtureClientSpec[];
    readonly employees: readonly FixtureEmployeeSpec[];
    readonly schedules: readonly FixtureScheduleSpec[];
    readonly contractDocs: readonly FixtureContractDocSpec[];
}

const WORK_ADDRESS = "인천 서구 가정로 5 (테스트 근무지)";

/**
 * Builds the fictional fixture plan for one branch as of `today` (a
 * YYYY-MM-DD date, Asia/Seoul). Pure: no I/O, no clock reads — the caller
 * supplies `today`. See the brief's per-key table for the intent behind each
 * value; the amendments this function encodes:
 *  - contract codes: "003" = completed, "060" = in-progress-pending
 *    (backend/domain/utils/eformsign-status-code.ts).
 *  - employee.workArea is the real `String[]` column.
 *  - service status values from domain/value-objects/service-status.vo.ts;
 *    C4/C6/C8/C9 -> active, C5 -> waiting (schedule starts next Monday),
 *    C1/C2/C7 -> completed, C3 -> active (per the original per-row table).
 */
export function buildFixturePlan(today: string, branchId: string): FixturePlan {
    assertYmd(today, "today");
    if (!branchId) throw new Error("branchId is required");

    const thisMonday = mondayOfWeek(today);
    const thisFriday = fridayOfWeek(today);
    const nextMon = nextMonday(today);
    const c5End = nthBusinessDayOnOrAfter(nextMon, 10);
    const c9End = addDaysYmd(today, 3);

    const clients: FixtureClientSpec[] = [
        {
            key: "C1", name: "도하린",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C1"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C1"]!),
            address: "인천 서구 가정로 5", type: "A통합1형",
            startDate: "2026-07-20", endDate: "2026-07-31",
            serviceStatus: "completed", voucherClient: true, suppressGreetingSms: true,
        },
        {
            key: "C2", name: "서윤아",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C2"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C2"]!),
            address: "인천 남동구 구월동 1", type: "A통합1형",
            startDate: "2026-07-31", endDate: "2026-08-13",
            serviceStatus: "completed", voucherClient: true, suppressGreetingSms: true,
        },
        {
            key: "C3", name: "명수빈",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C3"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C3"]!),
            address: "인천 서구 가정로 7", type: "A통합1형",
            startDate: addDaysYmd(today, -14), endDate: addDaysYmd(today, 14),
            serviceStatus: "active", voucherClient: true, suppressGreetingSms: true,
        },
        {
            key: "C4", name: "여채린",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C4"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C4"]!),
            address: "인천 서구 가정로 9", type: "A통합1형",
            startDate: thisMonday, endDate: thisFriday,
            serviceStatus: "active", voucherClient: true, suppressGreetingSms: true,
        },
        {
            key: "C5", name: "봉하율",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C5"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C5"]!),
            address: "인천 서구 가정로 11", type: "A통합1형",
            startDate: nextMon, endDate: c5End,
            serviceStatus: "waiting", voucherClient: true, suppressGreetingSms: true,
        },
        {
            key: "C6", name: "문가온",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C6"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C6"]!),
            address: "인천 서구 가정로 13", type: "A통합1형",
            startDate: addDaysYmd(today, -5), endDate: addDaysYmd(today, 25),
            serviceStatus: "active", voucherClient: true, suppressGreetingSms: true,
        },
        {
            key: "C7", name: "탁은서",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C7"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C7"]!),
            address: "인천 서구 가정로 15", type: "A통합1형",
            startDate: addDaysYmd(today, -40), endDate: addDaysYmd(today, -10),
            serviceStatus: "completed", voucherClient: true, suppressGreetingSms: true,
        },
        {
            key: "C8", name: "채다온",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C8"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C8"]!),
            address: "인천 서구 가정로 17", type: "A통합1형",
            startDate: addDaysYmd(today, -3), endDate: addDaysYmd(today, 27),
            serviceStatus: "active", voucherClient: true, suppressGreetingSms: true,
        },
        {
            key: "C9", name: "금시우",
            phone: fixturePhoneDisplay(CLIENT_PHONE_SUFFIX["C9"]!),
            phoneNormalized: fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C9"]!),
            address: "인천 서구 가정로 19", type: "A통합1형",
            startDate: addDaysYmd(today, -27), endDate: c9End,
            serviceStatus: "active", voucherClient: true, suppressGreetingSms: true,
        },
    ];

    const employees: FixtureEmployeeSpec[] = [
        {
            key: "E1", name: "남궁솔",
            phone: fixturePhoneDisplay(EMPLOYEE_PHONE_SUFFIX["E1"]!),
            phoneNormalized: fixturePhoneNormalized(EMPLOYEE_PHONE_SUFFIX["E1"]!),
            grade: "스탠다드", workArea: ["남동구"], openToNextWork: false,
        },
        {
            key: "E2", name: "예소담",
            phone: fixturePhoneDisplay(EMPLOYEE_PHONE_SUFFIX["E2"]!),
            phoneNormalized: fixturePhoneNormalized(EMPLOYEE_PHONE_SUFFIX["E2"]!),
            grade: "스탠다드", workArea: ["서구"], openToNextWork: true,
        },
        {
            key: "E3", name: "탁은서",
            phone: fixturePhoneDisplay(EMPLOYEE_PHONE_SUFFIX["E3"]!),
            phoneNormalized: fixturePhoneNormalized(EMPLOYEE_PHONE_SUFFIX["E3"]!),
            grade: "스탠다드", workArea: ["서구"], openToNextWork: true,
        },
        {
            key: "E4", name: "백나래",
            phone: fixturePhoneDisplay(EMPLOYEE_PHONE_SUFFIX["E4"]!),
            phoneNormalized: fixturePhoneNormalized(EMPLOYEE_PHONE_SUFFIX["E4"]!),
            grade: "스탠다드", workArea: ["서구"], openToNextWork: true,
        },
    ];

    const schedules: FixtureScheduleSpec[] = [
        { clientKey: "C1", primaryEmployeeKey: "E2", startDate: "2026-07-20", endDate: "2026-07-31", workAddress: WORK_ADDRESS },
        { clientKey: "C4", primaryEmployeeKey: "E4", startDate: thisMonday, endDate: thisFriday, workAddress: WORK_ADDRESS },
        { clientKey: "C5", primaryEmployeeKey: "E4", startDate: nextMon, endDate: c5End, workAddress: WORK_ADDRESS },
        { clientKey: "C9", primaryEmployeeKey: "E4", startDate: addDaysYmd(today, -27), endDate: c9End, workAddress: WORK_ADDRESS },
    ];

    function doc(
        clientKey: string,
        variant: "completed" | "pending",
        recipientName: string,
        recipientPhoneNormalized: string,
    ): FixtureContractDocSpec {
        const nowIso = new Date(`${today}T09:00:00.000Z`).toISOString();
        const isCompleted = variant === "completed";
        return {
            clientKey,
            documentId: `${DOCUMENT_ID_PREFIX}${clientKey}`,
            documentName: "제공기록 계약서 (테스트)",
            statusType: isCompleted ? "003" : "060",
            statusDetail: isCompleted ? "완료" : "참여자 서명 요청",
            stepType: isCompleted ? "00" : "01",
            stepIndex: isCompleted ? "1" : "2",
            stepName: isCompleted ? "완료" : "산모 서명",
            stepRecipientType: "customer",
            stepRecipientName: recipientName,
            stepRecipientSms: recipientPhoneNormalized,
            customerPhone: recipientPhoneNormalized,
            createdDate: nowIso,
            updatedDate: nowIso,
            expiredDate: new Date(`${addDaysYmd(today, 30)}T09:00:00.000Z`).toISOString(),
            syncStatus: "ready",
            detailSyncedAt: nowIso,
            detailSourceUpdatedDate: nowIso,
        };
    }

    const contractDocs: FixtureContractDocSpec[] = [
        doc("C1", "completed", "도하린", fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C1"]!)),
        doc("C2", "completed", "서윤아", fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C2"]!)),
        doc("C3", "pending", "명수빈", fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C3"]!)),
        doc("C9", "completed", "금시우", fixturePhoneNormalized(CLIENT_PHONE_SUFFIX["C9"]!)),
    ];

    return { branchId, today, clients, employees, schedules, contractDocs };
}

// ---------------------------------------------------------------------------
// Existing-row shapes (as read from the DB) and diff
// ---------------------------------------------------------------------------

export interface ExistingClientRow {
    readonly id: number;
    readonly name: string;
    readonly phone: string | null;
    readonly phoneNormalized: string | null;
    readonly address: string | null;
    readonly type: string | null;
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly serviceStatus: string | null;
    readonly voucherClient: boolean;
    readonly suppressGreetingSms: boolean;
}

export interface ExistingEmployeeRow {
    readonly id: number;
    readonly name: string;
    readonly phone: string;
    readonly phoneNormalized: string | null;
    readonly grade: string;
    readonly workArea: readonly string[];
    readonly openToNextWork: boolean;
}

export interface ExistingScheduleRow {
    readonly id: number;
    readonly clientId: number;
    readonly primaryEmployeeId: number;
    readonly startDate: string;
    readonly endDate: string;
    readonly workAddress: string;
}

export interface ExistingContractDocRow {
    readonly id: number;
    readonly documentId: string;
    readonly statusType: string;
    readonly statusDetail: string;
    readonly stepType: string;
    readonly stepIndex: string;
    readonly stepName: string;
    readonly stepRecipientType: string;
    readonly stepRecipientName: string;
    readonly stepRecipientSms: string;
    readonly customerPhone: string | null;
    readonly syncStatus: string;
}

/**
 * Everything the diff needs, already fetched from the DB for the target
 * branch. `clientsWithFixtureNames`/`employeesWithFixtureNames` must include
 * every row in the branch whose name matches ANY fixture name, regardless of
 * phone (this is what makes the "fixture name with a non-marker phone"
 * refusal possible). `otherMarkerPhoneRows` must include every row in the
 * branch (client or employee) whose phoneNormalized is in the marker range,
 * regardless of name.
 */
export interface ExistingState {
    readonly clientsWithFixtureNames: readonly ExistingClientRow[];
    readonly employeesWithFixtureNames: readonly ExistingEmployeeRow[];
    readonly otherMarkerPhoneClientRows: readonly { name: string; phoneNormalized: string }[];
    readonly otherMarkerPhoneEmployeeRows: readonly { name: string; phoneNormalized: string }[];
    readonly mustNotExistNameCount: number;
    readonly schedules: readonly ExistingScheduleRow[];
    readonly contractDocs: readonly ExistingContractDocRow[];
}

export type DiffKind = "create" | "update" | "unchanged";

export interface FixtureDiffEntry<TSpec> {
    readonly kind: DiffKind;
    readonly key: string;
    readonly spec: TSpec;
    readonly existingId: number | null;
    readonly changedFields: readonly string[];
}

export interface FixtureDiff {
    readonly clients: readonly FixtureDiffEntry<FixtureClientSpec>[];
    readonly employees: readonly FixtureDiffEntry<FixtureEmployeeSpec>[];
    readonly schedules: readonly FixtureDiffEntry<FixtureScheduleSpec>[];
    readonly contractDocs: readonly FixtureDiffEntry<FixtureContractDocSpec>[];
    /** Non-empty means: refuse before any write. */
    readonly refusals: readonly string[];
}

function clientFieldChanges(spec: FixtureClientSpec, existing: ExistingClientRow): string[] {
    const changed: string[] = [];
    if (existing.phone !== spec.phone) changed.push("phone");
    if (existing.phoneNormalized !== spec.phoneNormalized) changed.push("phoneNormalized");
    if (existing.address !== spec.address) changed.push("address");
    if (existing.type !== spec.type) changed.push("type");
    if (existing.startDate !== spec.startDate) changed.push("startDate");
    if (existing.endDate !== spec.endDate) changed.push("endDate");
    if (existing.serviceStatus !== spec.serviceStatus) changed.push("serviceStatus");
    if (existing.voucherClient !== spec.voucherClient) changed.push("voucherClient");
    if (existing.suppressGreetingSms !== spec.suppressGreetingSms) changed.push("suppressGreetingSms");
    return changed;
}

function employeeFieldChanges(spec: FixtureEmployeeSpec, existing: ExistingEmployeeRow): string[] {
    const changed: string[] = [];
    if (existing.phone !== spec.phone) changed.push("phone");
    if (existing.phoneNormalized !== spec.phoneNormalized) changed.push("phoneNormalized");
    if (existing.grade !== spec.grade) changed.push("grade");
    if (JSON.stringify([...existing.workArea]) !== JSON.stringify([...spec.workArea])) changed.push("workArea");
    if (existing.openToNextWork !== spec.openToNextWork) changed.push("openToNextWork");
    return changed;
}

function scheduleFieldChanges(spec: FixtureScheduleSpec, existing: ExistingScheduleRow): string[] {
    const changed: string[] = [];
    if (existing.startDate !== spec.startDate) changed.push("startDate");
    if (existing.endDate !== spec.endDate) changed.push("endDate");
    if (existing.workAddress !== spec.workAddress) changed.push("workAddress");
    return changed;
}

function docFieldChanges(spec: FixtureContractDocSpec, existing: ExistingContractDocRow): string[] {
    const changed: string[] = [];
    if (existing.statusType !== spec.statusType) changed.push("statusType");
    if (existing.statusDetail !== spec.statusDetail) changed.push("statusDetail");
    if (existing.stepType !== spec.stepType) changed.push("stepType");
    if (existing.stepIndex !== spec.stepIndex) changed.push("stepIndex");
    if (existing.stepName !== spec.stepName) changed.push("stepName");
    if (existing.stepRecipientType !== spec.stepRecipientType) changed.push("stepRecipientType");
    if (existing.stepRecipientName !== spec.stepRecipientName) changed.push("stepRecipientName");
    if (existing.stepRecipientSms !== spec.stepRecipientSms) changed.push("stepRecipientSms");
    if (existing.customerPhone !== spec.customerPhone) changed.push("customerPhone");
    if (existing.syncStatus !== spec.syncStatus) changed.push("syncStatus");
    return changed;
}

/**
 * Diffs the pure plan against already-fetched DB state. Pure: no I/O. Refuses
 * (returns non-empty `refusals`, meaning: caller must not write anything) if:
 *  - `표지안` exists anywhere in the branch (must never exist — lookup-5's
 *    "not registered" fixture);
 *  - a fixture name exists in the branch with a phone different from that
 *    fixture's fixed marker phone (never touch a non-fixture row that
 *    happens to share a fixture's name);
 *  - any OTHER row in the branch (not the matching fixture) holds a phone in
 *    the reserved marker range (010000001xx) — a stale/foreign marker
 *    collision, since `phoneNormalized` is unique per branch.
 */
export function diffAgainstExisting(plan: FixturePlan, existing: ExistingState): FixtureDiff {
    const refusals: string[] = [];

    if (existing.mustNotExistNameCount > 0) {
        refusals.push(`"${MUST_NOT_EXIST_NAME}" exists in branch ${plan.branchId}; it must never exist (lookup-5 fixture)`);
    }

    const clientByName = new Map(existing.clientsWithFixtureNames.map((row) => [row.name, row] as const));
    const employeeByName = new Map<string, ExistingEmployeeRow[]>();
    for (const row of existing.employeesWithFixtureNames) {
        const list = employeeByName.get(row.name) ?? [];
        list.push(row);
        employeeByName.set(row.name, list);
    }

    const clientKeyByDbId = new Map<number, string>();
    const clientEntries: FixtureDiffEntry<FixtureClientSpec>[] = [];
    for (const spec of plan.clients) {
        const existingRow = clientByName.get(spec.name);
        if (!existingRow) {
            clientEntries.push({ kind: "create", key: spec.key, spec, existingId: null, changedFields: [] });
            continue;
        }
        if (existingRow.phoneNormalized !== spec.phoneNormalized) {
            refusals.push(
                `Client "${spec.name}" already exists (id ${existingRow.id}) with phone `
                + `${existingRow.phoneNormalized ?? "(none)"}, not this fixture's marker phone ${spec.phoneNormalized}; refusing to touch it`,
            );
            continue;
        }
        clientKeyByDbId.set(existingRow.id, spec.key);
        const changedFields = clientFieldChanges(spec, existingRow);
        clientEntries.push({
            kind: changedFields.length > 0 ? "update" : "unchanged",
            key: spec.key, spec, existingId: existingRow.id, changedFields,
        });
    }

    const employeeKeyByDbId = new Map<number, string>();
    const employeeEntries: FixtureDiffEntry<FixtureEmployeeSpec>[] = [];
    for (const spec of plan.employees) {
        const candidates = employeeByName.get(spec.name) ?? [];
        // Deliberate ambiguous pair (E3 남궁솔 vs C7 style names) lives across
        // tables, not within `employee`, so within this table a fixture name
        // must match exactly one existing row to be treated as "the fixture".
        const existingRow = candidates.find((row) => row.phoneNormalized === spec.phoneNormalized)
            ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (!existingRow) {
            employeeEntries.push({ kind: "create", key: spec.key, spec, existingId: null, changedFields: [] });
            continue;
        }
        if (existingRow.phoneNormalized !== spec.phoneNormalized) {
            refusals.push(
                `Employee "${spec.name}" already exists (id ${existingRow.id}) with phone `
                + `${existingRow.phoneNormalized ?? "(none)"}, not this fixture's marker phone ${spec.phoneNormalized}; refusing to touch it`,
            );
            continue;
        }
        employeeKeyByDbId.set(existingRow.id, spec.key);
        const changedFields = employeeFieldChanges(spec, existingRow);
        employeeEntries.push({
            kind: changedFields.length > 0 ? "update" : "unchanged",
            key: spec.key, spec, existingId: existingRow.id, changedFields,
        });
    }

    for (const row of existing.otherMarkerPhoneClientRows) {
        if (!plan.clients.some((spec) => spec.phoneNormalized === row.phoneNormalized)) {
            refusals.push(
                `Client "${row.name}" holds a marker-range phone (${row.phoneNormalized}) that does not belong `
                + "to any fixture in this plan; refusing (stale or foreign marker collision)",
            );
        }
    }
    for (const row of existing.otherMarkerPhoneEmployeeRows) {
        if (!plan.employees.some((spec) => spec.phoneNormalized === row.phoneNormalized)) {
            refusals.push(
                `Employee "${row.name}" holds a marker-range phone (${row.phoneNormalized}) that does not belong `
                + "to any fixture in this plan; refusing (stale or foreign marker collision)",
            );
        }
    }

    const scheduleByPair = new Map(
        existing.schedules.map((row) => [`${row.clientId}:${row.primaryEmployeeId}`, row] as const),
    );
    const scheduleEntries: FixtureDiffEntry<FixtureScheduleSpec>[] = [];
    if (refusals.length === 0) {
        for (const spec of plan.schedules) {
            const clientDbId = [...clientKeyByDbId.entries()].find(([, key]) => key === spec.clientKey)?.[0];
            const employeeDbId = [...employeeKeyByDbId.entries()].find(([, key]) => key === spec.primaryEmployeeKey)?.[0];
            const existingRow = clientDbId !== undefined && employeeDbId !== undefined
                ? scheduleByPair.get(`${clientDbId}:${employeeDbId}`)
                : undefined;
            if (!existingRow) {
                scheduleEntries.push({
                    kind: "create", key: `${spec.clientKey}-${spec.primaryEmployeeKey}`, spec, existingId: null, changedFields: [],
                });
                continue;
            }
            const changedFields = scheduleFieldChanges(spec, existingRow);
            scheduleEntries.push({
                kind: changedFields.length > 0 ? "update" : "unchanged",
                key: `${spec.clientKey}-${spec.primaryEmployeeKey}`, spec, existingId: existingRow.id, changedFields,
            });
        }
    }

    const docByDocumentId = new Map(existing.contractDocs.map((row) => [row.documentId, row] as const));
    const docEntries: FixtureDiffEntry<FixtureContractDocSpec>[] = [];
    for (const spec of plan.contractDocs) {
        const existingRow = docByDocumentId.get(spec.documentId);
        if (!existingRow) {
            docEntries.push({ kind: "create", key: spec.clientKey, spec, existingId: null, changedFields: [] });
            continue;
        }
        const changedFields = docFieldChanges(spec, existingRow);
        docEntries.push({
            kind: changedFields.length > 0 ? "update" : "unchanged",
            key: spec.clientKey, spec, existingId: existingRow.id, changedFields,
        });
    }

    return { clients: clientEntries, employees: employeeEntries, schedules: scheduleEntries, contractDocs: docEntries, refusals };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
    readonly branchId: string;
    readonly databaseUrlSha: string;
    readonly today: string | undefined;
    readonly apply: boolean;
}

export class CliUsageError extends Error {}

export function parseCliArgs(argv: readonly string[]): CliOptions {
    let branchId: string | undefined;
    let databaseUrlSha: string | undefined;
    let today: string | undefined;
    let apply = false;

    for (const arg of argv) {
        if (arg === "--apply") { apply = true; continue; }
        const match = /^(--branch-id|--database-url-sha|--today)=(.*)$/.exec(arg);
        if (!match) throw new CliUsageError(`Unrecognized argument "${arg}"`);
        const [, flag, value] = match;
        if (flag === "--branch-id") branchId = value;
        else if (flag === "--database-url-sha") databaseUrlSha = value;
        else if (flag === "--today") today = value;
    }

    if (!branchId) throw new CliUsageError("--branch-id is required");
    if (!databaseUrlSha) throw new CliUsageError("--database-url-sha is required");
    if (!/^[0-9a-f]{12}$/.test(databaseUrlSha)) {
        throw new CliUsageError("--database-url-sha must be exactly 12 lowercase hex characters");
    }
    if (today !== undefined) assertYmd(today, "--today");

    return { branchId, databaseUrlSha, today, apply };
}

async function sha256Hex12(value: string): Promise<string> {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function printPlan(diff: FixtureDiff, warnings: readonly string[]): void {
    console.log("=== Chat-quality fixture plan (fictional names only) ===");
    for (const [label, entries] of [
        ["clients", diff.clients] as const,
        ["employees", diff.employees] as const,
        ["schedules", diff.schedules] as const,
        ["contractDocs", diff.contractDocs] as const,
    ]) {
        console.log(`-- ${label} --`);
        for (const entry of entries) {
            const detail = entry.kind === "update" ? ` (${entry.changedFields.join(", ")})` : "";
            console.log(`  ${entry.kind.padEnd(9)} ${entry.key}${detail}`);
        }
    }
    if (warnings.length > 0) {
        console.log("=== Warnings ===");
        for (const warning of warnings) console.log(`  - ${warning}`);
    }
}

async function loadExistingState(prisma: PrismaClient, plan: FixturePlan): Promise<ExistingState> {
    const clientNames = plan.clients.map((c) => c.name);
    const employeeNames = plan.employees.map((e) => e.name);
    const fixtureNormalizedPhones = [...plan.clients.map((c) => c.phoneNormalized), ...plan.employees.map((e) => e.phoneNormalized)];

    const [clientsWithFixtureNamesRaw, employeesWithFixtureNamesRaw, otherMarkerClientsRaw, otherMarkerEmployeesRaw, mustNotExistCount] = await Promise.all([
        prisma.client.findMany({
            where: { branchId: plan.branchId, name: { in: clientNames } },
            select: { id: true, name: true, phone: true, phoneNormalized: true, address: true, type: true, startDate: true, endDate: true, serviceStatus: true, voucherClient: true, suppressGreetingSms: true },
        }),
        prisma.employee.findMany({
            where: { branchId: plan.branchId, name: { in: employeeNames } },
            select: { id: true, name: true, phone: true, phoneNormalized: true, grade: true, workArea: true, openToNextWork: true },
        }),
        prisma.client.findMany({
            where: { branchId: plan.branchId, phoneNormalized: { gte: FIXTURE_PHONE_MARKER_MIN, lte: FIXTURE_PHONE_MARKER_MAX } },
            select: { name: true, phoneNormalized: true },
        }),
        prisma.employee.findMany({
            where: { branchId: plan.branchId, phoneNormalized: { gte: FIXTURE_PHONE_MARKER_MIN, lte: FIXTURE_PHONE_MARKER_MAX } },
            select: { name: true, phoneNormalized: true },
        }),
        prisma.client.count({ where: { branchId: plan.branchId, name: MUST_NOT_EXIST_NAME } }),
    ]);

    const clientsWithFixtureNames: ExistingClientRow[] = clientsWithFixtureNamesRaw.map((row) => ({
        id: row.id, name: row.name, phone: row.phone, phoneNormalized: row.phoneNormalized,
        address: row.address, type: row.type,
        startDate: row.startDate ? row.startDate.toISOString().slice(0, 10) : null,
        endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
        serviceStatus: row.serviceStatus, voucherClient: row.voucherClient, suppressGreetingSms: row.suppressGreetingSms,
    }));
    const employeesWithFixtureNames: ExistingEmployeeRow[] = employeesWithFixtureNamesRaw.map((row) => ({
        id: row.id, name: row.name, phone: row.phone, phoneNormalized: row.phoneNormalized,
        grade: row.grade, workArea: row.workArea, openToNextWork: row.openToNextWork,
    }));

    const clientIds = clientsWithFixtureNames
        .filter((row) => fixtureNormalizedPhones.includes(row.phoneNormalized ?? ""))
        .map((row) => row.id);
    const employeeIds = employeesWithFixtureNames
        .filter((row) => fixtureNormalizedPhones.includes(row.phoneNormalized ?? ""))
        .map((row) => row.id);

    const [schedulesRaw, docsRaw] = await Promise.all([
        clientIds.length > 0 && employeeIds.length > 0
            ? prisma.employee_schedule.findMany({
                where: { branchId: plan.branchId, clientId: { in: clientIds }, primaryEmployeeId: { in: employeeIds } },
                select: { id: true, clientId: true, primaryEmployeeId: true, startDate: true, endDate: true, workAddress: true },
            })
            : Promise.resolve([]),
        prisma.eformsign_doc.findMany({
            where: { branchId: plan.branchId, documentId: { startsWith: DOCUMENT_ID_PREFIX } },
            select: { id: true, documentId: true, statusType: true, statusDetail: true, stepType: true, stepIndex: true, stepName: true, stepRecipientType: true, stepRecipientName: true, stepRecipientSms: true, customerPhone: true, syncStatus: true },
        }),
    ]);

    const schedules: ExistingScheduleRow[] = schedulesRaw.map((row) => ({
        id: row.id, clientId: row.clientId, primaryEmployeeId: row.primaryEmployeeId,
        startDate: row.startDate.toISOString().slice(0, 10), endDate: row.endDate.toISOString().slice(0, 10),
        workAddress: row.workAddress,
    }));
    const contractDocs: ExistingContractDocRow[] = docsRaw.map((row) => ({
        id: row.id, documentId: row.documentId, statusType: row.statusType, statusDetail: row.statusDetail,
        stepType: row.stepType, stepIndex: row.stepIndex, stepName: row.stepName,
        stepRecipientType: row.stepRecipientType, stepRecipientName: row.stepRecipientName,
        stepRecipientSms: row.stepRecipientSms, customerPhone: row.customerPhone, syncStatus: row.syncStatus,
    }));

    return {
        clientsWithFixtureNames,
        employeesWithFixtureNames,
        otherMarkerPhoneClientRows: otherMarkerClientsRaw.map((r) => ({ name: r.name, phoneNormalized: r.phoneNormalized ?? "" })),
        otherMarkerPhoneEmployeeRows: otherMarkerEmployeesRaw.map((r) => ({ name: r.name, phoneNormalized: r.phoneNormalized ?? "" })),
        mustNotExistNameCount: mustNotExistCount,
        schedules,
        contractDocs,
    };
}

async function applyPlan(prisma: PrismaClient, plan: FixturePlan, diff: FixtureDiff): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const clientDbIdByKey = new Map<string, number>();
        for (const entry of diff.clients) {
            const spec = entry.spec;
            const data = {
                name: spec.name, phone: spec.phone, phoneNormalized: spec.phoneNormalized,
                address: spec.address, type: spec.type,
                startDate: spec.startDate ? new Date(`${spec.startDate}T00:00:00.000Z`) : null,
                endDate: spec.endDate ? new Date(`${spec.endDate}T00:00:00.000Z`) : null,
                serviceStatus: spec.serviceStatus, voucherClient: spec.voucherClient,
                suppressGreetingSms: spec.suppressGreetingSms, branchId: plan.branchId,
            };
            if (entry.kind === "create") {
                const created = await tx.client.create({ data });
                clientDbIdByKey.set(entry.key, created.id);
            } else {
                clientDbIdByKey.set(entry.key, entry.existingId!);
                if (entry.kind === "update") {
                    await tx.client.update({ where: { id: entry.existingId! }, data });
                }
            }
        }

        const employeeDbIdByKey = new Map<string, number>();
        for (const entry of diff.employees) {
            const spec = entry.spec;
            const data = {
                name: spec.name, phone: spec.phone, phoneNormalized: spec.phoneNormalized,
                grade: spec.grade, workArea: [...spec.workArea], openToNextWork: spec.openToNextWork,
                branchId: plan.branchId,
            };
            if (entry.kind === "create") {
                const created = await tx.employee.create({ data });
                employeeDbIdByKey.set(entry.key, created.id);
            } else {
                employeeDbIdByKey.set(entry.key, entry.existingId!);
                if (entry.kind === "update") {
                    await tx.employee.update({ where: { id: entry.existingId! }, data });
                }
            }
        }

        for (const entry of diff.schedules) {
            const spec = entry.spec;
            const clientId = clientDbIdByKey.get(spec.clientKey);
            const primaryEmployeeId = employeeDbIdByKey.get(spec.primaryEmployeeKey);
            if (clientId === undefined || primaryEmployeeId === undefined) {
                throw new Error(`Could not resolve schedule participants for ${spec.clientKey}/${spec.primaryEmployeeKey}`);
            }
            const data = {
                startDate: new Date(`${spec.startDate}T00:00:00.000Z`),
                endDate: new Date(`${spec.endDate}T00:00:00.000Z`),
                workAddress: spec.workAddress,
            };
            if (entry.kind === "create") {
                // incarnationId is never written explicitly: it has its own
                // DB default and a trigger rejects any UPDATE that touches it
                // (employee_schedule_incarnation_immutable).
                await tx.employee_schedule.create({ data: { ...data, clientId, primaryEmployeeId, branchId: plan.branchId } });
            } else if (entry.kind === "update") {
                await tx.employee_schedule.update({ where: { id: entry.existingId! }, data });
            }
        }

        for (const entry of diff.contractDocs) {
            const spec = entry.spec;
            const clientId = clientDbIdByKey.get(spec.clientKey);
            const data = {
                documentName: spec.documentName,
                customerName: spec.stepRecipientName,
                customerPhone: spec.customerPhone,
                statusType: spec.statusType, statusDetail: spec.statusDetail,
                stepType: spec.stepType, stepIndex: spec.stepIndex, stepName: spec.stepName,
                stepRecipientType: spec.stepRecipientType, stepRecipientName: spec.stepRecipientName,
                stepRecipientSms: spec.stepRecipientSms,
                createdDate: new Date(spec.createdDate), updatedDate: new Date(spec.updatedDate),
                expiredDate: new Date(spec.expiredDate),
                syncStatus: spec.syncStatus,
                detailSyncedAt: new Date(spec.detailSyncedAt),
                detailSourceUpdatedDate: new Date(spec.detailSourceUpdatedDate),
                documentKind: null,
                clientId: clientId ?? null,
                branchId: plan.branchId,
            };
            if (entry.kind === "create") {
                await tx.eformsign_doc.create({ data: { ...data, documentId: spec.documentId } });
            } else if (entry.kind === "update") {
                await tx.eformsign_doc.update({ where: { id: entry.existingId! }, data });
            }
        }
    });
}

const COMPLETED_STATUS_TYPES: ReadonlySet<string> = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);

async function countActiveMessageTriggerRules(prisma: PrismaClient, branchId: string): Promise<number> {
    return prisma.message_trigger_rule.count({
        where: { isActive: true, OR: [{ branchId }, { branchId: null }] },
    });
}

async function inspectMirrorReadinessImpact(prisma: PrismaClient): Promise<{ completedWithoutDocumentPdf: number }> {
    const completedRows = await prisma.eformsign_doc.findMany({
        where: { statusType: { in: [...COMPLETED_STATUS_TYPES] } },
        select: { syncStatus: true, detailSourceUpdatedDate: true, files: { select: { fileType: true, sourceUpdatedDate: true } } },
    });
    const hasCurrentFile = (row: (typeof completedRows)[number], fileType: "document" | "audit_trail"): boolean =>
        row.syncStatus === "ready"
        && row.detailSourceUpdatedDate !== null
        && row.files.some((f) => f.fileType === fileType && f.sourceUpdatedDate.getTime() === row.detailSourceUpdatedDate!.getTime());
    const completedWithoutDocumentPdf = completedRows.filter((row) => !hasCurrentFile(row, "document")).length;
    return { completedWithoutDocumentPdf };
}

async function main(argv: readonly string[]): Promise<number> {
    let options: CliOptions;
    try {
        options = parseCliArgs(argv);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }

    if (!process.env["DATABASE_URL"]) {
        try {
            process.loadEnvFile(resolve(__dirname, "..", "..", ".env"));
        } catch {
            // fall through; requireEnv-equivalent check below will fail loud
        }
    }
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
        console.error("DATABASE_URL is not set (checked process.env and backend/.env)");
        return 1;
    }
    const actualSha = await sha256Hex12(databaseUrl);
    if (actualSha !== options.databaseUrlSha) {
        console.error("--database-url-sha does not match the first 12 hex chars of sha256(DATABASE_URL); refusing");
        return 1;
    }

    const prisma = new PrismaClient();
    try {
        const branch = await prisma.branch.findUnique({ where: { id: options.branchId } });
        if (!branch) {
            console.error(`Branch ${options.branchId} does not exist; refusing`);
            return 1;
        }

        const today = options.today ?? isoDateInKorea();
        const plan = buildFixturePlan(today, options.branchId);
        const existing = await loadExistingState(prisma, plan);
        const diff = diffAgainstExisting(plan, existing);

        if (diff.refusals.length > 0) {
            console.error("Refusing before any write:");
            for (const reason of diff.refusals) console.error(`  - ${reason}`);
            return 1;
        }

        const activeTriggerRuleCount = await countActiveMessageTriggerRules(prisma, options.branchId);
        const mirrorImpact = await inspectMirrorReadinessImpact(prisma);
        const warnings = [
            `Branch has ${activeTriggerRuleCount} active message_trigger_rule row(s) (global + branch-scoped). `
            + "rebuildJobsForRule selects EVERY client in the branch with no suppress filter when a rule is "
            + "created/edited/activated — fixture clients WILL be included in rule jobs if any rule fires.",
            `EformsignMirrorReadinessService.inspect() currently reports completedWithoutDocumentPdf=${mirrorImpact.completedWithoutDocumentPdf} `
            + `DB-wide; each completed fixture doc created by this plan adds 1 (${diff.contractDocs.filter((entry) => entry.kind === "create" && COMPLETED_STATUS_TYPES.has(entry.spec.statusType)).length} here), since this script adds no eformsign_doc_file rows.`,
        ];

        printPlan(diff, warnings);

        if (!options.apply) {
            console.log("Dry run: no database changes made.");
            return 0;
        }

        await applyPlan(prisma, plan, diff);
        console.log("Applied.");
        return 0;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    void (async () => {
        try {
            process.exitCode = await main(process.argv.slice(2));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    })();
}

export { main };
// Re-export for tests that want to construct a Prisma-shaped fake without pulling in @prisma/client types.
export type { Prisma };
