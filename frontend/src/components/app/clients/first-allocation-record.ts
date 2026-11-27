import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { withServiceRecordCase } from "@/features/service-records/utils/case-selection";
import { api } from "@/lib/api/client";

const CASE_UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

interface FirstAllocationRecord {
    caseId: string;
    currentPrimary: { scheduleId: number; employeeId: number } | null;
}

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
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
    const candidates = data.cases.filter((item) => item.babyId === null && !item.retired &&
        item.status === "IN_PROGRESS" && item.submittedSessions > 0);
    if (candidates.length === 0) return null;

    const [summary] = candidates;
    if (data.cases.length !== 1 || !CASE_UUID.test(summary.caseId) ||
        data.record?.id !== summary.caseId || data.record.status !== "IN_PROGRESS" ||
        data.record.completedAt || data.record.finalizedAt) {
        throw new Error("Unresolved service record");
    }

    // The overview counts locked days. Confirm the signature via the existing
    // manager read and keep only the case ID and current assignment in the form cache.
    const { data: editor } = await api.get<unknown>(
        withServiceRecordCase(`/admin/service-records/client/${clientId}/editor`, summary.caseId),
        { signal },
    );
    assertScope();
    const record = object(object(editor)?.record);
    const editorCases = object(editor)?.cases;
    const editorSummary = Array.isArray(editorCases) && editorCases.length === 1 ? object(editorCases[0]) : undefined;
    if (record?.id !== summary.caseId || record.status !== "IN_PROGRESS" || record.completedAt ||
        record.finalizedAt || !Array.isArray(record.sessions) || editorSummary?.caseId !== summary.caseId ||
        editorSummary.babyId !== null || editorSummary.retired !== false) {
        throw new Error("Service record changed");
    }
    const signedSessions = record.sessions.flatMap((value: unknown) => {
        const session = object(value);
        return session?.locked === true && session.hasMomApproval === true &&
            typeof session.clientSignedAt === "string" && session.clientSignedAt.length > 0 &&
            typeof session.clientSignature === "string" && session.clientSignature.length > 0
            ? [session.employeeId] : [];
    });
    if (signedSessions.length === 0) return null;

    const primary = data.legacyLinkAssignment;
    const currentPrimary = primary ? { scheduleId: primary.scheduleId, employeeId: primary.employeeId } : null;
    const editorPrimary = object(object(editor)?.legacyLinkAssignment);
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
