import { ConflictException, HttpException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync, type ValidationError } from "class-validator";
import { z } from "zod";

import type { AgentActionPreview } from "@babyjamjam/shared";
import { AgentActionCertainFailureError, AgentActionQuestionError } from "application/agent/action-coordinator.service";
import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import { CAPABILITY_CATALOG_BY_NAME } from "application/agent/capability-catalog";
import type {
    AgentCapabilityProviderContract,
    AgentProposalInspection,
    AgentReconciliationOutcome,
    AgentTargetRevalidation,
    CapabilityDefinition,
} from "application/agent/capability.types";
import type { AgentContext } from "application/agent/agent-context";
import type { ServiceRecordEditPreviewWithResume } from "application/policies/service-record-edit-preview.policy";
import { classifyPeriodOwnership, isSupersededAssignment } from "application/policies/service-record-period-ownership.policy";
import { AdminServiceRecordEditService } from "application/services/admin-service-record-edit.service";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import type {
    ServiceRecordEditConfirmPlan,
    ServiceRecordEditDraft,
    ServiceRecordEditSource,
} from "domain/repositories/service-record-edit.repository.interface";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { UpdateServiceRecordEditDraftDto } from "interface/dto/admin-service-record-edit.dto";

const OPERATION_KINDS = ["resumeReplan", "dateMove", "schedule", "sessionContent", "header"] as const;
type OperationKind = (typeof OPERATION_KINDS)[number];

/** Fields each kind may carry; anything else on an operation is a mistake worth reporting. */
const FIELDS_BY_KIND: Record<OperationKind, readonly string[]> = {
    resumeReplan: ["fromSessionIndex", "pauseStartDate", "resumeDate", "outgoingLastServedDate", "incomingAssignmentId", "incomingEmployeeId"],
    dateMove: ["sessionIndex", "toDate", "shiftFollowing"],
    schedule: ["serviceDays", "dates"],
    sessionContent: ["sessionIndex", "answers", "etcService", "notes", "paymentConfirmed"],
    header: ["header"],
};

const HeaderFieldsSchema = z.object({
    momName: z.string().optional(),
    momBirth: z.string().optional().describe("YYYY-MM-DD"),
    babyName: z.string().optional(),
    babyBirth: z.string().optional().describe("YYYY-MM-DD"),
    deliveryType: z.string().optional(),
    babyWeight: z.string().optional(),
});

// Shape only: which fields a kind needs, and the editor's own validators, are judged in
// `inspect` so a missing fact becomes a question for the user instead of an empty form.
const OperationSchema = z.object({
    kind: z.enum(OPERATION_KINDS),
    fromSessionIndex: z.number().optional().describe("resumeReplan: 1-based index of the first 회차 that moves"),
    pauseStartDate: z.string().optional().describe("resumeReplan: YYYY-MM-DD first day of the pause; used instead of fromSessionIndex"),
    resumeDate: z.string().optional().describe("resumeReplan: YYYY-MM-DD first service day after the pause"),
    outgoingLastServedDate: z.string().optional().describe("resumeReplan: YYYY-MM-DD last day the outgoing 관리사 served"),
    incomingAssignmentId: z.string().optional().describe("resumeReplan: service-record assignment UUID if known; prefer incomingEmployeeId from employees.search"),
    incomingEmployeeId: z.number().int().positive().optional().describe("resumeReplan: new 관리사 employee id from employees.search; omit both handover fields when the same 관리사 continues or only one successor exists"),
    sessionIndex: z.number().optional().describe("dateMove / sessionContent: 1-based 회차 index"),
    toDate: z.string().optional().describe("dateMove: YYYY-MM-DD"),
    shiftFollowing: z.boolean().optional().describe("dateMove: move the following 회차 as well"),
    serviceDays: z.object({
        saturday: z.boolean().optional(),
        sunday: z.boolean().optional(),
        holiday: z.boolean().optional(),
    }).optional().describe("schedule: which non-weekday days the client accepts service on"),
    dates: z.array(z.string()).optional().describe("schedule: one YYYY-MM-DD date per 회차, in order"),
    answers: z.record(z.string(), z.unknown()).optional().describe("sessionContent: answers to change, one key per question"),
    etcService: z.string().optional(),
    notes: z.string().optional(),
    paymentConfirmed: z.boolean().optional(),
    header: HeaderFieldsSchema.optional().describe("header: only the fields to change"),
});
type Operation = z.infer<typeof OperationSchema>;

const InputSchema = z.object({
    clientId: z.number().optional().describe("The client's numeric id, resolved with clients.search"),
    operations: z.array(OperationSchema).max(20).optional(),
});
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
    status: z.enum(["confirmed", "no_changes"]),
    caseId: z.string(),
    clientId: z.number(),
    draftId: z.string(),
    revisionId: z.string().nullable(),
    revisionNumber: z.number().nullable(),
    documentStatus: z.string(),
    confirmedAt: z.string(),
});

const TargetSnapshotSchema = z.object({
    clientId: z.number(),
    caseId: z.string(),
    sourceCaseVersion: z.number(),
    sourceFingerprint: z.string(),
    operations: z.array(OperationSchema).min(1),
});
type TargetSnapshot = z.infer<typeof TargetSnapshotSchema>;

type EditorRequest = Pick<UpdateServiceRecordEditDraftDto, "changes" | "dateMove" | "schedule" | "resumeReplan">;
type Preview = ServiceRecordEditPreviewWithResume & { previewId: string };

const MAX_PREVIEW_SECTIONS = 10;
const MAX_PREVIEW_ROWS = 60;
const MAX_PREVIEW_LABEL = 80;
const MAX_PREVIEW_TEXT = 200;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const HEADER_LABELS: Record<string, string> = {
    momName: "산모 이름",
    momBirth: "산모 생년월일",
    babyName: "신생아 이름",
    babyBirth: "신생아 출생일",
    deliveryType: "분만 형태",
    babyWeight: "신생아 몸무게",
};
const SERVICE_DAY_LABELS: Array<["saturday" | "sunday" | "holiday", string]> = [
    ["saturday", "토요일 서비스"],
    ["sunday", "일요일 서비스"],
    ["holiday", "공휴일 서비스"],
];

/** What to tell the model for the editor codes it can act on; every other code relays the editor's message. */
const CODE_HINTS: Record<string, string> = {
    RESUME_DATE_NOT_BUSINESS_DAY: "재개일이 영업일이 아니에요. 사용자에게 재개할 날짜를 다시 물어보세요.",
    INVALID_DATE: "날짜가 올바르지 않아요(없는 날짜이거나 유지되는 회차 이전이에요). 사용자에게 날짜를 다시 확인하세요.",
    INVALID_SESSION_INDEX: "회차 번호가 범위를 벗어났어요. 사용자에게 몇 회차인지 다시 확인하세요.",
    RESUME_REPLAN_COMBINATION: "재개 일정 재배치는 날짜 이동·일정 전체 변경·회차별 날짜 변경과 함께 요청할 수 없어요. 하나씩 나눠 요청하거나 한 가지 방식만 쓰세요.",
    OUTGOING_LAST_SERVED_OUT_OF_RANGE: "기존 관리사의 마지막 근무일이 범위를 벗어났어요. 사용자에게 마지막 근무일을 다시 확인하세요.",
    INCOMING_ASSIGNMENT_INVALID: "지정한 관리사 배정이 올바르지 않아요. 같은 관리사가 계속하는 단순 중단이면 incomingEmployeeId와 incomingAssignmentId를 빼고 다시 호출하고, 다른 관리사가 맡는다면 후보 중에서 고르세요.",
    INCOMING_ASSIGNMENT_REQUIRED: "재개 후 일할 관리사를 정해야 해요. 사용자에게 아래 후보 중 누구인지 물어본 뒤, 그 관리사의 employeeId를 resumeReplan 작업의 incomingEmployeeId로 넣어 다시 호출하세요.",
    SCHEDULE_WITH_DATE_MOVE: "일정 전체 변경은 날짜 이동·회차별 날짜 변경과 함께 요청할 수 없어요.",
    UNSUPPORTED_HOLIDAY_YEAR: "공휴일 정보가 없는 연도의 날짜는 선택할 수 없어요. 사용자에게 다른 날짜를 물어보세요.",
    CASE_FINALIZED: "이미 최종 확정된 제공기록지라 회차를 다시 계획할 수 없어요.",
    SERVICE_RECORD_WRITE_TARGET_CHANGED: "그 사이 제공기록지가 바뀌었어요. 처음부터 다시 요청해 주세요.",
    REQUEST_NOT_PENDING: "제공기록지 임시 초안이 더 이상 유효하지 않아요. 처음부터 다시 요청해 주세요.",
};

interface Candidate {
    employeeId: number;
    employeeName: string | null;
}

/** A value that cannot be shown on the approval card in full; the card never truncates approved content. */
class CardOverflowError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function formatKst(instant: Date): string {
    return `${new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ")} KST`;
}

function formatKstFromIso(value: string | null | undefined): string | null {
    if (!value) return null;
    const instant = new Date(value);
    return Number.isNaN(instant.getTime()) ? value : formatKst(instant);
}

function fit(text: string, max: number, what: string): string {
    if (text.length > max) throw new CardOverflowError(`${what}이(가) ${max}자를 넘어 승인 카드에 전부 표시할 수 없어요`);
    return text;
}

function displayValue(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "예" : "아니오";
    if (typeof value === "number") return String(value);
    return JSON.stringify(value);
}

type CardRow = AgentActionPreview["sections"][number]["rows"][number];

function cardRow(label: string, before: unknown, after: unknown, note?: string): CardRow {
    const row: CardRow = {
        label: fit(label, MAX_PREVIEW_LABEL, `'${label.slice(0, 20)}' 항목 이름`),
        before: displayValue(before) === null ? null : fit(displayValue(before)!, MAX_PREVIEW_TEXT, `${label}의 현재 값`),
        after: displayValue(after) === null ? null : fit(displayValue(after)!, MAX_PREVIEW_TEXT, `${label}의 변경 값`),
    };
    if (note !== undefined) row.note = fit(note, MAX_PREVIEW_TEXT, `${label}의 안내`);
    return row;
}

function sameDisplay(left: unknown, right: unknown): boolean {
    return displayValue(left) === displayValue(right);
}

/** The few source facts the card needs, read defensively from the draft's frozen snapshot. */
interface SnapshotView {
    clientName: string;
    startDate: string | null;
    endDate: string | null;
    header: Record<string, unknown>;
    sessions: Map<number, Record<string, unknown>>;
    assignmentNames: Map<string, string | null>;
    /** The stored assignment and schedule periods the confirm plan was built on. */
    assignments: StoredAssignmentView[];
    finalizationDueAt: string | null;
    /** The client's own end date and stored service-day toggles (a different row than the case's). */
    clientEndDate: string | null;
    serviceDays: { saturday: boolean; sunday: boolean; holiday: boolean };
}

interface StoredAssignmentView {
    id: string | null;
    scheduleId: number | null;
    employeeName: string | null;
    startDate: string | null;
    endDate: string | null;
    scheduleStartDate: string | null;
    scheduleEndDate: string | null;
}

function snapshotView(draft: ServiceRecordEditDraft, preview: Preview): SnapshotView {
    const snapshot = isRecord(draft.sourceSnapshot) ? draft.sourceSnapshot as Partial<Record<keyof ServiceRecordEditSource, unknown>> : {};
    const client = isRecord(snapshot.client) ? snapshot.client : {};
    const lifecycle = isRecord(snapshot.caseLifecycle) ? snapshot.caseLifecycle : {};
    const sessions = new Map<number, Record<string, unknown>>();
    for (const session of Array.isArray(snapshot.sessions) ? snapshot.sessions : []) {
        if (!isRecord(session) || session["ambiguous"] === true || typeof session["sessionIndex"] !== "number") continue;
        sessions.set(session["sessionIndex"], session);
    }
    const assignmentNames = new Map<string, string | null>();
    const assignments: StoredAssignmentView[] = [];
    for (const assignment of Array.isArray(snapshot.assignments) ? snapshot.assignments : []) {
        if (!isRecord(assignment)) continue;
        if (typeof assignment["id"] === "string") assignmentNames.set(assignment["id"], stringOrNull(assignment["employeeName"]));
        assignments.push({
            id: stringOrNull(assignment["id"]),
            scheduleId: typeof assignment["scheduleId"] === "number" ? assignment["scheduleId"] : null,
            employeeName: stringOrNull(assignment["employeeName"]),
            startDate: stringOrNull(assignment["startDate"]),
            endDate: stringOrNull(assignment["endDate"]),
            scheduleStartDate: stringOrNull(assignment["scheduleStartDate"]),
            scheduleEndDate: stringOrNull(assignment["scheduleEndDate"]),
        });
    }
    return {
        clientName: stringOrNull(client["name"]) ?? "산모",
        startDate: typeof snapshot.startDate === "string" ? snapshot.startDate : preview.before.startDate,
        endDate: typeof snapshot.endDate === "string" ? snapshot.endDate : preview.before.endDate,
        header: isRecord(snapshot.header) ? snapshot.header : {},
        sessions,
        assignmentNames,
        assignments,
        finalizationDueAt: stringOrNull(lifecycle["finalizationDueAt"]),
        clientEndDate: stringOrNull(client["endDate"]),
        serviceDays: {
            saturday: client["allowSaturdayService"] === true,
            sunday: client["allowSundayService"] === true,
            holiday: client["allowHolidayService"] === true,
        },
    };
}

function chunkSections(title: string, rows: CardRow[]): AgentActionPreview["sections"] {
    if (rows.length === 0) return [];
    const parts = Math.ceil(rows.length / MAX_PREVIEW_ROWS);
    return Array.from({ length: parts }, (_unused, index) => ({
        title: fit(parts === 1 ? title : `${title} (${index + 1}/${parts})`, MAX_PREVIEW_LABEL, "섹션 제목"),
        rows: rows.slice(index * MAX_PREVIEW_ROWS, (index + 1) * MAX_PREVIEW_ROWS),
    }));
}

function warningText(warning: { code: string; message: string; sessionIndex?: number }, preview: Preview): string {
    const dateOf = (sessionIndex: number | undefined) => preview.after.sessions.find((entry) => entry.sessionIndex === sessionIndex)?.serviceDate;
    if (warning.code === "SUBMITTED_BEFORE_NEW_DATE" && warning.sessionIndex !== undefined) {
        return `${warning.sessionIndex}회차는 새 날짜(${dateOf(warning.sessionIndex) ?? "?"})보다 먼저 제출된 기록이에요. 날짜만 바뀌고 제출·서명은 그대로예요.`;
    }
    if (warning.code === "ASSIGNMENT_MISMATCH" && warning.sessionIndex !== undefined) {
        return `${warning.sessionIndex}회차의 새 날짜(${dateOf(warning.sessionIndex) ?? "?"})가 담당 관리사의 근무 기간에 들어가지 않아요. 확인해 주세요.`;
    }
    return warning.message;
}

/**
 * Whether confirming this change leaves the eformsign contract dates to be fixed by hand.
 *
 * Traced: the confirm plan (`buildConfirmPlan`) writes a `contract_period` operation whenever the
 * period changes and a contract is linked (or its scope is unverified); the operation is only
 * "pending" when provider facts are captured and otherwise "manual_review". Either way the work
 * is carried by `ServiceRecordContractRevisionService`, whose provider and dispatch ports are
 * bound to the Unverified* adapters in EformsignDocModule, and the confirm response's
 * documentStatus is always "capability_unverified". So the contract is never edited by the
 * confirm itself; the manager must fix it in eformsign. No linked contract means nothing to fix.
 */
function contractNeedsManualDates(preview: Preview, periodChanged: boolean): boolean {
    if (!periodChanged) return false;
    const scope = preview.documentScope;
    return scope.evidence !== "observed" || scope.contract.currentDocumentId !== null;
}

/**
 * The 관리사 근무 기간 rows: exactly the assignment/schedule writes of the confirm plan (the real
 * planner, dry-run), for every change kind. An entry the plan marks `datesChanged` is always shown,
 * even when the assignment period looks the same, because the schedule period may be what changes.
 */
function periodRows(view: SnapshotView, plan: ServiceRecordEditConfirmPlan): CardRow[] {
    if (plan.status !== "confirmed") return [];
    const rows: CardRow[] = [];
    for (const write of plan.assignments) {
        if (write.datesChanged === false) continue;
        const stored = view.assignments.find((candidate) => (write.assignmentId !== null
            ? candidate.id === write.assignmentId
            : candidate.id === null && candidate.scheduleId === write.scheduleId));
        const assignmentStart = stored?.startDate || stored?.scheduleStartDate || null;
        const assignmentEnd = stored?.endDate || stored?.scheduleEndDate || null;
        const range = (start: string | null, end: string | null) => `${start ?? "?"} ~ ${end ?? "?"}`;
        const storedAssignment = range(assignmentStart, assignmentEnd);
        const scheduleStart = stored?.scheduleStartDate ?? null;
        const scheduleEnd = stored?.scheduleEndDate ?? null;
        const scheduleDiffers = stored !== undefined
            && (scheduleStart !== assignmentStart || scheduleEnd !== assignmentEnd);
        rows.push(cardRow(
            stored?.employeeName ?? write.assignmentId ?? (write.scheduleId !== null ? `일정 ${write.scheduleId}` : "관리사"),
            scheduleDiffers ? `${storedAssignment} (일정 ${range(scheduleStart, scheduleEnd)})` : storedAssignment,
            `${write.startDate} ~ ${write.endDate}`,
        ));
    }
    return rows;
}

/**
 * The card of a `no_changes` plan: ONLY what the repository's `no_changes` branches write, never the
 * preview-derived dates, period, content or header (the confirm writes none of those without a
 * revision). Mirrors service-record-edit.repository.ts `confirmDraftWithClient`:
 *  1. `plan.clientServiceDays` -> `client.updateMany` of the three toggles;
 *  2. with `plan.materializedPlannedSessions` (legacy case): the vector is stored, `service_record_case.endDate`
 *     moves with its planned finalization deadline when `materialized.endDate !== source.endDate`,
 *     `client.endDate` moves when it differs from
 *     `source.client.endDate`, and the active tokens' expiry is written exact for the materialized end ONLY when one of
 *     those end dates moves (a toggle that keeps the dates leaves every link alone);
 *  3. `tokenExpiryMode === "raise_only"` with `plan.endDate` -> the active token expiry is raised.
 */
function buildNoChangesCard(
    draft: ServiceRecordEditDraft,
    preview: Preview,
    plan: ServiceRecordEditConfirmPlan,
): { sections: AgentActionPreview["sections"]; clientName: string } {
    const view = snapshotView(draft, preview);
    const sections: AgentActionPreview["sections"] = [];
    const materialized = plan.clientServiceDays ? plan.materializedPlannedSessions : undefined;

    // 회차 날짜: the stored vector against the dates the case shows now (the projection).
    const dateRows: CardRow[] = [];
    if (materialized && Array.isArray(materialized.plannedSessions)) {
        const beforeByIndex = new Map(preview.before.sessions.map((entry) => [entry.sessionIndex, entry]));
        for (const entry of materialized.plannedSessions) {
            if (!isRecord(entry) || typeof entry["sessionIndex"] !== "number" || typeof entry["serviceDate"] !== "string") continue;
            const before = beforeByIndex.get(entry["sessionIndex"]);
            if (before && before.serviceDate !== entry["serviceDate"]) {
                dateRows.push(cardRow(`${entry["sessionIndex"]}회차`, before.serviceDate, entry["serviceDate"]));
            }
        }
    }
    sections.push(...chunkSections("회차 날짜", dateRows));

    // 서비스 기간·마감: the end dates the materialization moves and the link expiry that follows.
    const infoRows: CardRow[] = [];
    const materializedEnd = materialized?.endDate ?? null;
    if (materializedEnd) {
        const caseEndMoves = materializedEnd !== view.endDate;
        const clientEndMoves = materializedEnd !== view.clientEndDate;
        if (caseEndMoves) infoRows.push(cardRow("서비스 종료일", view.endDate, materializedEnd));
        if (clientEndMoves && (!caseEndMoves || view.clientEndDate !== view.endDate)) {
            infoRows.push(cardRow("고객 정보의 서비스 종료일", view.clientEndDate, materializedEnd));
        }
        if (caseEndMoves && plan.finalizationDueAt && view.finalizationDueAt !== plan.finalizationDueAt) {
            infoRows.push(cardRow("최종 확정 마감", formatKstFromIso(view.finalizationDueAt), formatKstFromIso(plan.finalizationDueAt)));
        }
        if (caseEndMoves || clientEndMoves) {
            // The dry run does not load token expiry, so "before" is unknown. Every active link is
            // reset to the new end date's expiry, which can shorten a link that was re-sent later.
            infoRows.push(cardRow(
                "제공기록 링크 만료",
                null,
                formatKst(getServiceRecordTokenExpiresAt(new Date(`${materializedEnd}T00:00:00.000Z`))),
                "활성 링크 만료를 새 종료일 기준으로 맞춰요. 나중에 다시 보낸 링크도 이 시각으로 바뀔 수 있어요.",
            ));
        }
    }
    if (plan.tokenExpiryMode === "raise_only" && plan.endDate && !infoRows.some((entry) => entry.label === "제공기록 링크 만료")) {
        infoRows.push(cardRow(
            "제공기록 링크 만료",
            null,
            formatKst(getServiceRecordTokenExpiresAt(new Date(`${plan.endDate}T00:00:00.000Z`))),
            "연장만 반영돼요(raise-only): 이미 더 늦게 만료되는 링크는 그대로 둬요",
        ));
    }
    sections.push(...chunkSections("서비스 기간·마감", infoRows));

    // 서비스 요일: the stored toggles against the plan's.
    const serviceDayRows: CardRow[] = [];
    if (plan.clientServiceDays) {
        for (const [key, label] of SERVICE_DAY_LABELS) {
            if (view.serviceDays[key] !== plan.clientServiceDays[key]) {
                serviceDayRows.push(cardRow(label, view.serviceDays[key], plan.clientServiceDays[key]));
            }
        }
    }
    sections.push(...chunkSections("서비스 요일", serviceDayRows));

    if (sections.length === 0) {
        throw new AgentActionCertainFailureError("바뀌는 내용이 없어요. 요청한 변경이 이미 제공기록지에 반영돼 있는지 사용자에게 확인하세요.");
    }
    return { sections, clientName: view.clientName };
}

function buildApprovalCard(
    draft: ServiceRecordEditDraft,
    preview: Preview,
    operations: readonly Operation[],
    plan: ServiceRecordEditConfirmPlan,
): { sections: AgentActionPreview["sections"]; clientName: string } {
    // A no_changes plan writes no revision: its card is built from the plan's own writes only.
    if (plan.status !== "confirmed") return buildNoChangesCard(draft, preview, plan);
    const view = snapshotView(draft, preview);
    const changes = isRecord(draft.changes) ? draft.changes : {};
    const sections: AgentActionPreview["sections"] = [];

    // 회차 날짜: only rows the editor's own before/after vectors differ on.
    const beforeByIndex = new Map(preview.before.sessions.map((entry) => [entry.sessionIndex, entry]));
    const dateRows: CardRow[] = [];
    for (const after of preview.after.sessions) {
        const before = beforeByIndex.get(after.sessionIndex);
        const dateChanged = before !== undefined && before.serviceDate !== after.serviceDate;
        const ownerChanged = before !== undefined && before.assignmentId !== after.assignmentId;
        if (!dateChanged && !ownerChanged) continue;
        const owner = (assignmentId: string) => view.assignmentNames.get(assignmentId) ?? "미지정";
        dateRows.push(cardRow(
            `${after.sessionIndex}회차`,
            before?.serviceDate,
            after.serviceDate,
            ownerChanged && before ? `담당 관리사: ${owner(before.assignmentId)} → ${owner(after.assignmentId)}` : undefined,
        ));
    }
    sections.push(...chunkSections("회차 날짜", dateRows));

    // 관리사 근무 기간: the period writes of the real confirm plan.
    sections.push(...chunkSections("관리사 근무 기간", periodRows(view, plan)));

    // 서비스 기간, 마감, 링크.
    const infoRows: CardRow[] = [];
    if (!sameDisplay(view.startDate, preview.after.startDate)) {
        infoRows.push(cardRow("서비스 시작일", view.startDate, preview.after.startDate));
    }
    const endChanged = !sameDisplay(view.endDate, preview.after.endDate);
    if (endChanged) infoRows.push(cardRow("서비스 종료일", view.endDate, preview.after.endDate));
    const resumes = operations.some((operation) => operation.kind === "resumeReplan");
    if (plan.finalizationDueAt) {
        // Show exactly the deadline the confirm plan writes, including ordinary end-date changes.
        const dueAfter = plan.finalizationDueAt;
        if (view.finalizationDueAt !== dueAfter) {
            infoRows.push(cardRow("최종 확정 마감", formatKstFromIso(view.finalizationDueAt), formatKstFromIso(dueAfter)));
        }
    }
    if (endChanged && preview.after.endDate) {
        const expiryAfter = getServiceRecordTokenExpiresAt(new Date(`${preview.after.endDate}T00:00:00.000Z`));
        const expiryBefore = view.endDate ? getServiceRecordTokenExpiresAt(new Date(`${view.endDate}T00:00:00.000Z`)) : null;
        infoRows.push(cardRow(
            "제공기록 링크 만료",
            expiryBefore ? formatKst(expiryBefore) : null,
            formatKst(expiryAfter),
            resumes ? "연장만 반영돼요(raise-only): 이미 더 늦게 만료되는 링크는 그대로 둬요" : "새 종료일 기준으로 맞춰요",
        ));
    }
    sections.push(...chunkSections("서비스 기간·마감", infoRows));

    // 서비스 요일.
    const serviceDayRows: CardRow[] = [];
    if (preview.serviceDays) {
        for (const [key, label] of SERVICE_DAY_LABELS) {
            if (preview.serviceDays.before[key] !== preview.serviceDays.after[key]) {
                serviceDayRows.push(cardRow(label, preview.serviceDays.before[key], preview.serviceDays.after[key]));
            }
        }
    }
    sections.push(...chunkSections("서비스 요일", serviceDayRows));

    // 회차 내용: the draft's sparse patch against the frozen source row, one answer key per row.
    const contentRows: CardRow[] = [];
    const sessionChanges = Array.isArray(changes["sessions"]) ? changes["sessions"] : [];
    for (const change of sessionChanges) {
        if (!isRecord(change) || typeof change["sessionIndex"] !== "number") continue;
        const index = change["sessionIndex"];
        const source = view.sessions.get(index) ?? {};
        if (isRecord(change["answers"])) {
            const sourceAnswers = isRecord(source["answers"]) ? source["answers"] : {};
            for (const [key, value] of Object.entries(change["answers"])) {
                if (!sameDisplay(sourceAnswers[key], value)) {
                    contentRows.push(cardRow(`${index}회차 · 답변 ${key}`, sourceAnswers[key], value));
                }
            }
        }
        const fields: Array<[string, string]> = [["etcService", "기타 서비스"], ["notes", "메모"], ["paymentConfirmed", "본인부담금 확인"]];
        for (const [field, label] of fields) {
            if (change[field] !== undefined && !sameDisplay(source[field], change[field])) {
                contentRows.push(cardRow(`${index}회차 · ${label}`, source[field], change[field]));
            }
        }
    }
    sections.push(...chunkSections("회차 내용", contentRows));

    // 헤더.
    const headerRows: CardRow[] = [];
    const headerChanges = isRecord(changes["header"]) ? changes["header"] : {};
    for (const [key, value] of Object.entries(headerChanges)) {
        if (!sameDisplay(view.header[key], value)) {
            headerRows.push(cardRow(HEADER_LABELS[key] ?? key, view.header[key], value));
        }
    }
    sections.push(...chunkSections("제공기록지 헤더", headerRows));

    // 확인할 사항: the editor's warnings plus the contract note.
    const noteRows: CardRow[] = (preview.warnings ?? []).map((warning) => cardRow(
        warning.sessionIndex === undefined ? "주의" : `${warning.sessionIndex}회차 주의`,
        null,
        null,
        warningText(warning, preview),
    ));
    const periodChanged = !sameDisplay(view.startDate, preview.after.startDate) || endChanged;
    if (contractNeedsManualDates(preview, periodChanged)) {
        noteRows.push(cardRow(
            "계약서 날짜",
            null,
            null,
            "계약서 날짜는 eformsign에서 수동으로 수정해야 해요. 확정해도 계약서는 자동으로 바뀌지 않아요.",
        ));
    }
    sections.push(...chunkSections("확인할 사항", noteRows));

    if (sections.length === 0) {
        throw new AgentActionCertainFailureError("바뀌는 내용이 없어요. 요청한 변경이 이미 제공기록지에 반영돼 있는지 사용자에게 확인하세요.");
    }
    if (sections.length > MAX_PREVIEW_SECTIONS) {
        throw new CardOverflowError(`변경이 ${sections.length}개 섹션에 걸쳐 승인 카드(최대 ${MAX_PREVIEW_SECTIONS}개)에 전부 표시할 수 없어요`);
    }
    return { sections, clientName: view.clientName };
}

function operationSummary(operation: Operation): string {
    switch (operation.kind) {
        case "resumeReplan":
            return `${operation.fromSessionIndex}회차부터 ${operation.resumeDate}에 재개${operation.incomingAssignmentId ? "(관리사 교체)" : ""}`;
        case "dateMove":
            return `${operation.sessionIndex}회차를 ${operation.toDate}로 이동`;
        case "schedule":
            return "전체 회차 일정 교체";
        case "sessionContent":
            return `${operation.sessionIndex}회차 내용 수정`;
        case "header":
            return `헤더 수정(${Object.keys(operation.header ?? {}).map((key) => HEADER_LABELS[key] ?? key).join(", ")})`;
    }
}

/** The preview the editor produced minus the draft identity, so two drafts of the same change compare equal. */
function approvedContentVersion(
    preview: Preview,
    sections: AgentActionPreview["sections"],
): string {
    const { previewId: _previewId, draftId: _draftId, draftVersion: _draftVersion, ...content } = preview;
    void _previewId;
    void _draftId;
    void _draftVersion;
    return agentBindingHash({
        sourceCaseVersion: preview.sourceCaseVersion,
        sourceFingerprint: preview.sourceFingerprint,
        preview: content,
        card: sections,
    });
}

function flattenValidation(errors: ValidationError[], prefix = ""): string[] {
    return errors.flatMap((error) => {
        const path = prefix ? `${prefix}.${error.property}` : error.property;
        const own = error.constraints ? [`${path}: ${Object.values(error.constraints).join(", ")}`] : [];
        return [...own, ...flattenValidation(error.children ?? [], path)];
    });
}

function candidatesText(candidates: Candidate[]): string {
    return candidates.map((candidate) => `${candidate.employeeName ?? "이름 없음"}(employeeId: ${candidate.employeeId})`).join(", ");
}

function readCandidates(value: unknown, source?: ServiceRecordEditSource): Candidate[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const assignment = source?.assignments.find((entry) => entry.id === item["assignmentId"]);
        return assignment?.employeeId == null ? [] : [{ employeeId: assignment.employeeId, employeeName: assignment.employeeName }];
    });
}

/** Only known refusals are safe to return to the model for another step. */
function question(code: string, detail: string, candidates: Candidate[] = []): AgentActionCertainFailureError {
    const hint = Object.prototype.hasOwnProperty.call(CODE_HINTS, code) ? CODE_HINTS[code] : undefined;
    const parts = [`[${code}]`, hint ?? detail];
    if (hint && detail && detail !== hint) parts.push(`(편집기 안내: ${detail})`);
    if (candidates.length > 0) parts.push(`후보: ${candidatesText(candidates)}`);
    return hint
        ? new AgentActionQuestionError(code, parts.join(" "), candidates)
        : new AgentActionCertainFailureError(parts.join(" "));
}

/** Maps an editor rejection onto an answerable question; anything that is not an editor rejection is returned as is. */
function editorFailure(error: unknown, source?: ServiceRecordEditSource): unknown {
    if (error instanceof AgentActionCertainFailureError) return error;
    if (error instanceof CardOverflowError) {
        return new AgentActionCertainFailureError(`[CARD_TOO_LARGE] ${error.message}. 변경을 나눠서 요청해 주세요.`);
    }
    if (error instanceof NotFoundException) {
        return new AgentActionCertainFailureError("[NOT_FOUND] 이 지점에서 해당 산모의 제공기록지를 찾을 수 없어요. clients.search로 산모를 다시 확인하세요.");
    }
    if (!(error instanceof HttpException)) return error;
    const response = error.getResponse();
    if (!isRecord(response)) return question("EDITOR_REJECTED", String(response));
    const scheduleCode = stringOrNull(response["scheduleCode"]);
    const code = scheduleCode ?? stringOrNull(response["code"]) ?? "EDITOR_REJECTED";
    const errors = Array.isArray(response["errors"]) ? response["errors"] : [];
    const first = isRecord(errors[0]) ? stringOrNull(errors[0]["detail"]) : null;
    const reasons = Array.isArray(response["blockingReasons"]) ? response["blockingReasons"] : [];
    if (reasons.length > 0) return blockingQuestion(reasons, source);
    const message = Array.isArray(response["message"]) ? response["message"].join(", ") : stringOrNull(response["message"]);
    return question(code, message ?? first ?? error.message, readCandidates(response["candidates"], source));
}

function isDraftCreationConflict(error: unknown): boolean {
    if (!(error instanceof ConflictException)) return false;
    const response = error.getResponse();
    return isRecord(response) && response["code"] === "REQUEST_CONFLICT" && response["blockingReasons"] === undefined;
}

function blockingQuestion(reasons: unknown[], source?: ServiceRecordEditSource): AgentActionQuestionError {
    const lines = reasons.flatMap((reason) => {
        if (!isRecord(reason)) return [];
        const code = stringOrNull(reason["code"]) ?? "BLOCKED";
        const sessionIndex = typeof reason["sessionIndex"] === "number" ? ` ${reason["sessionIndex"]}회차` : "";
        const hint = Object.prototype.hasOwnProperty.call(CODE_HINTS, code) ? CODE_HINTS[code] : undefined;
        const message = stringOrNull(reason["message"]) ?? "";
        const candidates = readCandidates(reason["candidates"], source);
        return [`[${code}]${sessionIndex} ${hint ?? message}${hint && message && message !== hint ? ` (편집기 안내: ${message})` : ""}${
            candidates.length > 0 ? ` 후보: ${candidatesText(candidates)}` : ""}`];
    });
    const first = reasons.find(isRecord);
    return new AgentActionQuestionError(
        first ? stringOrNull(first["code"]) ?? "BLOCKED" : "BLOCKED",
        `제공기록지를 지금 상태로는 바꿀 수 없어요. ${lines.join(" / ") || "사유를 확인하지 못했어요."}`,
        reasons.flatMap((reason) => isRecord(reason) ? readCandidates(reason["candidates"], source) : []),
    );
}

function missing(kind: OperationKind, fields: string): AgentActionCertainFailureError {
    return new AgentActionQuestionError("MISSING_INPUT",
        `[MISSING_INPUT] ${kind} 작업에 ${fields}이(가) 필요해요. 추측하지 말고 사용자에게 물어본 뒤 다시 호출하세요.`,
    );
}

/** Maps an operation onto the editor's own PATCH shape. Required facts are asked for, never guessed. */
function toEditorRequest(operation: Operation): EditorRequest {
    const allowed = FIELDS_BY_KIND[operation.kind];
    const extras = Object.entries(operation)
        .filter(([key, value]) => key !== "kind" && value !== undefined && !allowed.includes(key))
        .map(([key]) => key);
    if (extras.length > 0) {
        throw new AgentActionQuestionError("INVALID_OPERATION", `[INVALID_OPERATION] ${operation.kind} 작업에는 ${extras.join(", ")}을(를) 쓸 수 없어요. 작업 종류에 맞는 값만 넣어 다시 호출하세요.`);
    }
    switch (operation.kind) {
        case "resumeReplan": {
            if (operation.resumeDate === undefined) throw missing("resumeReplan", "resumeDate(중단 후 처음 서비스하는 날)");
            if (operation.fromSessionIndex === undefined) throw missing("resumeReplan", "fromSessionIndex(처음 바뀌는 회차) 또는 pauseStartDate(중단 시작일)");
            return {
                changes: {},
                resumeReplan: {
                    fromSessionIndex: operation.fromSessionIndex,
                    resumeDate: operation.resumeDate,
                    ...(operation.outgoingLastServedDate === undefined ? {} : { outgoingLastServedDate: operation.outgoingLastServedDate }),
                    ...(operation.incomingAssignmentId === undefined ? {} : { incomingAssignmentId: operation.incomingAssignmentId }),
                },
            };
        }
        case "dateMove":
            if (operation.sessionIndex === undefined || operation.toDate === undefined) throw missing("dateMove", "sessionIndex(몇 회차)와 toDate(옮길 날짜)");
            return {
                changes: {},
                dateMove: {
                    sessionIndex: operation.sessionIndex,
                    toDate: operation.toDate,
                    ...(operation.shiftFollowing === undefined ? {} : { shiftFollowing: operation.shiftFollowing }),
                },
            };
        case "schedule":
            if (operation.serviceDays === undefined || operation.dates === undefined) throw missing("schedule", "serviceDays와 회차별 dates");
            // The DTO validators run right after and report any serviceDays key the model left out.
            return { changes: {}, schedule: { serviceDays: operation.serviceDays as { saturday: boolean; sunday: boolean; holiday: boolean }, dates: operation.dates } };
        case "sessionContent": {
            if (operation.sessionIndex === undefined) throw missing("sessionContent", "sessionIndex(몇 회차)");
            const content = {
                ...(operation.answers === undefined ? {} : { answers: operation.answers }),
                ...(operation.etcService === undefined ? {} : { etcService: operation.etcService }),
                ...(operation.notes === undefined ? {} : { notes: operation.notes }),
                ...(operation.paymentConfirmed === undefined ? {} : { paymentConfirmed: operation.paymentConfirmed }),
            };
            if (Object.keys(content).length === 0) throw missing("sessionContent", "바꿀 내용(answers, etcService, notes, paymentConfirmed 중 하나)");
            return { changes: { sessions: [{ sessionIndex: operation.sessionIndex, ...content }] } };
        }
        case "header": {
            const header = Object.fromEntries(Object.entries(operation.header ?? {}).filter(([, value]) => value !== undefined));
            if (Object.keys(header).length === 0) throw missing("header", "바꿀 헤더 값");
            return { changes: { header } };
        }
    }
}

/** The editor's own class-validator DTO decides whether the request is well formed. */
function toEditorDto(request: EditorRequest, expectedDraftVersion: number): UpdateServiceRecordEditDraftDto {
    const dto = plainToInstance(UpdateServiceRecordEditDraftDto, { expectedDraftVersion, ...request });
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
        throw new AgentActionCertainFailureError(
            `[INVALID_INPUT] 편집기가 요청 형식을 받아들이지 않아요: ${flattenValidation(errors).join("; ")}. 값을 사용자에게 확인한 뒤 다시 호출하세요.`,
        );
    }
    return dto;
}

/**
 * A pauseStartDate is resolved to a session index only once a draft exists; for the up-front shape
 * check it stands in as session 1.
 */
function withPlaceholderSession(operation: Operation): Operation {
    if (operation.kind !== "resumeReplan" || operation.pauseStartDate === undefined) return operation;
    if (operation.fromSessionIndex !== undefined) {
        throw new AgentActionQuestionError("INVALID_OPERATION", "[INVALID_OPERATION] resumeReplan에는 fromSessionIndex와 pauseStartDate 중 하나만 넣어 주세요.");
    }
    const { pauseStartDate: _pauseStartDate, ...rest } = operation;
    void _pauseStartDate;
    return { ...rest, fromSessionIndex: 1 };
}

interface TransientSession {
    draft: ServiceRecordEditDraft;
    preview: Preview;
    /** The real confirm planner's answer for this draft (dry run); null while the preview blocks. */
    plan: ServiceRecordEditConfirmPlan | null;
    /** The operations as applied: a pauseStartDate is already resolved to a fromSessionIndex. */
    operations: Operation[];
    /** Call once the draft has been consumed by a confirm; it then must not be discarded. */
    settle(): void;
}

/** The dry-run plan exists whenever the preview does not block; callers check blocking first. */
function planOf(session: TransientSession): ServiceRecordEditConfirmPlan {
    if (!session.plan) {
        throw new AgentActionCertainFailureError("[EDITOR_DRAFT_UNAVAILABLE] 확정 계획을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    return session.plan;
}

@Injectable()
@AgentCapabilityProvider()
export class ServiceRecordEditAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    private readonly logger = new Logger(ServiceRecordEditAgentCapabilitiesProvider.name);

    constructor(private readonly editor: AdminServiceRecordEditService) {}

    getCapabilities(): CapabilityDefinition[] {
        const catalog = CAPABILITY_CATALOG_BY_NAME.get("service-records.edit");
        if (!catalog) throw new Error("service-records.edit is missing from the canonical catalog");
        return [{
            meta: { ...catalog, name: "service-records.edit" },
            inputSchema: InputSchema,
            outputSchema: OutputSchema,
            inspect: (context, rawInput) => this.inspect(context, InputSchema.parse(rawInput)),
            revalidate: (context, _rawInput, expectedTargetVersion) => this.revalidate(context, expectedTargetVersion),
            // A versioned action never reaches `execute`: the coordinator calls executeApprovedTarget.
            execute: () => Promise.reject(new AgentActionCertainFailureError("service-records.edit requires an approved target")),
            executeApprovedTarget: (context, _rawInput, expectedTargetVersion) => this.executeApproved(context, expectedTargetVersion),
            reconcile: (context) => this.reconcile(context),
        }];
    }

    /**
     * Builds the approval card from a short-lived editor draft.
     *
     * Nothing persists between the proposal and the approval: the framework gives a provider no
     * reject/expire hook and a draft carries no origin marker, so a draft left open could not be
     * told apart from a person's. The draft is therefore discarded before this returns, and the
     * approval re-creates it. The draft is only ever one this call created (the repository
     * creates it only when none is active, under the case lock), so the chat never takes over a
     * draft it did not create: a person's draft, including one opened in the instant before, is
     * refused and never updated or discarded. In the other direction a person may still resume
     * the chat's short-lived draft during that window (the editor's own start resumes any active
     * draft); the version compare-and-swap on update and discard then protects the person's later
     * edits, because the chat's discard fails instead of removing a draft that has changed.
     */
    private async inspect(context: AgentContext, rawInput: Input): Promise<AgentProposalInspection> {
        try {
            const { clientId, operations } = this.requireInput(rawInput);
            // Fail on a malformed or incomplete operation before any draft exists.
            for (const operation of operations) toEditorDto(toEditorRequest(withPlaceholderSession(operation)), 1);
            return await this.runTransient(context.principal, clientId, operations, async (session) => {
                if (session.preview.blockingReasons.length > 0) throw blockingQuestion(session.preview.blockingReasons, session.draft.sourceSnapshot as unknown as ServiceRecordEditSource);
                const card = buildApprovalCard(session.draft, session.preview, session.operations, planOf(session));
                const snapshot: TargetSnapshot = {
                    clientId,
                    caseId: session.draft.serviceRecordCaseId,
                    sourceCaseVersion: session.preview.sourceCaseVersion,
                    sourceFingerprint: session.preview.sourceFingerprint,
                    operations: session.operations,
                };
                return {
                    targetVersion: approvedContentVersion(session.preview, card.sections),
                    targetSnapshot: snapshot,
                    title: `제공기록지 수정 · ${card.clientName}`,
                    summary: `${card.clientName} 제공기록지: ${session.operations.map(operationSummary).join(", ")}`,
                    preview: { sections: card.sections },
                };
            });
        } catch (error) {
            throw editorFailure(error);
        }
    }

    /** Read-only: the case must be as it was when the card was built, with no draft open. */
    private async revalidate(context: AgentContext, expectedTargetVersion: string): Promise<AgentTargetRevalidation> {
        void expectedTargetVersion; // The content hash is only recomputable from a draft; execute re-checks it.
        const snapshot = TargetSnapshotSchema.safeParse(context.approvedTargetSnapshot);
        if (!snapshot.success) return { valid: false, reason: "Approved target snapshot is unreadable" };
        try {
            const state = await this.editor.getDraft(context.principal.branchId, snapshot.data.clientId);
            if (state.draft) return { valid: false, reason: "An editor draft is open for this case" };
            return {
                valid: state.sourceCaseVersion === snapshot.data.sourceCaseVersion
                    && state.sourceFingerprint === snapshot.data.sourceFingerprint,
                reason: "The service record changed since approval was requested",
            };
        } catch (error) {
            if (error instanceof HttpException) return { valid: false, reason: "The service record is no longer available" };
            throw error;
        }
    }

    /**
     * Re-applies the SAME operations the card was built from (from the approved snapshot, never
     * from model input) to a fresh short-lived draft and confirms it only when the recomputed
     * content is identical to what was approved.
     */
    private async executeApproved(context: AgentContext, expectedTargetVersion: string): Promise<z.infer<typeof OutputSchema>> {
        try {
            const snapshot = TargetSnapshotSchema.safeParse(context.approvedTargetSnapshot);
            if (!snapshot.success) throw new AgentActionCertainFailureError("승인된 제공기록지 변경 내용을 읽을 수 없어요. 처음부터 다시 요청해 주세요.");
            const actionId = context.actionId;
            if (!actionId) throw new AgentActionCertainFailureError("승인 식별자가 없어 제공기록지를 확정할 수 없어요.");
            const { clientId, operations } = snapshot.data;
            const principal = context.principal;
            const confirmed = await this.runTransient(principal, clientId, operations, async (session) => {
                if (session.preview.blockingReasons.length > 0) throw blockingQuestion(session.preview.blockingReasons, session.draft.sourceSnapshot as unknown as ServiceRecordEditSource);
                const card = buildApprovalCard(session.draft, session.preview, session.operations, planOf(session));
                if (approvedContentVersion(session.preview, card.sections) !== expectedTargetVersion) {
                    throw new AgentActionCertainFailureError("[APPROVAL_STALE] 승인한 뒤 제공기록지나 일정이 바뀌어 변경 내용이 달라졌어요. 처음부터 다시 요청해 주세요.");
                }
                const result = await this.editor.confirmDraft(principal.branchId, session.draft.id, principal.userId, {
                    expectedDraftVersion: session.draft.draftVersion,
                    previewId: session.preview.previewId,
                    idempotencyKey: actionId,
                });
                session.settle();
                return result;
            });
            return OutputSchema.parse(confirmed);
        } catch (error) {
            throw editorFailure(error);
        }
    }

    /** Read-only: the approved action's id is the confirm's idempotency key, so a CONFIRMED draft carrying it proves success. */
    private async reconcile(context: AgentContext): Promise<AgentReconciliationOutcome> {
        if (!context.actionId) return { status: "uncertain", reason: "No action id to look the confirmation up by" };
        const stored = await this.editor.findConfirmedResponseByIdempotencyKey(
            context.principal.branchId,
            context.principal.userId,
            context.actionId,
        );
        const parsed = OutputSchema.safeParse(stored);
        return parsed.success
            ? { status: "succeeded", result: parsed.data }
            : { status: "uncertain", reason: "No confirmed editor draft carries this action's id" };
    }

    private requireInput(input: Input): { clientId: number; operations: Operation[] } {
        if (input.clientId === undefined || !Number.isInteger(input.clientId) || input.clientId < 1) {
            throw new AgentActionQuestionError("MISSING_INPUT", "[MISSING_INPUT] clientId가 필요해요. clients.search로 산모를 찾아 숫자 id를 넣어 다시 호출하세요.");
        }
        if (input.operations === undefined || input.operations.length === 0) {
            throw new AgentActionQuestionError("MISSING_INPUT", "[MISSING_INPUT] operations가 비어 있어요. 어떤 변경인지(재개·날짜 이동·일정·내용·헤더) 사용자에게 확인한 뒤 다시 호출하세요.");
        }
        return { clientId: input.clientId, operations: input.operations };
    }

    /** A person's open draft is never reused, changed or discarded: it is reported and left alone. */
    private openDraftRefusal(draft: ServiceRecordEditDraft, principal: VerifiedTenantPrincipal): AgentActionCertainFailureError {
        const who = draft.createdByUserId === principal.userId ? "본인" : "다른 사용자";
        return new AgentActionCertainFailureError(
            `[EDITOR_DRAFT_OPEN] 이 산모의 제공기록지 편집기에 열려 있는 초안이 있어요(${who}가 ${formatKst(draft.updatedAt)}에 작성). `
            + "그 초안은 건드리지 않아요. 편집기에서 초안을 확정하거나 버린 뒤 다시 요청해 달라고 사용자에게 안내하세요.",
        );
    }

    /**
     * Runs `use` against a freshly started editor draft with the operations applied and previewed,
     * then discards the draft unless `use` consumed it. Only a draft this call created is touched.
     */
    private async runTransient<T>(
        principal: VerifiedTenantPrincipal,
        clientId: number,
        operations: Operation[],
        use: (session: TransientSession) => Promise<T>,
    ): Promise<T> {
        const { branchId, userId } = principal;
        const open = await this.editor.getDraft(branchId, clientId);
        if (open.draft) throw this.openDraftRefusal(open.draft, principal);
        // startOwnDraft decides creation atomically under the case lock: it either creates the draft
        // for this call or refuses, so nothing below can act on a draft somebody else owns.
        let started: Awaited<ReturnType<AdminServiceRecordEditService["startOwnDraft"]>>;
        try {
            started = await this.editor.startOwnDraft(branchId, clientId, userId, {});
        } catch (error) {
            // Only the draft-creation conflict (REQUEST_CONFLICT) means a draft is open; any other 409
            // (a stale source, a closed case…) goes through the normal editor-error mapping.
            if (!isDraftCreationConflict(error)) throw error;
            const appeared = await this.editor.getDraft(branchId, clientId);
            throw appeared.draft
                ? this.openDraftRefusal(appeared.draft, principal)
                : new AgentActionCertainFailureError("[EDITOR_DRAFT_OPEN] 이 산모의 제공기록지 편집기에 열려 있는 초안이 있어요. 그 초안은 건드리지 않아요. 편집기에서 초안을 확정하거나 버린 뒤 다시 요청해 달라고 사용자에게 안내하세요.");
        }
        const created = started.draft;
        if (!created) {
            throw new AgentActionCertainFailureError("[EDITOR_DRAFT_UNAVAILABLE] 제공기록지 편집 초안을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
        }

        let current = created;
        let settled = false;
        let outcome: { ok: true; value: T } | { ok: false; error: unknown };
        try {
            const applied: Operation[] = [];
            for (const operation of operations) {
                const paused = await this.resolvePauseStart(principal, current, operation);
                const resolved = await this.resolveIncomingEmployee(principal, current, paused);
                const state = await this.editor.updateDraft(branchId, current.id, userId, toEditorDto(toEditorRequest(resolved), current.draftVersion));
                if (!state.draft) throw new AgentActionCertainFailureError("[EDITOR_DRAFT_UNAVAILABLE] 제공기록지 편집 초안이 사라졌어요. 다시 요청해 주세요.");
                current = state.draft;
                applied.push(resolved);
            }
            const preview = await this.editor.previewDraft(branchId, current.id, userId, { expectedDraftVersion: current.draftVersion }) as Preview;
            // What the confirm would write, from the confirm's own planner (read-only dry run). Skipped
            // while the preview blocks: the caller turns the blocking reasons into a question.
            const plan = preview.blockingReasons.length === 0
                ? await this.editor.planConfirmDryRun(branchId, current.id, userId, preview.previewId)
                : null;
            outcome = {
                ok: true,
                value: await use({ draft: current, preview, plan, operations: applied, settle: () => { settled = true; } }),
            };
        } catch (error) {
            outcome = { ok: false, error: editorFailure(error, created.sourceSnapshot as unknown as ServiceRecordEditSource) };
        }
        const cleanupError = settled ? null : await this.discardTransient(principal, current);
        if (cleanupError) {
            // Cleanup cannot make an uncertain execute failure certain: confirm may have committed.
            if (!outcome.ok && !(outcome.error instanceof AgentActionCertainFailureError)) throw outcome.error;
            // A failed cleanup is fatal even if the original refusal was answerable.
            throw new AgentActionCertainFailureError(!outcome.ok && outcome.error instanceof AgentActionCertainFailureError
                ? `${outcome.error.message} ${cleanupError.message}` : cleanupError.message);
        }
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
    }

    /** Resolve model-visible employee ids using only the frozen, case-owned editor source. */
    private async resolveIncomingEmployee(principal: VerifiedTenantPrincipal, draft: ServiceRecordEditDraft, operation: Operation): Promise<Operation> {
        if (operation.kind !== "resumeReplan") return operation;
        const source = draft.sourceSnapshot as unknown as ServiceRecordEditSource;
        const usable = source.assignments.filter((entry) => entry.serviceRecordCaseId === draft.serviceRecordCaseId
            && entry.id && entry.scheduleId !== null && entry.employeeId !== null && !isSupersededAssignment(entry));
        const candidates = usable.map((entry) => ({ employeeId: entry.employeeId!, employeeName: entry.employeeName }));
        const invalid = (detail: string) => question("INCOMING_ASSIGNMENT_INVALID", detail, candidates);
        let assignmentId = operation.incomingAssignmentId;
        let employeeId = operation.incomingEmployeeId;
        // Legacy model input used an employees.search id in the assignment field. Real ids are UUIDs.
        if (assignmentId !== undefined && !source.assignments.some((entry) => entry.id === assignmentId)
            && /^[1-9]\d*$/.test(assignmentId) && Number.isSafeInteger(Number(assignmentId))) {
            const legacyId = Number(assignmentId);
            if (employeeId !== undefined && employeeId !== legacyId) throw invalid("두 관리사 지정이 서로 달라요. 새 관리사를 다시 확인하세요.");
            employeeId = legacyId;
            assignmentId = undefined;
        }
        if (employeeId === undefined) return operation;
        const matches = usable.filter((entry) => entry.employeeId === employeeId);
        if (matches.length !== 1) throw invalid("이 산모의 사용 가능한 배정에서 관리사를 하나로 정할 수 없어요. 후보를 확인하세요.");
        const resolved = matches[0]!;
        if (assignmentId !== undefined && assignmentId !== resolved.id) throw invalid("두 관리사 지정이 서로 달라요. 새 관리사를 다시 확인하세요.");
        const preview = await this.editor.previewDraft(principal.branchId, draft.id, principal.userId, { expectedDraftVersion: draft.draftVersion }) as Preview;
        if (preview.blockingReasons.length > 0) throw blockingQuestion(preview.blockingReasons, source);
        // The editor's outgoing anchor is the last non-historical kept session. Its date is unchanged by a resume.
        const { historicalSlots } = classifyPeriodOwnership(source, preview.before.sessions);
        const outgoing = preview.before.sessions.slice(0, operation.fromSessionIndex! - 1)
            .reverse().find((entry) => !historicalSlots.has(entry.sessionIndex));
        const { incomingEmployeeId: _employeeId, incomingAssignmentId: _assignmentId, ...rest } = operation;
        void _employeeId;
        void _assignmentId;
        return resolved.id === outgoing?.assignmentId ? rest : { ...rest, incomingAssignmentId: resolved.id! };
    }

    /** A pause start date becomes the first 회차 on or after it, judged on the stored schedule. */
    private async resolvePauseStart(principal: VerifiedTenantPrincipal, draft: ServiceRecordEditDraft, operation: Operation): Promise<Operation> {
        if (operation.kind !== "resumeReplan" || operation.pauseStartDate === undefined) return operation;
        withPlaceholderSession(operation); // rejects a fromSessionIndex given next to a pauseStartDate
        const pauseStartDate = operation.pauseStartDate;
        const parsedDate = new Date(pauseStartDate);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pauseStartDate) || Number.isNaN(parsedDate.getTime())
            || parsedDate.toISOString().slice(0, 10) !== pauseStartDate) {
            throw question("INVALID_DATE", "pauseStartDate는 실제 존재하는 YYYY-MM-DD 날짜여야 해요.");
        }
        const preview = await this.editor.previewDraft(principal.branchId, draft.id, principal.userId, { expectedDraftVersion: draft.draftVersion }) as Preview;
        if (preview.blockingReasons.length > 0) throw blockingQuestion(preview.blockingReasons, draft.sourceSnapshot as unknown as ServiceRecordEditSource);
        const first = preview.before.sessions.find((entry) => entry.serviceDate >= pauseStartDate);
        if (!first) {
            throw new AgentActionQuestionError("INVALID_DATE", `[INVALID_DATE] ${operation.pauseStartDate} 이후에 남은 회차가 없어요. 사용자에게 중단 시작일이나 회차를 다시 확인하세요.`);
        }
        const { pauseStartDate: _pauseStartDate, ...rest } = operation;
        void _pauseStartDate;
        return { ...rest, fromSessionIndex: first.sessionIndex };
    }

    /**
     * Discards the draft this call created, once, at the version this call last saw. The discard is
     * a compare-and-swap: if a person has changed the draft since, it is theirs and is left alone.
     * Returns the failure to surface when the draft could not be discarded.
     */
    private async discardTransient(
        principal: VerifiedTenantPrincipal,
        draft: ServiceRecordEditDraft,
    ): Promise<AgentActionCertainFailureError | null> {
        try {
            await this.editor.discardDraft(principal.branchId, draft.id, principal.userId, { expectedDraftVersion: draft.draftVersion });
            return null;
        } catch (error) {
            this.logger.error(`could not discard transient service-record draft ${draft.id}: ${error instanceof Error ? error.message : String(error)}`);
            return new AgentActionCertainFailureError("[DRAFT_CLEANUP_FAILED] 제공기록지 임시 초안을 정리하지 못했어요. 편집기에 임시 초안이 남아 있을 수 있으니 편집기에서 버린 뒤 다시 요청해 달라고 안내하세요.");
        }
    }
}
