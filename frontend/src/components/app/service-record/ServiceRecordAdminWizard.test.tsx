import { adminServiceRecordEditApi } from "@/features/service-records/api/admin-service-record-edit.api";
import { AdminServiceRecordEditApiError } from "@/features/service-records/types";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { getServiceRecordHeaderFieldError } from "@babyjamjam/service-record-ui";
import {
    buildAdminServiceRecordContext,
    buildAdminServiceRecordView,
    ServiceRecordAdminViewer,
    ServiceRecordAdminWizard,
    type AdminServiceRecordEditorOverview,
} from "./ServiceRecordAdminWizard";
import type { AdminServiceRecordEditState } from "@/features/service-records/types";

function makeSession(
    sessionIndex: number,
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        sessionIndex,
        serviceDate: `2026-07-${String(10 + sessionIndex).padStart(2, "0")}`,
        locked: false,
        submittedAt: null,
        updatedAt: "2026-07-01T00:00:00.000Z",
        answers: {
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
        },
        etcService: null,
        notes: null,
        paymentConfirmed: true,
        hasMomApproval: false,
        employeeId: null,
        employeeName: null,
        formVersion: 1,
        ...overrides,
    };
}

const header = {
    momName: "김산모",
    momBirth: "900101",
    babyName: "김아기",
    babyBirth: "260714",
    deliveryType: "자연분만",
    babyWeight: "3.2",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
};

const assignment = (scheduleId: number, sessions: Record<string, unknown>[]) => ({
    scheduleId,
    startDate: "2026-07-10",
    endDate: "2026-07-14",
    replaced: false,
    employee: { id: scheduleId, name: `제공${scheduleId}`, phone: "010-0000-0000" },
    link: { status: "sent", scheduledFor: null, sentCount: 1, lastSentAt: null, token: null },
    header,
    totalSessions: 3,
    sessions,
    signatureDoc: null,
});

const overview = {
    record: {
        id: "case-1",
        status: "COMPLETED",
        startDate: "2026-07-10",
        endDate: "2026-07-14",
        totalSessions: 3,
        completedAt: "2026-07-14T00:00:00.000Z",
        finalizationDueAt: null,
        finalizedAt: "2026-07-15T00:00:00.000Z",
        documentsCompletedAt: null,
        lastError: null,
        header,
        sessions: [
            makeSession(1, {
                locked: true,
                submittedAt: "2026-07-11T01:00:00.000Z",
                hasMomApproval: true,
                clientSignature: "data:image/png;base64,stored-signature",
                clientSignedAt: "2026-07-11T01:00:00.000Z",
            }),
            makeSession(2, { serviceDate: "2025-01-15", locked: false }),
        ],
        signatureDocs: [],
    },
    assignments: [
        assignment(7, [
            makeSession(1, {
                serviceDate: "2026-07-12",
                employeeId: 7,
                employeeName: "대체 제공",
                clientSignature: "data:image/png;base64,supplemental-signature",
                clientSignedAt: "2026-07-12T01:00:00.000Z",
            }),
            makeSession(3, { serviceDate: "2026-07-13" }),
        ]),
    ],
} as unknown as AdminServiceRecordEditorOverview;

const plannedDates = [
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
    "2026-07-09",
    "2026-07-10",
    "2026-07-13",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-20",
];

const plannedOverview = {
    ...overview,
    scheduleProjection: {
        entries: plannedDates.map((serviceDate, index) => ({
            sessionIndex: index + 1,
            serviceDate,
            originalDate: serviceDate,
            assignmentId: "assignment-7",
            scheduleId: 7,
            employeeId: 7,
            provenanceVersion: "projection-1",
        })),
        blockingReasons: [],
    },
    record: {
        ...overview.record,
        totalSessions: 13,
    },
    assignments: overview.assignments.map((item) => ({ ...item, totalSessions: 13 })),
} as unknown as AdminServiceRecordEditorOverview;

function makeDraftState(
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

const confirmPreviewResponse = {
    previewId: "preview-confirm-1",
    draftId: "draft-1",
    draftVersion: 1,
    sourceCaseVersion: 1,
    sourceFingerprint: "source-1",
    requiredSessionCount: 3,
    calendarVersion: "kr-2026",
    before: {
        startDate: "2026-07-10",
        endDate: "2026-07-14",
        sessions: [1, 2, 3].map((sessionIndex) => ({
            sessionIndex,
            serviceDate: `2026-07-${String(9 + sessionIndex).padStart(2, "0")}`,
            originalDate: `2026-07-${String(9 + sessionIndex).padStart(2, "0")}`,
            assignmentId: "assignment-7",
            scheduleId: 7,
            employeeId: 7,
            provenanceVersion: "projection-1",
        })),
    },
    after: {
        startDate: "2026-07-10",
        endDate: "2026-07-14",
        sessions: [1, 2, 3].map((sessionIndex) => ({
            sessionIndex,
            serviceDate: `2026-07-${String(9 + sessionIndex).padStart(2, "0")}`,
            originalDate: `2026-07-${String(9 + sessionIndex).padStart(2, "0")}`,
            assignmentId: "assignment-7",
            scheduleId: 7,
            employeeId: 7,
            provenanceVersion: "projection-1",
        })),
    },
    provenance: [{
        assignmentId: "assignment-7",
        scheduleId: 7,
        employeeId: 7,
        startDate: "2026-07-10",
        endDate: "2026-07-14",
        provenanceVersion: "projection-1",
    }],
    contentChanges: { headerChanged: false, changedSessionIndexes: [1] },
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

const confirmResult = {
    status: "confirmed",
    caseId: "case-1",
    clientId: 42,
    draftId: "draft-1",
    draftVersion: 1,
    caseVersion: 2,
    revisionId: "revision-1",
    revisionNumber: 1,
    documentStatus: "waiting_for_completion",
    confirmedAt: "2026-09-08T01:02:03.000Z",
};

describe("service-record header validation", () => {
    const now = new Date("2026-09-18T00:00:00.000Z");

    it.each([
        ["momBirth", "2024-02-29", false],
        ["babyBirth", "2026-09-17", false],
        ["momBirth", "2026-02-30", true],
        ["babyBirth", "2024-02-290", true],
        ["babyBirth", "2026-09-19", true],
        ["momBirth", "240229", true],
    ] as const)("validates %s=%s with the strict ISO calendar contract", (key, value, invalid) => {
        const error = getServiceRecordHeaderFieldError(key, value, now);
        expect(Boolean(error)).toBe(invalid);
    });

    it.each([
        ["3.2", false],
        [".5", false],
        ["-1", true],
        ["0", true],
        ["0.0", true],
        ["NaN", true],
        ["Infinity", true],
        ["0x10", true],
        ["1e2", true],
    ] as const)("validates babyWeight=%s as a finite positive decimal", (value, invalid) => {
        const error = getServiceRecordHeaderFieldError("babyWeight", value, now);
        expect(Boolean(error)).toBe(invalid);
    });

    it("allows omitted partial values but rejects whitespace as a supplied birthday", () => {
        expect(getServiceRecordHeaderFieldError("momBirth", "", now)).toBeNull();
        expect(getServiceRecordHeaderFieldError("babyBirth", "   ", now)).not.toBeNull();
        expect(getServiceRecordHeaderFieldError("babyWeight", undefined, now)).toBeNull();
    });
});

describe("ServiceRecordAdminWizard", () => {
    it("keeps an assignment collision as a selectable supplemental record", () => {
        const view = buildAdminServiceRecordView(overview);
        expect(view.context.sessions.map((session) => session.sessionIndex)).toEqual([1, 3]);
        expect(view.supplementalSessions).toHaveLength(2);
        expect(view.supplementalSessions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sourceLabel: expect.stringContaining("배정 #7"),
                sessionIndex: 1,
            }),
            expect.objectContaining({
                sourceLabel: expect.stringContaining("기간 밖 보관회차"),
                sessionIndex: 2,
            }),
        ]));
        expect(view.supplementalSessions.find((item) => item.sessionIndex === 1)).toEqual(expect.objectContaining({
            sourceLabel: "배정 #7",
            sessionIndex: 1,
        }));
        expect(buildAdminServiceRecordContext(overview).sessions).toHaveLength(2);
    });

    it("keeps a legacy session beyond the canonical count as a labeled supplemental record", () => {
        const overviewWithLegacyRow = {
            ...overview,
            assignments: overview.assignments.map((item) => ({
                ...item,
                totalSessions: 15,
                sessions: [...item.sessions, makeSession(5, { serviceDate: "2026-07-20" })],
            })),
        } as AdminServiceRecordEditorOverview;

        const view = buildAdminServiceRecordView(overviewWithLegacyRow);

        expect(view.context.totalSessions).toBe(3);
        expect(view.context.sessions.map((session) => session.sessionIndex)).toEqual([1, 3]);
        expect(view.supplementalSessions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sessionIndex: 5,
                sourceLabel: expect.stringContaining("기간 밖 보관회차"),
            }),
        ]));

        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={overviewWithLegacyRow} />);
        fireEvent.click(screen.getByRole("button", { name: /5회차/ }));
        expect(container).toHaveTextContent("5회차 ·");
        expect(container).toHaveTextContent("2026.07.20");
    });

    it("renders all sessions as navigable read-only days and preserves out-of-period dates", () => {
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={overview} />);

        const dayButtons = container.querySelectorAll('[data-slot="day"]');
        expect(dayButtons).toHaveLength(3);
        expect([...dayButtons].every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
        expect(container.querySelector('[data-slot="provider"]')).toHaveClass("org");
        expect(container.querySelector('[data-slot="provider"]')).toHaveTextContent("관리자 편집");
        expect(container).toHaveTextContent("2025.01.15");
        expect(container).toHaveTextContent("같은 회차의 추가 기록");
    });

    it("shows an existing signature and allows a supplemental assignment to be selected", () => {
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={overview} />);
        const supplemental = screen.getByRole("button", { name: /1회차 · 배정 #7/ });
        fireEvent.click(supplemental);
        expect(container).toHaveTextContent("2026.07.12");
        expect(screen.getByRole("img", { name: "산모 서명" })).toHaveAttribute("src", "data:image/png;base64,supplemental-signature");

        fireEvent.click(container.querySelector('[data-component="desktop_service-record-admin_wizard_body_day-back"]')!);
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        expect(screen.getByRole("img", { name: "산모 서명" })).toHaveAttribute("src", "data:image/png;base64,stored-signature");
    });

    it("uses the authoritative 1..N schedule projection for unwritten future days without creating rows", () => {
        const view = buildAdminServiceRecordView(plannedOverview);

        expect(view.context.totalSessions).toBe(13);
        expect(view.plannedSessions).toHaveLength(13);
        expect(view.context.sessions.map((session) => session.sessionIndex)).toEqual([1, 3]);

        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={plannedOverview} initialDraftState={makeDraftState()} />,
        );
        expect(container.querySelectorAll('[data-slot="day"]')).toHaveLength(13);
        expect(container).toHaveTextContent("2026.07.20");

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[12]);
        expect(container).toHaveTextContent("2026.07.20");
        expect(container.querySelectorAll('[data-component$="_body_date-edit"]')).toHaveLength(1);
        const dateEdit = container.querySelector('[data-component$="_body_date-edit"]');
        const dateChip = container.querySelector('[data-component$="_body_date-chip"]');
        expect(dateChip).not.toContainElement(dateEdit as HTMLElement);
        expect(dateEdit?.parentElement).toBe(dateChip?.parentElement);
        expect(dateEdit?.parentElement).toHaveClass("date-row");
        expect(dateEdit).toHaveAttribute("data-slot", "sec-edit");
        expect(dateEdit).toHaveAttribute("class", "sec-edit");
        expect(dateEdit).toHaveAttribute("type", "button");
    });
});

describe("ServiceRecordAdminViewer", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("does not render customer data for denied responses", async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
        render(<ServiceRecordAdminViewer clientId="42" />);

        await waitFor(() => expect(screen.getByText("이 기록을 조회할 권한이 없습니다.")).toBeInTheDocument());
        expect(screen.queryByText("김산모")).not.toBeInTheDocument();
        expect(global.fetch).toHaveBeenCalledWith(
            "/api/admin/service-records/client/42/editor",
            expect.objectContaining({ cache: "no-store" }),
        );
    });

    it("does not enable editing when the source changes during the overview load", async () => {
        jest.spyOn(adminServiceRecordEditApi, "getDraft")
            .mockResolvedValueOnce({ ...makeDraftState(), draft: null })
            .mockResolvedValueOnce({ ...makeDraftState(), draft: null, sourceFingerprint: "new-source", sourceCaseVersion: 2 });
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => overview });
        const { container } = render(<ServiceRecordAdminViewer clientId="42" />);
        await waitFor(() => expect(screen.getByRole("button", { name: "최신 기록 불러오기" })).toBeInTheDocument());
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        expect(container.querySelector('[data-slot="review"] [data-slot="sec-edit"]')).toBeNull();
        expect(container.querySelector('[data-component$="_body_date-edit"]')).toBeDisabled();
    });
});


describe("per-session administrator editing", () => {
    const originalFetch = global.fetch;
    const dates = ["2026-09-07", "2026-09-08", "2026-09-09"];
    const sessionOverview = {
        ...overview,
        record: { ...overview.record, startDate: dates[0], endDate: dates[2], totalSessions: 3,
            sessions: dates.map((serviceDate, index) => makeSession(index + 1, { serviceDate, submittedAt: "2026-09-08T07:14:00Z", clientSignedAt: "2026-09-08T07:14:00Z", clientSignature: "data:image/png;base64,original" })) },
        assignments: [],
        scheduleProjection: { entries: dates.map((serviceDate, index) => ({
            sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
            assignmentId: "assignment-7", scheduleId: 7, employeeId: 7, provenanceVersion: "projection-1",
        })), blockingReasons: [] },
    } as unknown as AdminServiceRecordEditorOverview;
    function open() {
        const result = render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(result.container.querySelectorAll('[data-slot="day"]')[0]);
        return result;
    }
    function editNote(container: HTMLElement) {
        fireEvent.click(container.querySelectorAll('[data-slot="review"] [data-slot="sec-edit"]')[2]);
        fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "수정된 서비스" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
    }
    beforeEach(() => {
        jest.spyOn(adminServiceRecordEditApi, "startDraft").mockResolvedValue(makeDraftState());
        jest.spyOn(adminServiceRecordEditApi, "updateDraft").mockResolvedValue(makeDraftState({ sessions: [{ sessionIndex: 1, etcService: "수정된 서비스" }] }, 2));
        jest.spyOn(adminServiceRecordEditApi, "previewDraft").mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2,
            before: { startDate: dates[0], endDate: dates[2], sessions: sessionOverview.scheduleProjection!.entries },
            after: { startDate: dates[0], endDate: dates[2], sessions: sessionOverview.scheduleProjection!.entries },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        jest.spyOn(adminServiceRecordEditApi, "confirmDraft").mockResolvedValue(confirmResult as Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>);
        jest.spyOn(adminServiceRecordEditApi, "getDraft").mockResolvedValue({ ...makeDraftState(), draft: null });
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => sessionOverview });
    });
    afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

    it("opens the review immediately without a draft toolbar or any write", () => {
        const { container } = open();
        expect(screen.getByText("기록 내용 확인")).toBeInTheDocument();
        expect(container.querySelector('[data-slot="admin-toolbar"]')).toBeNull();
        expect(screen.queryByText("초안 저장")).not.toBeInTheDocument();
        expect(container.querySelector('[data-component$="_body_date-edit"]')).toBeEnabled();
        fireEvent.click(screen.getByRole("button", { name: "확인" }));
        expect(container.querySelectorAll('[data-slot="day"]')).toHaveLength(3);
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
    });

    it("disables the administrator final confirmation for invalid numeric answers without mutating the draft", () => {
        const invalidOverview = {
            ...sessionOverview,
            record: {
                ...sessionOverview.record,
                sessions: (sessionOverview.record?.sessions ?? []).map((session, index) => index === 0
                    ? { ...session, answers: { ...session.answers, meals_meal: "-1" } }
                    : session),
            },
        } as unknown as AdminServiceRecordEditorOverview;
        const { container } = render(
            <ServiceRecordAdminWizard
                clientId="42"
                overview={invalidOverview}
                initialDraftState={{ ...makeDraftState(), draft: null }}
            />,
        );
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);

        const confirm = screen.getByRole("button", { name: "확인" });
        expect(confirm).toBeDisabled();
        fireEvent.click(confirm);
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
        expect(container).toHaveTextContent("식사 -1회");
    });

    it("saves only after 수정 확인 and returns to the overview", async () => {
        const { container } = open();
        editNote(container);
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(container.querySelectorAll('[data-slot="day"]')).toHaveLength(3));
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith("draft-1", 1, { sessions: [{ sessionIndex: 1, etcService: "수정된 서비스" }] }, undefined);
    });

    it("blocks a changed source before the first PATCH and preserves local input", async () => {
        jest.mocked(adminServiceRecordEditApi.startDraft).mockResolvedValue({ ...makeDraftState(), sourceFingerprint: "source-2", sourceCaseVersion: 2 });
        const { container } = open();
        editNote(container);
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "최신 기록 불러오기" })).toBeInTheDocument());
        expect(container).toHaveTextContent("수정된 서비스");
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
    });

    it("fails closed when the displayed source has no verified identity", async () => {
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} />);
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        expect(container.querySelectorAll('[data-slot="review"] [data-slot="sec-edit"]')[0]).toBeUndefined();
        expect(screen.getByRole("button", { name: "최신 기록 불러오기" })).toBeInTheDocument();
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
    });

    it("lets an existing draft be inspected and explicitly confirmed without discarding", async () => {
        const existing = makeDraftState({ header: { momName: "기존 수정 산모" }, sessions: [{ sessionIndex: 2, etcService: "이전 수정 내용" }] }, 2);
        jest.mocked(adminServiceRecordEditApi.getDraft).mockResolvedValue(existing);
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2, contentChanges: { headerChanged: true, changedSessionIndexes: [2] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={existing} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 확인" }));
        expect(screen.getByDisplayValue("기존 수정 산모")).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "확인" }));
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[1]);
        expect(container).toHaveTextContent("이전 수정 내용");
        fireEvent.click(screen.getByRole("button", { name: "확인" }));
        fireEvent.click(screen.getByRole("button", { name: "이전 수정사항 검토" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "수정 확정" })).toBeEnabled());
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "수정 확정" }));
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
    });

    it("preserves basic-information editing with an explicit confirmation", async () => {
        jest.mocked(adminServiceRecordEditApi.updateDraft).mockResolvedValue(makeDraftState({ header: { momName: "이예지" } }, 2));
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2, contentChanges: { headerChanged: true, changedSessionIndexes: [] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        fireEvent.change(screen.getByDisplayValue("김산모"), { target: { value: "이예지" } });
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith("draft-1", 1, { header: { momName: "이예지" } }, undefined);
    });

    it("shows the date reason inline, preserves the formatted invalid value, and blocks confirmation", () => {
        render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));

        const input = screen.getByLabelText(/^신생아 출생일자/);
        fireEvent.change(input, { target: { value: "20260230" } });

        expect(input).toHaveValue("2026-02-30");
        expect(input).toHaveAttribute("aria-invalid", "true");
        expect(input).toHaveAttribute("aria-describedby");
        const errorId = input.getAttribute("aria-describedby");
        expect(errorId).toBeTruthy();
        expect(document.getElementById(errorId!)).toHaveTextContent("달력에 없거나");
        expect(document.getElementById(errorId!)).toHaveAttribute("data-component", expect.stringContaining("baby-birth"));

        const confirm = screen.getByRole("button", { name: "수정 확인" });
        expect(confirm).toBeDisabled();
        fireEvent.click(confirm);
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
        expect(screen.getByDisplayValue("2026-02-30")).toBeInTheDocument();
    });

    it("shows the weight reason inline and keeps a nonpositive entry from confirmation", () => {
        render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));

        const input = screen.getByLabelText("신생아 몸무게 (kg)");
        fireEvent.change(input, { target: { value: "-1" } });

        expect(input).toHaveValue("-1");
        expect(input).toHaveAttribute("aria-invalid", "true");
        const errorId = input.getAttribute("aria-describedby");
        expect(errorId).toBeTruthy();
        expect(document.getElementById(errorId!)).toHaveTextContent("0보다 큰 숫자");
        expect(document.getElementById(errorId!)).toHaveAttribute("data-component", expect.stringContaining("baby-weight"));
        expect(screen.getByRole("button", { name: "수정 확인" })).toBeDisabled();
    });

    it("validates only changed header fields when legacy values remain untouched", async () => {
        const legacyOverview = {
            ...sessionOverview,
            record: {
                ...sessionOverview.record,
                header: { ...header, babyBirth: "2026-09-01", babyWeight: "Infinity" },
            },
        } as unknown as AdminServiceRecordEditorOverview;
        jest.mocked(adminServiceRecordEditApi.updateDraft).mockResolvedValue(makeDraftState({ header: { momName: "이예지" } }, 2));
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse,
            draftVersion: 2,
            contentChanges: { headerChanged: true, changedSessionIndexes: [] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);

        render(<ServiceRecordAdminWizard clientId="42" overview={legacyOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        expect(screen.getByLabelText(/^신생아 출생일자/)).toHaveValue("2026-09-01");
        expect(screen.getByLabelText("신생아 몸무게 (kg)")).toHaveValue("Infinity");
        fireEvent.change(screen.getByLabelText("산모 성명"), { target: { value: "이예지" } });

        const confirm = screen.getByRole("button", { name: "수정 확인" });
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith("draft-1", 1, { header: { momName: "이예지" } }, undefined);
    });

    it("rejects newly entered name whitespace even when untouched birthdays are legacy values", () => {
        render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        const name = screen.getByLabelText("산모 성명");
        fireEvent.change(name, { target: { value: "이 예지" } });
        expect(name).toHaveValue("이 예지");
        expect(name).toHaveAttribute("aria-invalid", "true");
        expect(document.getElementById(name.getAttribute("aria-describedby")!)).toHaveTextContent("띄어쓰기");
        const confirm = screen.getByRole("button", { name: "수정 확인" });
        expect(confirm).toBeDisabled();
        fireEvent.click(confirm);
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
        fireEvent.change(name, { target: { value: "이예지" } });
        expect(name).not.toHaveAttribute("aria-invalid", "true");
        expect(confirm).toBeEnabled();
    });

    it("formats a changed birthday and saves only that ISO value after explicit confirmation", async () => {
        jest.mocked(adminServiceRecordEditApi.updateDraft).mockResolvedValue(makeDraftState({ header: { momBirth: "1999-01-01" } }, 2));
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2, contentChanges: { headerChanged: true, changedSessionIndexes: [] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        const birth = screen.getByLabelText(/^산모 생년월일/);
        expect(birth).toHaveAttribute("placeholder", "1999-01-01");
        expect(screen.getByLabelText(/^신생아 출생일자/)).toHaveAttribute("placeholder", "1999-01-01");
        fireEvent.change(birth, { target: { value: "19990101" } });
        expect(birth).toHaveValue("1999-01-01");
        expect(birth).not.toHaveAttribute("aria-invalid", "true");
        expect(screen.getByLabelText(/^신생아 출생일자/)).toHaveValue("260714");
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith("draft-1", 1, { header: { momBirth: "1999-01-01" } }, undefined);
    });

    it.each(["김산모", "900101", "김아기", "260714", "3.2"])("does not save when a required header value (%s) is blank", (value) => {
        render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        fireEvent.change(screen.getByDisplayValue(value), { target: { value: " " } });
        const confirm = screen.getByRole("button", { name: "수정 확인" });
        expect(confirm).toBeDisabled();
        fireEvent.click(confirm);
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
    });

    it("rejects a preview that omits an approved suffix date move", async () => {
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2,
            before: { startDate: dates[0], endDate: dates[2], sessions: sessionOverview.scheduleProjection!.entries },
            after: { startDate: dates[0], endDate: dates[2], sessions: sessionOverview.scheduleProjection!.entries.map((entry, index) => ({ ...entry, serviceDate: index === 0 ? "2026-09-08" : entry.serviceDate })) },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        const { container } = open();
        fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
        fireEvent.click(screen.getAllByRole("combobox")[2]);
        fireEvent.click(screen.getByRole("option", { name: "8일" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "최신 기록 불러오기" })).toBeInTheDocument());
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
    });

    it("shows unchanged 확인 when an edit is reverted", () => {
        const { container } = open();
        fireEvent.click(container.querySelectorAll('[data-slot="review"] [data-slot="sec-edit"]')[2]);
        fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "수정" } });
        fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "" } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        expect(screen.getByRole("button", { name: "확인" })).toBeInTheDocument();
    });

    it("cancels a date collision without changing dates or writing, then stages an approved move", async () => {
        const { container } = open();
        fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
        fireEvent.click(screen.getAllByRole("combobox")[2]);
        fireEvent.click(screen.getByRole("option", { name: "8일" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        const modal = screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" });
        expect(modal).toHaveTextContent("1회차 서비스 제공일을 9월 8일로 수정하면 다음 회차와 날짜가 겹칩니다. 뒷 회차들의 서비스 제공일도 1 영업일씩 수정할까요?");
        fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        fireEvent.click(screen.getAllByRole("combobox")[2]);
        fireEvent.click(screen.getByRole("option", { name: "8일" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        expect(container.querySelector('[data-slot="datechip"]')).toHaveTextContent("2026.09.08");
        expect(screen.getByRole("button", { name: "수정 확인" })).toBeInTheDocument();
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
    });

    it("retries an unknown confirmation result with exactly the same request", async () => {
        jest.mocked(adminServiceRecordEditApi.confirmDraft).mockRejectedValueOnce(new Error("network"));
        const { container } = open();
        editNote(container);
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole("button", { name: "수정 확인" })).toBeEnabled());
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(2));
        const calls = jest.mocked(adminServiceRecordEditApi.confirmDraft).mock.calls;
        expect(calls[1]).toEqual(calls[0]);
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledTimes(1);
    });

    it("confirms an approved collision shift once with the explicit suffix flag", async () => {
        const after = sessionOverview.scheduleProjection!.entries.map((entry, index) => ({ ...entry, serviceDate: ["2026-09-08", "2026-09-09", "2026-09-10"][index] }));
        jest.mocked(adminServiceRecordEditApi.updateDraft).mockResolvedValue(makeDraftState({ sessions: after.map(({ sessionIndex, serviceDate }) => ({ sessionIndex, serviceDate })) }, 2));
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2,
            before: { startDate: dates[0], endDate: dates[2], sessions: sessionOverview.scheduleProjection!.entries },
            after: { startDate: "2026-09-08", endDate: "2026-09-10", sessions: after },
            contentChanges: { headerChanged: false, changedSessionIndexes: [1, 2, 3] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        const { container } = open();
        fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
        fireEvent.click(screen.getAllByRole("combobox")[2]);
        fireEvent.click(screen.getByRole("option", { name: "8일" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith("draft-1", 1, { sessions: [{ sessionIndex: 1 }] }, { sessionIndex: 1, toDate: "2026-09-08", shiftFollowing: true });
    });

    it("does not confirm another session's content even when its date move was approved", async () => {
        jest.mocked(adminServiceRecordEditApi.updateDraft).mockResolvedValue(makeDraftState({ sessions: [{ sessionIndex: 2, notes: "other administrator" }] }, 2));
        const { container } = open();
        editNote(container);
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "최신 기록 불러오기" })).toBeInTheDocument());
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
    });

    it("does not confirm after a draft conflict and preserves input", async () => {
        jest.mocked(adminServiceRecordEditApi.updateDraft).mockRejectedValue(new AdminServiceRecordEditApiError(409, {}));
        const { container } = open();
        editNote(container);
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "최신 기록 불러오기" })).toBeInTheDocument());
        expect(container).toHaveTextContent("수정된 서비스");
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
    });
});
