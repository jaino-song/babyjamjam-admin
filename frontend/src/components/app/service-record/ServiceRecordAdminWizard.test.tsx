import { adminServiceRecordEditApi } from "@/features/service-records/api/admin-service-record-edit.api";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { createKrBusinessDayCalendar, KR_BUILTIN_CALENDAR as KR_BUILTIN_CALENDAR_FOR_TEST, KR_BUILTIN_HOLIDAYS } from "@/lib/date/business-days";
import { subscribeServiceRecordCaseChanges } from "@/features/service-records/case-events";
import { AdminServiceRecordEditApiError } from "@/features/service-records/types";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import {
    DEFAULT_DAILY_ANSWERS,
    ServiceRecordWizard,
    getServiceRecordHeaderFieldError,
    type ServiceRecordWizardProps,
} from "@babyjamjam/service-record-ui";
import {
    buildAdminServiceRecordContext,
    buildAdminServiceRecordView,
    ServiceRecordAdminViewer,
    ServiceRecordAdminWizard,
    type AdminServiceRecordEditorOverview,
} from "./ServiceRecordAdminWizard";
import type { AdminServiceRecordEditChanges, AdminServiceRecordEditState } from "@/features/service-records/types";

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/features/service-records/case-events", () => ({
    subscribeServiceRecordCaseChanges: jest.fn(() => () => undefined),
}));
jest.mock("@babyjamjam/shared/utils/service-record-schedule", () => {
    const actual = jest.requireActual("@babyjamjam/shared/utils/service-record-schedule");
    return { ...actual, moveServiceRecordSessionDate: jest.fn(actual.moveServiceRecordSessionDate) };
});

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
    let sentChanges: AdminServiceRecordEditChanges = {};
    let movedDates: Record<number, string> = {};
    function echoedDraft(version: number, withMoves: boolean) {
        const sessions = new Map((sentChanges.sessions ?? []).map((session) => [session.sessionIndex, { ...session }]));
        if (withMoves) {
            for (const [index, serviceDate] of Object.entries(movedDates)) {
                sessions.set(Number(index), { ...sessions.get(Number(index)), sessionIndex: Number(index), serviceDate });
            }
        }
        return makeDraftState({
            ...(sentChanges.header ? { header: sentChanges.header } : {}),
            sessions: [...sessions.values()],
        }, version);
    }
    function editNoteOn(container: HTMLElement, text: string) {
        fireEvent.click(container.querySelectorAll('[data-slot="review"] [data-slot="sec-edit"]')[2]);
        fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: text } });
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
    }
    function acceptEdit() {
        fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
    }
    /** Pick a day-of-month in the date dialog of the open session and apply it. */
    function pickDate(container: HTMLElement, sessionLabel: string, option: string, follow?: "변경하기" | "그대로 두기") {
        fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
        fireEvent.click(screen.getAllByRole("combobox")[2]);
        fireEvent.click(screen.getByRole("option", { name: option }));
        fireEvent.click(within(screen.getByRole("dialog", { name: `${sessionLabel} 서비스 제공일 수정` })).getByRole("button", { name: "수정" }));
        if (follow) fireEvent.click(within(screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" })).getByRole("button", { name: follow }));
    }
    const previewDialog = () => screen.getByRole("dialog", { name: "초안 변경 미리보기" });
    /** 수정 확정 on the overview, waiting for the preview dialog. */
    async function startCommit() {
        fireEvent.click(screen.getByRole("button", { name: "수정 확정" }));
        await screen.findByRole("dialog", { name: "초안 변경 미리보기" });
    }
    function confirmInPreview() {
        fireEvent.click(within(previewDialog()).getByRole("button", { name: "수정 확정" }));
    }
    const refreshModalTitle = "새로운 수정 사항이 있어서 새로고침이 필요해요";
    const emitCaseChanged = (event: { caseId: string; caseVersion: number }) => {
        const calls = jest.mocked(subscribeServiceRecordCaseChanges).mock.calls;
        const listener = calls[calls.length - 1][0];
        act(() => { listener(event); });
    };
    beforeEach(() => {
        jest.mocked(subscribeServiceRecordCaseChanges).mockReset();
        jest.mocked(subscribeServiceRecordCaseChanges).mockImplementation(() => () => undefined);
        // The server stores what was sent; date moves add a serviceDate override per moved session.
        sentChanges = {};
        movedDates = {};
        jest.spyOn(adminServiceRecordEditApi, "startDraft").mockImplementation(async (_clientId, changes) => {
            sentChanges = changes ?? {};
            return echoedDraft(1, false);
        });
        jest.spyOn(adminServiceRecordEditApi, "updateDraft").mockImplementation(async (_draftId, version) => echoedDraft(version + 1, true));
        jest.spyOn(adminServiceRecordEditApi, "discardDraft").mockResolvedValue({ ...makeDraftState(), draft: null });
        jest.spyOn(adminServiceRecordEditApi, "previewDraft").mockResolvedValue({
            ...confirmPreviewResponse,
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

    it("keeps 수정 확인 in this tab: no draft call, back on the overview, 수정 확정 and 수정 취소 appear, no ribbon", async () => {
        const { container } = open();
        editNote(container);
        expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument();
        acceptEdit();
        await waitFor(() => expect(container.querySelectorAll('[data-slot="day"]')).toHaveLength(3));
        for (const call of [adminServiceRecordEditApi.getDraft, adminServiceRecordEditApi.startDraft, adminServiceRecordEditApi.updateDraft,
            adminServiceRecordEditApi.previewDraft, adminServiceRecordEditApi.confirmDraft, adminServiceRecordEditApi.discardDraft]) {
            expect(call).not.toHaveBeenCalled();
        }
        const commit = screen.getByRole("button", { name: "수정 확정" });
        const cancel = screen.getByRole("button", { name: "수정 취소" });
        const headerEdit = screen.getByRole("button", { name: "기본정보 수정" });
        expect(commit).toBeEnabled();
        expect(cancel).toBeEnabled();
        expect(cancel).toHaveClass("text-v3-burgundy");
        // Both sit in their own wrapper directly above the 기본정보 수정 actions.
        const wrapper = container.querySelector('[data-slot="overview-commit"]')!;
        expect(wrapper).toHaveAttribute("data-component", "desktop_service-record-admin_wizard_body_overview-commit");
        expect(wrapper).toContainElement(commit);
        expect(wrapper).toContainElement(cancel);
        expect(wrapper.nextElementSibling).toBe(container.querySelector('[data-slot="overview-actions"]'));
        expect(wrapper.nextElementSibling).toContainElement(headerEdit);
        expect(container.querySelectorAll('[data-slot="day"]')[0]).toHaveTextContent("초안 변경");
        expect(container.querySelector('[data-component$="_save-error"]')).toBeNull();
        expect(container).not.toHaveTextContent("이전 수정사항이 있습니다");
    });

    it("keeps the date 수정 button and editing enabled while edits are pending", async () => {
        const { container } = open();
        editNote(container);
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[1]);
        expect(container.querySelector('[data-component$="_body_date-edit"]')).toBeEnabled();
        expect(container.querySelectorAll('[data-slot="review"] [data-slot="sec-edit"]')[2]).toBeEnabled();
    });

    it("batches two sessions, a header edit and a date move into one 수정 확정 with one confirm", async () => {
        movedDates = { 3: "2026-09-10" };
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2,
            contentChanges: { headerChanged: true, changedSessionIndexes: [1, 2, 3] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        const { container } = open();
        editNoteOn(container, "첫 회차 메모");
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[1]);
        editNoteOn(container, "둘째 회차 메모");
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });

        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        fireEvent.change(screen.getByLabelText("산모 성명"), { target: { value: "이예지" } });
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[2]);
        pickDate(container, "3회차", "10일");
        acceptEdit();
        await waitFor(() => expect(container.querySelectorAll('[data-slot="day"]')[2]).toHaveTextContent("2026.09.10"));
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();

        await startCommit();
        expect(adminServiceRecordEditApi.getDraft).toHaveBeenCalledWith("42");
        expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledTimes(1);
        expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledWith("42", {
            header: { momName: "이예지" },
            sessions: [
                { sessionIndex: 1, etcService: "첫 회차 메모" },
                { sessionIndex: 2, etcService: "둘째 회차 메모" },
            ],
        });
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledTimes(1);
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith("draft-1", 1, {}, { sessionIndex: 3, toDate: "2026-09-10", shiftFollowing: false });
        expect(adminServiceRecordEditApi.previewDraft).toHaveBeenCalledWith("draft-1", 2);
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();

        confirmInPreview();
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledWith("draft-1", 2, "preview-confirm-1", expect.any(String));
        await waitFor(() => expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument());
        expect(screen.queryByRole("button", { name: "수정 취소" })).not.toBeInTheDocument();
    });

    it("discards the draft and keeps the local edits when the preview is closed", async () => {
        const { container } = open();
        editNote(container);
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        await startCommit();

        fireEvent.click(within(previewDialog()).getByRole("button", { name: "닫기" }));

        await waitFor(() => expect(adminServiceRecordEditApi.discardDraft).toHaveBeenCalledWith("draft-1", 1));
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "초안 변경 미리보기" })).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: "수정 확정" })).toBeEnabled();
        expect(container.querySelectorAll('[data-slot="day"]')[0]).toHaveTextContent("초안 변경");
    });

    it("asks before 수정 취소 and clears only the local edits without a server call", async () => {
        const { container } = open();
        editNote(container);
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });

        fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
        const dialog = screen.getByRole("dialog", { name: "모든 수정사항을 취소할까요?" });
        fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "모든 수정사항을 취소할까요?" })).not.toBeInTheDocument());
        expect(screen.getByRole("button", { name: "수정 확정" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "모든 수정사항을 취소할까요?" })).getByRole("button", { name: "수정 취소" }));
        await waitFor(() => expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument());
        expect(container.querySelectorAll('[data-slot="day"]')[0]).not.toHaveTextContent("초안 변경");
        for (const call of [adminServiceRecordEditApi.getDraft, adminServiceRecordEditApi.startDraft, adminServiceRecordEditApi.updateDraft,
            adminServiceRecordEditApi.previewDraft, adminServiceRecordEditApi.confirmDraft, adminServiceRecordEditApi.discardDraft]) {
            expect(call).not.toHaveBeenCalled();
        }
    });

    it("opens the refresh modal instead of previewing when the source changed since load", async () => {
        const echo = jest.mocked(adminServiceRecordEditApi.startDraft).getMockImplementation()!;
        jest.mocked(adminServiceRecordEditApi.startDraft).mockImplementation(async (...args) => ({
            ...(await echo(...args)), sourceFingerprint: "source-2", sourceCaseVersion: 2,
        }));
        const { container } = open();
        editNote(container);
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        fireEvent.click(screen.getByRole("button", { name: "수정 확정" }));
        await screen.findByRole("dialog", { name: refreshModalTitle });
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.previewDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
        expect(adminServiceRecordEditApi.discardDraft).toHaveBeenCalledWith("draft-1", 1);
        expect(container.querySelectorAll('[data-slot="day"]')[0]).toHaveTextContent("초안 변경");
    });

    it("fails closed when the displayed source has no verified identity", async () => {
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} />);
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        expect(container.querySelectorAll('[data-slot="review"] [data-slot="sec-edit"]')[0]).toBeUndefined();
        expect(screen.getByRole("button", { name: "최신 기록 불러오기" })).toBeInTheDocument();
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
    });

    it("ignores an ACTIVE server draft on load and discards it at the start of 수정 확정", async () => {
        const existing = makeDraftState({ header: { momName: "기존 수정 산모" }, sessions: [{ sessionIndex: 2, etcService: "이전 수정 내용" }] }, 2);
        jest.mocked(adminServiceRecordEditApi.getDraft).mockResolvedValue(existing);
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={existing} />);

        expect(container.querySelector('[data-component$="_save-error"]')).toBeNull();
        expect(container).not.toHaveTextContent("이전 수정사항");
        expect(screen.queryByRole("button", { name: "이전 수정사항 검토" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "기본정보 수정" })).toBeEnabled();
        expect(screen.queryByRole("button", { name: "기본정보 확인" })).not.toBeInTheDocument();
        expect(container.querySelectorAll('[data-slot="day"]')[1]).not.toHaveTextContent("초안 변경");
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[1]);
        expect(container).not.toHaveTextContent("이전 수정 내용");
        expect(container.querySelector('[data-component$="_body_date-edit"]')).toBeEnabled();
        editNote(container);
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        expect(adminServiceRecordEditApi.discardDraft).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "수정 확정" }));
        await screen.findByRole("dialog", { name: "초안 변경 미리보기" });

        expect(adminServiceRecordEditApi.discardDraft).toHaveBeenCalledWith("draft-1", 2);
        expect(jest.mocked(adminServiceRecordEditApi.discardDraft).mock.invocationCallOrder[0])
            .toBeLessThan(jest.mocked(adminServiceRecordEditApi.startDraft).mock.invocationCallOrder[0]);
        // Only this session's edit reaches the new draft, never the leftover one.
        expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledWith("42", { sessions: [{ sessionIndex: 2, etcService: "수정된 서비스" }] });
    });

    it("stages basic-information editing and saves it only after 수정 확정", async () => {
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, contentChanges: { headerChanged: true, changedSessionIndexes: [] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        fireEvent.change(screen.getByDisplayValue("김산모"), { target: { value: "이예지" } });
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        expect(screen.getByRole("button", { name: "기본정보 수정" })).toBeEnabled();
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        await startCommit();
        expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledWith("42", { header: { momName: "이예지" } });
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        confirmInPreview();
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
    });

    it("shows no message in the basic-information editor until a field is edited", () => {
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));

        const slots = Array.from(container.querySelectorAll('[data-slot="lab-msg"]'));
        expect(slots).toHaveLength(6);
        for (const slot of slots) expect(slot).toBeEmptyDOMElement();
        expect(container.querySelector(".field-helper")).toBeNull();

        const birth = screen.getByLabelText(/^산모 생년월일/);
        fireEvent.focus(birth);
        fireEvent.change(birth, { target: { value: "1999" } });
        expect(document.getElementById(birth.getAttribute("aria-describedby")!)).toHaveTextContent("YYYY-MM-DD 형식");
        expect(document.getElementById(birth.getAttribute("aria-describedby")!)).toHaveClass("hint");
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
        expect(document.getElementById(errorId!)).toHaveTextContent("존재하지 않는 날짜예요");
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

        render(<ServiceRecordAdminWizard clientId="42" overview={legacyOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        expect(screen.getByLabelText(/^신생아 출생일자/)).toHaveValue("2026-09-01");
        expect(screen.getByLabelText("신생아 몸무게 (kg)")).toHaveValue("Infinity");
        fireEvent.change(screen.getByLabelText("산모 성명"), { target: { value: "이예지" } });

        const confirm = screen.getByRole("button", { name: "수정 확인" });
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        await screen.findByRole("button", { name: "수정 확정" });
        await startCommit();
        expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledWith("42", { header: { momName: "이예지" } });
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

    it("formats a changed birthday and stages only that ISO value", async () => {
        render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
        fireEvent.click(screen.getByRole("button", { name: "기본정보 수정" }));
        const birth = screen.getByLabelText(/^산모 생년월일/);
        expect(birth).toHaveAttribute("placeholder", "1994-03-15");
        expect(screen.getByLabelText(/^신생아 출생일자/)).toHaveAttribute("placeholder", "2026-09-20");
        fireEvent.change(birth, { target: { value: "19990101" } });
        expect(birth).toHaveValue("1999-01-01");
        expect(birth).not.toHaveAttribute("aria-invalid", "true");
        expect(screen.getByLabelText(/^신생아 출생일자/)).toHaveValue("260714");
        expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        await startCommit();
        expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledWith("42", { header: { momBirth: "1999-01-01" } });
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
        const modal = screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" });
        expect(modal).toHaveTextContent("1회차의 서비스 제공일을 1영업일만큼 변경합니다. 뒷 회차들도 동일하게 변경할까요?");
        expect(modal).toHaveTextContent("다음 회차와 날짜가 겹쳐 뒷 회차들을 그대로 둘 수 없어요.");
        expect(within(modal).getByRole("button", { name: "그대로 두기" })).toBeDisabled();
        fireEvent.keyDown(modal, { key: "Escape" });
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        fireEvent.click(screen.getAllByRole("combobox")[2]);
        fireEvent.click(screen.getByRole("option", { name: "8일" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" })).getByRole("button", { name: "변경하기" }));
        expect(container.querySelector('[data-slot="datechip"]')).toHaveTextContent("2026.09.08");
        expect(screen.getByRole("button", { name: "수정 확인" })).toBeInTheDocument();
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
    });

    describe("branch calendar", () => {
        const defaultImplementation = jest.mocked(useBusinessDayCalendar).getMockImplementation();
        const branchCalendar = createKrBusinessDayCalendar([...KR_BUILTIN_HOLIDAYS, "2026-09-10"], {
            version: "kr-db-test",
            supportedYears: [2025, 2026, 2027],
        });
        const mockCalendarResult = (overrides: Partial<ReturnType<typeof useBusinessDayCalendar>>) => {
            jest.mocked(useBusinessDayCalendar).mockReturnValue({
                calendar: branchCalendar,
                ready: true,
                error: null,
                retry: jest.fn(),
                refreshForSave: async () => ({ ok: true, calendar: branchCalendar, changed: false }),
                version: branchCalendar.version,
                ...overrides,
            });
        };
        afterEach(() => {
            jest.mocked(useBusinessDayCalendar).mockImplementation(defaultImplementation!);
        });

        it.each([true, false])("blocks a freshly changed suffix before writing a draft (changed=%s)", async (changed) => {
            const refreshForSave = jest.fn().mockResolvedValue({ ok: true, calendar: branchCalendar, changed });
            mockCalendarResult({ calendar: KR_BUILTIN_CALENDAR_FOR_TEST, refreshForSave });
            const { container } = open();
            fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
            fireEvent.click(screen.getAllByRole("combobox")[2]);
            fireEvent.click(screen.getByRole("option", { name: "8일" }));
            fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
            fireEvent.click(within(screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" })).getByRole("button", { name: "변경하기" }));
            fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
            await screen.findByText("공휴일 정보가 바뀌어 날짜를 다시 계산했어요. 수정 확인을 다시 눌러 주세요.");
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
            expect(screen.getByRole("button", { name: "수정 확인" })).toBeEnabled();
        });

        it("blocks a date move when save refresh fails without locking the editor", async () => {
            mockCalendarResult({ refreshForSave: async () => ({ ok: false }) });
            const { container } = open();
            fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
            fireEvent.click(screen.getAllByRole("combobox")[2]);
            fireEvent.click(screen.getByRole("option", { name: "8일" }));
            fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
            fireEvent.click(within(screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" })).getByRole("button", { name: "변경하기" }));
            fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
            await screen.findByText("공휴일 정보를 불러오지 못했어요.");
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
            expect(screen.getByRole("button", { name: "수정 확인" })).toBeEnabled();
        });

        it("applies a branch-added holiday to the date choices and to the following-session shift", () => {
            mockCalendarResult({});
            const { container } = open();
            fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
            fireEvent.click(screen.getAllByRole("combobox")[2]);
            expect(screen.queryByRole("option", { name: "10일" })).not.toBeInTheDocument();
            fireEvent.click(screen.getByRole("option", { name: "11일" }));
            fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
            // 09-07 -> 09-11 skips the 09-10 branch holiday: 3 business days (4 with the built-in list).
            expect(screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" })).toHaveTextContent("1회차의 서비스 제공일을 3영업일만큼 변경합니다.");
        });

        it("keeps the confirm action disabled and explains why until the calendar is ready", () => {
            mockCalendarResult({ ready: false, calendar: KR_BUILTIN_CALENDAR_FOR_TEST });
            const result = open();
            expect(result.container.querySelector('[data-component$="_body_date-edit"]')).toBeDisabled();
            expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).toBeInTheDocument();
            editNote(result.container);
            expect(screen.getByRole("button", { name: "수정 확인" })).toBeDisabled();
            fireEvent.click(screen.getByRole("button", { name: "수정 확인" }));
            expect(adminServiceRecordEditApi.startDraft).not.toHaveBeenCalled();

            mockCalendarResult({});
            result.rerender(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
            expect(screen.getByRole("button", { name: "수정 확인" })).toBeEnabled();
        });

        it("offers a retry when the calendar failed to load", () => {
            const retry = jest.fn();
            mockCalendarResult({ ready: false, error: "load-failed", retry, calendar: KR_BUILTIN_CALENDAR_FOR_TEST });
            open();
            fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
            expect(retry).toHaveBeenCalledTimes(1);
        });
    });

    it("retries an unknown confirmation result with exactly the same request", async () => {
        jest.mocked(adminServiceRecordEditApi.confirmDraft).mockRejectedValueOnce(new Error("network"));
        const { container } = open();
        editNote(container);
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        await startCommit();
        confirmInPreview();
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(within(previewDialog()).getByRole("button", { name: "수정 확정" })).toBeEnabled());
        expect(within(previewDialog()).getByText("저장 결과를 확인하지 못했습니다. 수정사항은 이 화면에 남아 있어요.")).toBeInTheDocument();
        confirmInPreview();
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(2));
        const calls = jest.mocked(adminServiceRecordEditApi.confirmDraft).mock.calls;
        expect(calls[1]).toEqual(calls[0]);
        expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledTimes(1);
    });

    it("stages an approved collision shift and sends it with the explicit suffix flag on 수정 확정", async () => {
        const after = sessionOverview.scheduleProjection!.entries.map((entry, index) => ({ ...entry, serviceDate: ["2026-09-08", "2026-09-09", "2026-09-10"][index] }));
        movedDates = { 1: "2026-09-08", 2: "2026-09-09", 3: "2026-09-10" };
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2,
            before: { startDate: dates[0], endDate: dates[2], sessions: sessionOverview.scheduleProjection!.entries },
            after: { startDate: "2026-09-08", endDate: "2026-09-10", sessions: after },
            contentChanges: { headerChanged: false, changedSessionIndexes: [1, 2, 3] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        const { container } = open();
        pickDate(container, "1회차", "8일", "변경하기");
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        const days = container.querySelectorAll('[data-slot="day"]');
        expect(days[0]).toHaveTextContent("2026.09.08");
        expect(days[2]).toHaveTextContent("2026.09.10");
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        await startCommit();
        expect(adminServiceRecordEditApi.startDraft).toHaveBeenCalledWith("42", undefined);
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith("draft-1", 1, {}, { sessionIndex: 1, toDate: "2026-09-08", shiftFollowing: true });
        confirmInPreview();
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
    });

    it.each([
        ["변경하기", true, ["2026-09-04", "2026-09-07", "2026-09-08"]],
        ["그대로 두기", false, ["2026-09-04", "2026-09-08", "2026-09-09"]],
    ] as const)("asks whether to move later sessions when a date moves earlier (%s)", async (label, shiftFollowing, afterDates) => {
        const after = sessionOverview.scheduleProjection!.entries.map((entry, index) => ({ ...entry, serviceDate: afterDates[index] }));
        movedDates = Object.fromEntries(afterDates.map((date, index) => [index + 1, date]));
        jest.mocked(adminServiceRecordEditApi.previewDraft).mockResolvedValue({
            ...confirmPreviewResponse, draftVersion: 2,
            before: { startDate: dates[0], endDate: dates[2], sessions: sessionOverview.scheduleProjection!.entries },
            after: { startDate: afterDates[0], endDate: afterDates[2], sessions: after },
            contentChanges: { headerChanged: false, changedSessionIndexes: shiftFollowing ? [1, 2, 3] : [1] },
        } as Awaited<ReturnType<typeof adminServiceRecordEditApi.previewDraft>>);
        const { container } = open();
        fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
        fireEvent.click(screen.getAllByRole("combobox")[2]);
        fireEvent.click(screen.getByRole("option", { name: "4일" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        const modal = screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" });
        expect(modal).toHaveTextContent("1회차의 서비스 제공일을 1영업일만큼 변경합니다. 뒷 회차들도 동일하게 변경할까요?");
        expect(within(modal).getByRole("button", { name: "그대로 두기" })).toBeEnabled();
        fireEvent.click(within(modal).getByRole("button", { name: label }));
        expect(container.querySelector('[data-slot="datechip"]')).toHaveTextContent("2026.09.04");
        acceptEdit();
        await screen.findByRole("button", { name: "수정 확정" });
        expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
        await startCommit();
        expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledWith("draft-1", 1, {}, { sessionIndex: 1, toDate: "2026-09-04", shiftFollowing });
        confirmInPreview();
        await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));
    });

    it("still offers 그대로 두기 when shifting the later sessions cannot be computed", () => {
        const schedule = jest.requireMock("@babyjamjam/shared/utils/service-record-schedule");
        const actual = jest.requireActual("@babyjamjam/shared/utils/service-record-schedule");
        jest.mocked(schedule.moveServiceRecordSessionDate).mockImplementation((...args: Parameters<typeof actual.moveServiceRecordSessionDate>) => {
            if (args[3]) throw new Error("suffix crosses an unloaded calendar year");
            return actual.moveServiceRecordSessionDate(...args);
        });
        try {
            const { container } = open();
            fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
            fireEvent.click(screen.getAllByRole("combobox")[2]);
            fireEvent.click(screen.getByRole("option", { name: "4일" }));
            fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
            const modal = screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" });
            expect(within(modal).getByRole("button", { name: "변경하기" })).toBeDisabled();
            expect(modal).toHaveTextContent("뒷 회차들의 제공일을 계산할 수 없어 함께 변경할 수 없어요.");
            fireEvent.click(within(modal).getByRole("button", { name: "그대로 두기" }));
            expect(container.querySelector('[data-slot="datechip"]')).toHaveTextContent("2026.09.04");
        } finally {
            jest.mocked(schedule.moveServiceRecordSessionDate).mockImplementation(actual.moveServiceRecordSessionDate);
        }
    });

    it("closing the follow prompt returns to the date picker without moving anything", () => {
        const { container } = open();
        fireEvent.click(container.querySelector('[data-component$="_body_date-edit"]')!);
        fireEvent.click(screen.getAllByRole("combobox")[2]);
        fireEvent.click(screen.getByRole("option", { name: "4일" }));
        fireEvent.click(within(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).getByRole("button", { name: "수정" }));
        fireEvent.keyDown(screen.getByRole("dialog", { name: "뒷 회차들도 변경할까요?" }), { key: "Escape" });
        expect(screen.queryByRole("dialog", { name: "뒷 회차들도 변경할까요?" })).not.toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "1회차 서비스 제공일 수정" })).toBeInTheDocument();
        expect(container.querySelector('[data-slot="datechip"]')).toHaveTextContent("2026.09.07");
    });

    describe("refresh modal", () => {
        async function openWithPending() {
            const result = open();
            editNote(result.container);
            acceptEdit();
            await screen.findByRole("button", { name: "수정 확정" });
            return result;
        }

        it("opens a blocking modal for a newer case version and 확인 reloads and clears the pending edits", async () => {
            const { container } = await openWithPending();

            emitCaseChanged({ caseId: "case-1", caseVersion: 2 });

            const modal = await screen.findByRole("dialog", { name: refreshModalTitle });
            expect(within(modal).getAllByRole("button")).toHaveLength(1);
            expect(within(modal).getByRole("button", { name: "확인" })).toBeEnabled();
            fireEvent.keyDown(modal, { key: "Escape" });
            expect(screen.getByRole("dialog", { name: refreshModalTitle })).toBeInTheDocument();
            fireEvent.pointerDown(document.body);
            fireEvent.click(document.body);
            expect(screen.getByRole("dialog", { name: refreshModalTitle })).toBeInTheDocument();

            jest.mocked(adminServiceRecordEditApi.getDraft).mockResolvedValue({ ...makeDraftState(), draft: null, sourceFingerprint: "source-2", sourceCaseVersion: 2 });
            fireEvent.click(within(modal).getByRole("button", { name: "확인" }));

            await waitFor(() => expect(screen.queryByRole("dialog", { name: refreshModalTitle })).not.toBeInTheDocument());
            expect(global.fetch).toHaveBeenCalledWith("/api/admin/service-records/client/42/editor", expect.objectContaining({ cache: "no-store" }));
            expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument();
            expect(container.querySelectorAll('[data-slot="day"]')[0]).not.toHaveTextContent("초안 변경");
        });

        it("stays blocked when a newer change is announced while an older refresh is loading", async () => {
            await openWithPending();
            emitCaseChanged({ caseId: "case-1", caseVersion: 2 });
            const modal = await screen.findByRole("dialog", { name: refreshModalTitle });

            let releaseEditor!: () => void;
            const editorLoaded = new Promise<void>((resolve) => { releaseEditor = resolve; });
            global.fetch = jest.fn().mockImplementation(async () => {
                await editorLoaded;
                return { ok: true, json: async () => sessionOverview };
            });
            jest.mocked(adminServiceRecordEditApi.getDraft).mockResolvedValue({ ...makeDraftState(), draft: null, sourceFingerprint: "source-2", sourceCaseVersion: 2 });
            fireEvent.click(within(modal).getByRole("button", { name: "확인" }));
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

            emitCaseChanged({ caseId: "case-1", caseVersion: 3 });
            await act(async () => { releaseEditor(); });

            // The v2 response must not unlock editing or dismiss the notice about v3.
            await waitFor(() => expect(within(screen.getByRole("dialog", { name: refreshModalTitle })).getByRole("button", { name: "확인" })).toBeEnabled());
            expect(screen.getByRole("dialog", { name: refreshModalTitle })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "최신 기록 불러오기", hidden: true })).toBeInTheDocument();

            global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => sessionOverview });
            jest.mocked(adminServiceRecordEditApi.getDraft).mockResolvedValue({ ...makeDraftState(), draft: null, sourceFingerprint: "source-3", sourceCaseVersion: 3 });
            fireEvent.click(within(screen.getByRole("dialog", { name: refreshModalTitle })).getByRole("button", { name: "확인" }));
            await waitFor(() => expect(screen.queryByRole("dialog", { name: refreshModalTitle })).not.toBeInTheDocument());
            expect(screen.getByRole("button", { name: "기본정보 수정" })).toBeEnabled();
            expect(screen.queryByRole("button", { name: "최신 기록 불러오기" })).not.toBeInTheDocument();
        });

        it.each([
            ["an equal version", { caseId: "case-1", caseVersion: 1 }],
            ["a lower version", { caseId: "case-1", caseVersion: 0 }],
            ["another case", { caseId: "case-2", caseVersion: 9 }],
        ])("ignores %s", async (_label, event) => {
            await openWithPending();
            emitCaseChanged(event);
            expect(screen.queryByRole("dialog", { name: refreshModalTitle })).not.toBeInTheDocument();
        });

        it("does not treat this tab's own confirm as a foreign change", async () => {
            await openWithPending();
            await startCommit();
            confirmInPreview();
            await waitFor(() => expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument());

            emitCaseChanged({ caseId: "case-1", caseVersion: 2 });

            expect(screen.queryByRole("dialog", { name: refreshModalTitle })).not.toBeInTheDocument();
        });

        it("buffers an event that arrives before the confirm response and drops it once the confirm explains it", async () => {
            let resolveConfirm!: (value: Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>) => void;
            jest.mocked(adminServiceRecordEditApi.confirmDraft).mockReturnValue(new Promise((resolve) => { resolveConfirm = resolve; }));
            await openWithPending();
            await startCommit();
            confirmInPreview();
            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));

            emitCaseChanged({ caseId: "case-1", caseVersion: 2 });
            expect(screen.queryByRole("dialog", { name: refreshModalTitle })).not.toBeInTheDocument();

            await act(async () => { resolveConfirm(confirmResult as Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>); });
            await waitFor(() => expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument());
            expect(screen.queryByRole("dialog", { name: refreshModalTitle })).not.toBeInTheDocument();
        });

        it("still opens the modal for a buffered event newer than the confirmed version", async () => {
            let resolveConfirm!: (value: Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>) => void;
            jest.mocked(adminServiceRecordEditApi.confirmDraft).mockReturnValue(new Promise((resolve) => { resolveConfirm = resolve; }));
            await openWithPending();
            await startCommit();
            confirmInPreview();
            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));

            emitCaseChanged({ caseId: "case-1", caseVersion: 3 });
            await act(async () => { resolveConfirm(confirmResult as Awaited<ReturnType<typeof adminServiceRecordEditApi.confirmDraft>>); });

            await screen.findByRole("dialog", { name: refreshModalTitle });
        });

        it("processes buffered events normally when the confirm fails", async () => {
            let rejectConfirm!: (reason: unknown) => void;
            jest.mocked(adminServiceRecordEditApi.confirmDraft).mockReturnValue(new Promise((_resolve, reject) => { rejectConfirm = reject; }));
            await openWithPending();
            await startCommit();
            confirmInPreview();
            await waitFor(() => expect(adminServiceRecordEditApi.confirmDraft).toHaveBeenCalledTimes(1));

            emitCaseChanged({ caseId: "case-1", caseVersion: 2 });
            await act(async () => { rejectConfirm(new Error("network")); });

            await screen.findByRole("dialog", { name: refreshModalTitle });
        });

        it("opens the modal for a draft conflict without a blockingOperation and keeps the edits", async () => {
            jest.mocked(adminServiceRecordEditApi.startDraft).mockRejectedValue(new AdminServiceRecordEditApiError(409, {}));
            const { container } = await openWithPending();
            fireEvent.click(screen.getByRole("button", { name: "수정 확정" }));
            await screen.findByRole("dialog", { name: refreshModalTitle });
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
            expect(container.querySelectorAll('[data-slot="day"]')[0]).toHaveTextContent("초안 변경");
        });

        it("opens the modal when the confirm itself conflicts without a blockingOperation", async () => {
            jest.mocked(adminServiceRecordEditApi.confirmDraft).mockRejectedValue(new AdminServiceRecordEditApiError(409, { code: "DRAFT_VERSION_CONFLICT" }));
            await openWithPending();
            await startCommit();
            confirmInPreview();
            await screen.findByRole("dialog", { name: refreshModalTitle });
        });
    });

    describe("blocking follow-up operations", () => {
        it.each([
            ["contract_period", "이전 수정의 계약서 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요."],
            ["receipt_refresh", "이전 수정의 영수증 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요."],
        ])("explains a 409 blocked by %s without asking for a refresh", async (operation, message) => {
            jest.mocked(adminServiceRecordEditApi.confirmDraft).mockRejectedValue(new AdminServiceRecordEditApiError(409, {
                code: "DRAFT_VERSION_CONFLICT",
                blockingOperation: { operation, status: "RUNNING", lastErrorCode: null },
            }));
            const { container } = open();
            editNote(container);
            acceptEdit();
            await screen.findByRole("button", { name: "수정 확정" });
            await startCommit();
            confirmInPreview();

            await within(previewDialog()).findByText(message);
            expect(screen.queryByRole("dialog", { name: refreshModalTitle })).not.toBeInTheDocument();

            // Closing the preview leaves the line under 수정 취소, and the edits stay.
            fireEvent.click(within(previewDialog()).getByRole("button", { name: "닫기" }));
            await waitFor(() => expect(screen.queryByRole("dialog", { name: "초안 변경 미리보기" })).not.toBeInTheDocument());
            expect(screen.getByRole("alert")).toHaveTextContent(message);
            expect(screen.getByRole("button", { name: "수정 확정" })).toBeEnabled();
        });
    });

    describe("a draft that another session created first", () => {
        async function stageNote() {
            const result = open();
            editNote(result.container);
            acceptEdit();
            await screen.findByRole("button", { name: "수정 확정" });
            return result;
        }
        function expectNothingPreviewedOrDiscarded() {
            expect(adminServiceRecordEditApi.previewDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.confirmDraft).not.toHaveBeenCalled();
            expect(adminServiceRecordEditApi.discardDraft).not.toHaveBeenCalled();
        }

        it.each([
            ["different content for the same session", { sessions: [{ sessionIndex: 1, etcService: "OTHER TAB" }] }],
            ["an extra session", { sessions: [{ sessionIndex: 1, etcService: "수정된 서비스" }, { sessionIndex: 2, notes: "OTHER TAB" }] }],
            ["a header edit", { header: { momName: "OTHER TAB" }, sessions: [{ sessionIndex: 1, etcService: "수정된 서비스" }] }],
            ["a date override", { sessions: [{ sessionIndex: 1, etcService: "수정된 서비스" }, { sessionIndex: 2, serviceDate: "2026-09-11" }] }],
        ])("does not preview, confirm or discard a resumed draft with %s, and keeps the local edits", async (_label, foreign) => {
            jest.mocked(adminServiceRecordEditApi.startDraft).mockResolvedValue(makeDraftState(foreign, 4));
            const { container } = await stageNote();

            fireEvent.click(screen.getByRole("button", { name: "수정 확정" }));

            await screen.findByRole("dialog", { name: refreshModalTitle });
            expectNothingPreviewedOrDiscarded();
            expect(adminServiceRecordEditApi.updateDraft).not.toHaveBeenCalled();
            expect(container.querySelectorAll('[data-slot="day"]')[0]).toHaveTextContent("초안 변경");
        });

        it("rejects a draft whose date overrides do not match the applied moves", async () => {
            movedDates = { 3: "2026-09-10" };
            const echo = jest.mocked(adminServiceRecordEditApi.updateDraft).getMockImplementation()!;
            jest.mocked(adminServiceRecordEditApi.updateDraft).mockImplementation(async (...args) => {
                const state = await echo(...args);
                return { ...state, draft: { ...state.draft!, changes: { sessions: [{ sessionIndex: 3, serviceDate: "2026-09-11" }] } } };
            });
            const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={sessionOverview} initialDraftState={{ ...makeDraftState(), draft: null }} />);
            fireEvent.click(container.querySelectorAll('[data-slot="day"]')[2]);
            pickDate(container, "3회차", "10일");
            acceptEdit();
            await screen.findByRole("button", { name: "수정 확정" });

            fireEvent.click(screen.getByRole("button", { name: "수정 확정" }));

            await screen.findByRole("dialog", { name: refreshModalTitle });
            expect(adminServiceRecordEditApi.updateDraft).toHaveBeenCalledTimes(1);
            expectNothingPreviewedOrDiscarded();
            expect(container.querySelectorAll('[data-slot="day"]')[2]).toHaveTextContent("2026.09.10");
        });

        it("still previews a draft that holds exactly this tab's batch", async () => {
            await stageNote();
            await startCommit();
            expect(adminServiceRecordEditApi.previewDraft).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole("dialog", { name: refreshModalTitle })).not.toBeInTheDocument();
        });
    });

    describe("leave warning", () => {
        const beforeUnload = () => {
            const event = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(event);
            return event;
        };
        let link: HTMLAnchorElement;
        beforeEach(() => {
            link = document.createElement("a");
            link.href = "/service-record-admin/other";
            link.textContent = "다른 페이지";
            document.body.appendChild(link);
        });
        afterEach(() => { link.remove(); });

        it("prevents unloading only while edits are pending", async () => {
            const { container } = open();
            expect(beforeUnload().defaultPrevented).toBe(false);
            editNote(container);
            expect(beforeUnload().defaultPrevented).toBe(false);
            acceptEdit();
            await screen.findByRole("button", { name: "수정 확정" });
            expect(beforeUnload().defaultPrevented).toBe(true);

            fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
            fireEvent.click(within(screen.getByRole("dialog", { name: "모든 수정사항을 취소할까요?" })).getByRole("button", { name: "수정 취소" }));
            await waitFor(() => expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument());
            expect(beforeUnload().defaultPrevented).toBe(false);
        });

        it("stops warning after 수정 확정 succeeds", async () => {
            const { container } = open();
            editNote(container);
            acceptEdit();
            await screen.findByRole("button", { name: "수정 확정" });
            await startCommit();
            confirmInPreview();
            await waitFor(() => expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument());
            expect(beforeUnload().defaultPrevented).toBe(false);
        });

        it("asks before an in-app link navigation: 머무르기 stays, 나가기 drops the edits and continues", async () => {
            const { container } = open();
            editNote(container);
            acceptEdit();
            await screen.findByRole("button", { name: "수정 확정" });

            const navigated = jest.fn((event: Event) => { event.preventDefault(); });
            fireEvent.click(link);
            const modal = await screen.findByRole("dialog", { name: "페이지를 나가시겠어요?" });
            expect(modal).toHaveTextContent("수정이 저장되지 않았어요.");

            document.addEventListener("click", navigated);
            fireEvent.click(within(modal).getByRole("button", { name: "머무르기" }));
            await waitFor(() => expect(screen.queryByRole("dialog", { name: "페이지를 나가시겠어요?" })).not.toBeInTheDocument());
            expect(navigated).not.toHaveBeenCalledWith(expect.objectContaining({ target: link }));
            expect(screen.getByRole("button", { name: "수정 확정" })).toBeInTheDocument();
            expect(container.querySelectorAll('[data-slot="day"]')[0]).toHaveTextContent("초안 변경");

            fireEvent.click(link);
            fireEvent.click(within(await screen.findByRole("dialog", { name: "페이지를 나가시겠어요?" })).getByRole("button", { name: "나가기" }));
            document.removeEventListener("click", navigated);

            expect(navigated.mock.calls.filter(([event]) => event.target === link)).toHaveLength(1);
            await waitFor(() => expect(screen.queryByRole("button", { name: "수정 확정" })).not.toBeInTheDocument());
            expect(beforeUnload().defaultPrevented).toBe(false);
        });

        it("lets links through when nothing is pending", () => {
            open();
            fireEvent.click(link);
            expect(screen.queryByRole("dialog", { name: "페이지를 나가시겠어요?" })).not.toBeInTheDocument();
        });
    });

});

describe("administrator mode never flags a cleared answer", () => {
    const wizardHeader = {
        momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15",
        deliveryType: "자연분만", babyWeight: "3.2",
    };
    const wizardProps = (overrides: Partial<ServiceRecordWizardProps> = {}): ServiceRecordWizardProps => ({
        "data-component": "admin_service-record_wizard", screen: "service", phone: "", phoneError: null,
        context: { totalSessions: 5, startDate: "2026-09-21", header: null, sessions: [] },
        header: wizardHeader, day: 1, pageIdx: 0, draft: {}, editing: true, clientSignature: null,
        busy: false, isRecordFinalized: false, lockedDays: new Set<number>(), nextOpenDay: () => 1,
        scheduleChangeBusy: false, hasServiceDateMismatch: false, defaultDate: () => "2026-09-21",
        onPhoneChange: jest.fn(), onSubmitPhone: jest.fn(), onBack: jest.fn(), onHeaderChange: jest.fn(),
        onDeliveryTypeChange: jest.fn(), onSaveHeader: jest.fn(), onOpenDay: jest.fn(),
        onOpenScheduleChangePreview: jest.fn(), onServiceDateChange: jest.fn(), onFieldChange: jest.fn(),
        onToggleMulti: jest.fn(), onSignatureChange: jest.fn(), onNextPage: jest.fn(),
        onOpenSubmitModal: jest.fn(), onEditSection: jest.fn(), ...overrides,
    });
    const messageSlots = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-slot="lab-msg"]'));

    it("leaves the message slot empty when a prefilled header field is cleared", () => {
        const props = wizardProps({ adminMode: true });
        const { container, rerender, unmount } = render(<ServiceRecordWizard {...props} />);
        rerender(<ServiceRecordWizard {...props} header={{ ...wizardHeader, momName: "", babyWeight: "" }} />);

        const momName = screen.getByLabelText(/^산모 성명/);
        expect(momName).toHaveValue("");
        expect(messageSlots(container).length).toBeGreaterThan(0);
        for (const slot of messageSlots(container)) expect(slot).toBeEmptyDOMElement();
        expect(momName).not.toHaveAttribute("aria-invalid", "true");

        // Control: the same clearing is flagged for the public employee form.
        unmount();
        const employee = render(<ServiceRecordWizard {...wizardProps()} />);
        employee.rerender(<ServiceRecordWizard {...wizardProps({ header: { ...wizardHeader, momName: "" } })} />);
        expect(screen.getByLabelText(/^산모 성명/)).toHaveAttribute("aria-invalid", "true");
    });

    it("renders adminCommitActions in its own wrapper just before the overview actions, admin mode only", () => {
        const overviewProps = wizardProps({
            adminMode: true, screen: "overview",
            context: { totalSessions: 2, startDate: "2026-09-21", header: wizardHeader, sessions: [] },
            slots: {
                adminCommitActions: <button type="button">수정 확정</button>,
                adminConfirmAction: <button type="button">기본정보 수정</button>,
            },
        });
        const { container, rerender } = render(<ServiceRecordWizard {...overviewProps} />);

        const wrapper = container.querySelector('[data-slot="overview-commit"]')!;
        expect(wrapper).toHaveAttribute("data-component", "admin_service-record_wizard_body_overview-commit");
        expect(wrapper).toHaveTextContent("수정 확정");
        expect(wrapper.nextElementSibling).toBe(container.querySelector('[data-slot="overview-actions"]'));

        rerender(<ServiceRecordWizard {...overviewProps} slots={{ adminConfirmAction: <button type="button">기본정보 수정</button> }} />);
        expect(container.querySelector('[data-slot="overview-commit"]')).toBeNull();

        rerender(<ServiceRecordWizard {...overviewProps} adminMode={false} />);
        expect(container.querySelector('[data-slot="overview-commit"]')).toBeNull();
    });

    it("leaves the message slot empty when a radio answer is cleared", () => {
        const answered = { ...DEFAULT_DAILY_ANSWERS, sitzBath: "실시" };
        const cleared = { ...DEFAULT_DAILY_ANSWERS, sitzBath: "" };
        const dayProps = wizardProps({ adminMode: true, screen: "day", pageIdx: 0, draft: answered });
        const { container, rerender, unmount } = render(<ServiceRecordWizard {...dayProps} />);
        rerender(<ServiceRecordWizard {...dayProps} draft={cleared} />);

        expect(messageSlots(container).length).toBeGreaterThan(0);
        for (const slot of messageSlots(container)) expect(slot).toBeEmptyDOMElement();

        // Control: the same clearing is flagged for the public employee form.
        unmount();
        const employeeProps = wizardProps({ screen: "day", pageIdx: 0, draft: answered });
        const employee = render(<ServiceRecordWizard {...employeeProps} />);
        employee.rerender(<ServiceRecordWizard {...employeeProps} draft={cleared} />);
        expect(employee.container.textContent).toContain("좌욕을 선택해 주세요");
    });
});
