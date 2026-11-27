import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { withServiceRecordCase } from "@/features/service-records/utils/case-selection";
import { api } from "@/lib/api/client";

const CASE_UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

interface FirstAllocationRecord {
    caseId: string;
    currentPrimary: { scheduleId: number; employeeId: number } | null;
}

function isBindingStatus(status: unknown): boolean {
    return status === "IN_PROGRESS" || status === "READY_TO_FINALIZE";
}

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function readCurrentPrimary(
    overview: Record<string, unknown> | undefined,
    status: unknown,
    assignees: unknown,
): FirstAllocationRecord["currentPrimary"] {
    const primary = overview?.legacyLinkAssignment;
    if (primary !== null) {
        const assignment = object(primary);
        if (typeof assignment?.scheduleId !== "number" || typeof assignment.employeeId !== "number") {
            throw new Error("Missing service record owner");
        }
        return { scheduleId: assignment.scheduleId, employeeId: assignment.employeeId };
    }
    if (status !== "READY_TO_FINALIZE") return null;

    // The ordinary link action omits legacyLinkAssignment once all days are
    // complete. For binding, match the schedule to the summary's current primary.
    if (!Array.isArray(assignees) || !Array.isArray(overview?.assignments)) {
        throw new Error("Missing completed service record assignment");
    }
    const active = overview.assignments.map(object).filter((assignment) => assignment?.replaced === false);
    if (assignees.length !== 1) return null;
    const matchingSchedules = active.length <= 1 ? active : active.filter((assignment) =>
        Array.isArray(assignment?.sessions) && assignment.sessions.some((session: unknown) => object(session)?.locked === true));
    const [assignment] = matchingSchedules;
    const employeeId = object(assignees[0])?.id;
    if (matchingSchedules.length !== 1 || typeof assignment?.scheduleId !== "number" || typeof employeeId !== "number") {
        throw new Error("Missing completed service record owner");
    }
    return { scheduleId: assignment.scheduleId, employeeId };
}

export async function readFirstAllocationRecord(
    clientId: number,
    assertScope: () => void,
    signal: AbortSignal,
): Promise<FirstAllocationRecord | null> {
    assertScope();
    const { data } = await serviceRecordsApi.getClientOverview(clientId);
    assertScope();
    if (!Array.isArray(data.cases) || !Array.isArray(data.assignments)) {
        throw new Error("Missing service record overview");
    }
    const candidates = data.cases.filter((item) => {
        if (typeof item?.status !== "string" || typeof item.submittedSessions !== "number" ||
            typeof item.retired !== "boolean" || (item.babyId !== null && typeof item.babyId !== "string")) {
            throw new Error("Missing service record status");
        }
        return item.babyId === null && !item.retired && isBindingStatus(item.status) && item.submittedSessions > 0;
    });
    if (candidates.length === 0) {
        if (data.cases.length === 0 && data.record) throw new Error("Missing service record status");
        return null;
    }

    const [summary] = candidates;
    if (data.cases.length > 1) return null;
    if (!CASE_UUID.test(summary.caseId) ||
        data.record?.id !== summary.caseId || !isBindingStatus(data.record.status)) {
        throw new Error("Unresolved service record");
    }
    if (data.record.finalizedAt || object(data.record)?.finalizationStartedAt) return null;

    // The overview counts locked days. Confirm the signature via the existing
    // manager read and keep only the case ID and current assignment in the form cache.
    const { data: editor } = await api.get<unknown>(
        withServiceRecordCase(`/admin/service-records/client/${clientId}/editor`, summary.caseId),
        { signal },
    );
    assertScope();
    const editorData = object(editor);
    const record = object(editorData?.record);
    const editorCases = editorData?.cases;
    const editorSummary = Array.isArray(editorCases) && editorCases.length === 1 ? object(editorCases[0]) : undefined;
    if (record?.id !== summary.caseId || !isBindingStatus(record.status) ||
        record.finalizedAt || record.finalizationStartedAt || !Array.isArray(record.sessions) ||
        editorSummary?.caseId !== summary.caseId || editorSummary.status !== record.status ||
        editorSummary.babyId !== null || editorSummary.retired !== false) {
        throw new Error("Service record changed");
    }
    let lockedSessions = 0;
    const signedSessions = record.sessions.flatMap((value: unknown) => {
        const session = object(value);
        if (typeof session?.locked !== "boolean" || (session.locked &&
            (typeof session.hasMomApproval !== "boolean" || !("clientSignedAt" in session) || !("clientSignature" in session)))) {
            throw new Error("Missing service record signature status");
        }
        if (session.locked) lockedSessions += 1;
        const signed = session.locked && session.hasMomApproval === true &&
            typeof session.clientSignedAt === "string" && session.clientSignedAt.length > 0 &&
            typeof session.clientSignature === "string" && session.clientSignature.length > 0;
        if (!signed) return [];
        if (typeof session.employeeId !== "number" && session.employeeId !== null) {
            throw new Error("Missing signed session owner");
        }
        return [session.employeeId];
    });
    if (lockedSessions !== editorSummary.submittedSessions) throw new Error("Incomplete service record sessions");
    if (signedSessions.length === 0) return null;

    const currentPrimary = readCurrentPrimary(object(data), summary.status, summary.assignees);
    const editorPrimary = readCurrentPrimary(editorData, editorSummary.status, editorSummary.assignees);
    if (currentPrimary?.scheduleId !== editorPrimary?.scheduleId ||
        currentPrimary?.employeeId !== editorPrimary?.employeeId) {
        throw new Error("Service record owner changed");
    }
    return {
        caseId: summary.caseId,
        currentPrimary: signedSessions.every((employeeId) => employeeId === currentPrimary?.employeeId)
            ? currentPrimary : null,
    };
}
