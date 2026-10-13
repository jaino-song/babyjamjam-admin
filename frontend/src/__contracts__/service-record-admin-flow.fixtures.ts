import type { AdminServiceRecordEditorOverview } from "@/components/app/service-record/ServiceRecordAdminWizard";
import type { AdminServiceRecordEditState } from "@/features/service-records/types";

/**
 * Fixtures for the administrator service-record contract: one finished record
 * with three sessions, an authoritative schedule projection and no existing
 * edit draft. Builders are copied (minimally) from
 * ServiceRecordAdminWizard.test.tsx, which this contract leaves untouched.
 */

/** KST morning of the day before the first session, so every fixture date lies in the future of "today". */
export const NOW = new Date("2026-09-04T10:00:00+09:00");

export const CLIENT_ID = "42";
export const EDITOR_URL = `/api/admin/service-records/client/${CLIENT_ID}/editor`;

export const DATES = ["2026-09-07", "2026-09-08", "2026-09-09"] as const;

export const STORED_SIGNATURE = "data:image/png;base64,original";

export const HEADER = {
    momName: "김산모",
    momBirth: "1990-01-01",
    babyName: "김아기",
    babyBirth: "2026-07-14",
    deliveryType: "자연분만",
    babyWeight: "3.2",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
};

export const ANSWERS = {
    perineum: ["이상없음"],
    breast: ["이상없음"],
    excretion: ["이상없음"],
    sitzBath: "실시",
    meals_meal: "3",
    meals_snack: "1",
    temperature_temp: "36.5",
    sleep: "잘 잠",
    breastFeeding_count: "3",
    formulaFeeding_count: "2",
    formulaFeeding_ml: "90",
    stool: "정상변",
    bath: "실시",
    etcService: "",
    notes: "",
    paymentConfirmed: true,
};

function makeSession(sessionIndex: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        sessionIndex,
        serviceDate: DATES[sessionIndex - 1],
        locked: true,
        submittedAt: "2026-09-08T07:14:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        answers: ANSWERS,
        etcService: null,
        notes: null,
        paymentConfirmed: true,
        hasMomApproval: sessionIndex === 1,
        employeeId: null,
        employeeName: null,
        formVersion: 1,
        // Only the 1회 session carries a signature.
        clientSignature: sessionIndex === 1 ? STORED_SIGNATURE : null,
        clientSignedAt: null,
        ...overrides,
    };
}

export const scheduleEntries = DATES.map((serviceDate, index) => ({
    sessionIndex: index + 1,
    serviceDate,
    originalDate: serviceDate,
    assignmentId: "assignment-7",
    scheduleId: 7,
    employeeId: 7,
    provenanceVersion: "projection-1",
}));

export const overview = {
    record: {
        id: "case-1",
        status: "COMPLETED",
        startDate: DATES[0],
        endDate: DATES[2],
        totalSessions: 3,
        completedAt: "2026-09-09T00:00:00.000Z",
        finalizationDueAt: null,
        finalizedAt: "2026-09-10T00:00:00.000Z",
        documentsCompletedAt: null,
        lastError: null,
        header: HEADER,
        sessions: [1, 2, 3].map((sessionIndex) => makeSession(sessionIndex)),
        signatureDocs: [],
    },
    assignments: [],
    scheduleProjection: { entries: scheduleEntries, blockingReasons: [] },
} as unknown as AdminServiceRecordEditorOverview;

export function makeDraftState(
    changes: Record<string, unknown> = {},
    draftVersion = 1,
): AdminServiceRecordEditState {
    return {
        draft: {
            id: "draft-1",
            branchId: "branch-1",
            serviceRecordCaseId: "case-1",
            sourceCaseVersion: 1,
            sourceFingerprint: "source-1",
            sourceSnapshot: {},
            changes,
            draftVersion,
            status: "ACTIVE",
            createdByUserId: "admin-1",
            updatedByUserId: "admin-1",
            discardedByUserId: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            discardedAt: null,
        },
        sourceChanged: false,
        sourceCaseVersion: 1,
        sourceFingerprint: "source-1",
    };
}

/** The state the page loads when no edit is in progress. */
export const noDraftState = (): AdminServiceRecordEditState => ({ ...makeDraftState(), draft: null });

export const PREVIEW_ID = "preview-confirm-1";

export function makePreview(
    contentChanges: { headerChanged: boolean; changedSessionIndexes: number[] },
    draftVersion = 2,
) {
    return {
        previewId: PREVIEW_ID,
        draftId: "draft-1",
        draftVersion,
        sourceCaseVersion: 1,
        sourceFingerprint: "source-1",
        requiredSessionCount: 3,
        calendarVersion: "kr-2026",
        before: { startDate: DATES[0], endDate: DATES[2], sessions: scheduleEntries },
        after: { startDate: DATES[0], endDate: DATES[2], sessions: scheduleEntries },
        provenance: [{
            assignmentId: "assignment-7",
            scheduleId: 7,
            employeeId: 7,
            startDate: DATES[0],
            endDate: DATES[2],
            provenanceVersion: "projection-1",
        }],
        contentChanges,
        impactedAssignments: [],
        blockingReasons: [],
        signatureMetadata: { treatment: "preserve_existing", evidence: "observed", sessions: [] },
        documentScope: {
            evidence: "observed",
            serviceRecordSnapshot: { documentIds: ["doc-1"], snapshotVersion: 1, chunks: [] },
            currentRevision: { id: null, revisionNumber: null, formVersion: null },
            form: { version: 1 },
            contract: { currentDocumentId: "contract-1", stage: "in_progress" },
        },
    };
}

export const confirmResult = {
    status: "confirmed",
    caseId: "case-1",
    clientId: 42,
    draftId: "draft-1",
    draftVersion: 2,
    caseVersion: 2,
    revisionId: "revision-1",
    revisionNumber: 1,
    documentStatus: "waiting_for_completion",
    confirmedAt: "2026-09-08T01:02:03.000Z",
};
