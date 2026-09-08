import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
        expect(container.querySelector('[data-slot="provider"]')).toHaveTextContent("관리자 조회");
        expect(container).toHaveTextContent("2025.01.15");
        expect(container).toHaveTextContent("같은 회차의 추가 기록");
    });

    it("disables every form control and submit action while keeping four-page navigation active", () => {
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={overview} />);
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[2]);

        for (let page = 0; page < 3; page += 1) {
            const editableControls = container.querySelectorAll("input:not([disabled]), textarea:not([disabled])");
            expect(editableControls).toHaveLength(0);
            const next = screen.getByRole("button", { name: "다음" });
            expect(next).not.toBeDisabled();
            fireEvent.click(next);
        }

        expect(container.querySelectorAll('[data-component$="_body_review_section"]')).toHaveLength(3);
        const submit = screen.getByRole("button", { name: "조회 전용" });
        expect(submit).toBeDisabled();
    });

    it("shows an existing signature and allows a supplemental assignment to be selected", () => {
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={overview} />);
        const supplemental = screen.getByRole("button", { name: /1회차 · 배정 #7/ });
        fireEvent.click(supplemental);
        expect(container).toHaveTextContent("2026.07.12");
        for (let page = 0; page < 3; page += 1) {
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
        }
        expect(screen.getByRole("img", { name: "산모 서명" })).toHaveAttribute("src", "data:image/png;base64,supplemental-signature");

        fireEvent.click(container.querySelector('[data-component="desktop_service-record-admin_wizard_body_day-back"]')!);
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        for (let page = 0; page < 3; page += 1) {
            fireEvent.click(screen.getByRole("button", { name: "다음" }));
        }
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
        expect(container.querySelectorAll('[data-slot="date-editor"]')).toHaveLength(1);
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
});

describe("administrator draft editing", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("starts a draft explicitly before enabling canonical edits", async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => makeDraftState(),
        });
        const { container } = render(<ServiceRecordAdminWizard clientId="42" overview={overview} />);

        expect(screen.getByText("초안 없음")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));

        await waitFor(() => expect(screen.getByText("저장됨")).toBeInTheDocument());
        expect(global.fetch).toHaveBeenCalledWith(
            "/api/admin/service-records/client/42/draft",
            expect.objectContaining({ method: "POST", body: "{}" }),
        );
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        expect(container.querySelectorAll("input:not([disabled]), textarea:not([disabled])").length).toBeGreaterThan(0);
    });

    it("applies explicit business-date moves and preserves prior draft content on later saves", async () => {
        const afterDateMove = makeDraftState({
            sessions: [{ sessionIndex: 3, serviceDate: "2026-07-15" }],
        }, 2);
        const afterContentSave = makeDraftState({
            sessions: [{ sessionIndex: 3, serviceDate: "2026-07-15", notes: "후속 메모" }],
        }, 3);
        const afterSecondDateMove = makeDraftState({
            sessions: [{ sessionIndex: 3, serviceDate: "2026-07-16", notes: "후속 메모" }],
        }, 4);
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => afterDateMove })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => afterContentSave })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => afterSecondDateMove });
        global.fetch = fetchMock;

        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={overview} initialDraftState={makeDraftState()} />,
        );

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[2]);
        fireEvent.click(screen.getByRole("button", { name: /제공일 변경/ }));
        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        fireEvent.click(screen.getByRole("option", { name: "15일" }));
        fireEvent.click(screen.getByRole("button", { name: "날짜 적용" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "서비스 제공일 변경" })).not.toBeInTheDocument());
        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "/api/admin/service-records/drafts/draft-1",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({
                    expectedDraftVersion: 1,
                    changes: {},
                    dateMove: { sessionIndex: 3, toDate: "2026-07-15" },
                }),
            }),
        );

        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.change(screen.getByPlaceholderText("서비스 제공 관련 특이사항 기록 필요 시 기재"), {
            target: { value: "후속 메모" },
        });
        fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "/api/admin/service-records/drafts/draft-1",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({
                    expectedDraftVersion: 2,
                    changes: { sessions: [{ sessionIndex: 3, notes: "후속 메모" }] },
                }),
            }),
        );

        fireEvent.click(container.querySelector('[data-component$="_body_day-back"]')!);
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[2]);
        fireEvent.click(screen.getByRole("button", { name: /제공일 변경/ }));
        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        fireEvent.click(screen.getByRole("option", { name: "16일" }));
        fireEvent.click(screen.getByRole("button", { name: "날짜 적용" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

        expect(fetchMock).toHaveBeenNthCalledWith(
            3,
            "/api/admin/service-records/drafts/draft-1",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({
                    expectedDraftVersion: 3,
                    changes: { sessions: [{ sessionIndex: 3, notes: "후속 메모" }] },
                    dateMove: { sessionIndex: 3, toDate: "2026-07-16" },
                }),
            }),
        );
        expect(container).toHaveTextContent("2026.07.16");
    });

    it("moves an unwritten future session from the authoritative projection without changing its immutable original date", async () => {
        const afterDateMove = makeDraftState({ sessions: [{ sessionIndex: 13, serviceDate: "2026-07-21" }] }, 2);
        const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => afterDateMove });
        global.fetch = fetchMock;
        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={plannedOverview} initialDraftState={makeDraftState()} />,
        );

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[12]);
        fireEvent.click(screen.getByRole("button", { name: /제공일 변경/ }));
        expect(screen.getByRole("dialog", { name: "서비스 제공일 변경" })).toHaveTextContent("2026.07.20");
        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        fireEvent.click(screen.getByRole("option", { name: "21일" }));
        fireEvent.click(screen.getByRole("button", { name: "날짜 적용" }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "서비스 제공일 변경" })).not.toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/admin/service-records/drafts/draft-1",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({
                    expectedDraftVersion: 1,
                    changes: {},
                    dateMove: { sessionIndex: 13, toDate: "2026-07-21" },
                }),
            }),
        );
        expect(container).toHaveTextContent("2026.07.21");
        expect(container).toHaveTextContent("원본 2026.07.20");
    });

    it("opens a read-only backend preview using the active draft version", async () => {
        const previewSessions = ["2026-07-10", "2026-07-11", "2026-07-13"].map((serviceDate, index) => ({
            sessionIndex: index + 1,
            serviceDate,
            originalDate: serviceDate,
            assignmentId: "assignment-7",
            scheduleId: 7,
            employeeId: 7,
            provenanceVersion: "projection-1",
        }));
        const previewResponse = {
            previewId: "preview-1",
            draftId: "draft-1",
            draftVersion: 1,
            sourceCaseVersion: 1,
            sourceFingerprint: "source-1",
            requiredSessionCount: 3,
            calendarVersion: "kr-2026",
            before: { startDate: "2026-07-10", endDate: "2026-07-14", sessions: previewSessions },
            after: { startDate: "2026-07-10", endDate: "2026-07-14", sessions: previewSessions },
            provenance: [{
                assignmentId: "assignment-7",
                scheduleId: 7,
                employeeId: 7,
                startDate: "2026-07-10",
                endDate: "2026-07-14",
                provenanceVersion: "projection-1",
            }],
            contentChanges: { headerChanged: false, changedSessionIndexes: [] },
            impactedAssignments: [],
            blockingReasons: [],
            signatureMetadata: {
                treatment: "preserve_existing",
                evidence: "observed",
                sessions: [],
            },
            documentScope: {
                evidence: "observed",
                serviceRecordSnapshot: { documentIds: ["doc-1"], snapshotVersion: 1, chunks: [] },
                currentRevision: { id: null, revisionNumber: null, formVersion: null },
                form: { version: 1 },
                contract: { currentDocumentId: "contract-1", stage: "in_progress" },
            },
        };
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => previewResponse,
        });
        global.fetch = fetchMock;

        render(
            <ServiceRecordAdminWizard clientId="42" overview={overview} initialDraftState={makeDraftState()} />,
        );
        fireEvent.click(screen.getByRole("button", { name: "변경 미리보기" }));

        await waitFor(() => expect(screen.getByRole("dialog", { name: "초안 변경 미리보기" })).toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/admin/service-records/drafts/draft-1/preview",
            expect.objectContaining({
                method: "POST",
                body: JSON.stringify({ expectedDraftVersion: 1 }),
            }),
        );
        await waitFor(() => expect(screen.getByText("변경 전")).toBeInTheDocument());
        expect(screen.queryByRole("button", { name: /확정|완료/ })).not.toBeInTheDocument();
    });

    it("keeps the pending date in the dialog after a permission failure until an explicit retry", async () => {
        const afterRetry = makeDraftState({ sessions: [{ sessionIndex: 3, serviceDate: "2026-07-15" }] }, 2);
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: async () => ({ code: "FORBIDDEN" }),
            })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => afterRetry });
        global.fetch = fetchMock;
        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={overview} initialDraftState={makeDraftState()} />,
        );

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[2]);
        fireEvent.click(screen.getByRole("button", { name: /제공일 변경/ }));
        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        fireEvent.click(screen.getByRole("option", { name: "15일" }));
        fireEvent.click(screen.getByRole("button", { name: "날짜 적용" }));

        await waitFor(() => expect(screen.getByText("제공일 변경 권한이 없습니다. 현재 입력은 유지됩니다.")).toBeInTheDocument());
        expect(screen.getByRole("dialog", { name: "서비스 제공일 변경" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent("15일");
        expect(screen.getByText("적용 예정일: 2026.07.15")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "날짜 적용" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "서비스 제공일 변경" })).not.toBeInTheDocument());
        expect(container).toHaveTextContent("2026.07.15");
    });

    it("keeps a pending date on a draft conflict and exposes an explicit latest-draft action", async () => {
        const latest = makeDraftState({ sessions: [{ sessionIndex: 3, serviceDate: "2026-07-14" }] }, 3);
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({ latestDraft: latest.draft, sourceChanged: true }),
        });
        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={overview} initialDraftState={makeDraftState()} />,
        );

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[2]);
        fireEvent.click(screen.getByRole("button", { name: /제공일 변경/ }));
        fireEvent.click(screen.getByRole("combobox", { name: "일" }));
        fireEvent.click(screen.getByRole("option", { name: "15일" }));
        fireEvent.click(screen.getByRole("button", { name: "날짜 적용" }));

        await waitFor(() => expect(screen.getByText(/다른 관리자의 변경으로 제공일을 적용하지 못했습니다/)).toBeInTheDocument());
        expect(screen.getByRole("dialog", { name: "서비스 제공일 변경" })).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "일" })).toHaveTextContent("15일");
        fireEvent.click(screen.getByRole("button", { name: "최신 초안 불러오기" }));
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "서비스 제공일 변경" })).not.toBeInTheDocument());
        expect(container).toHaveTextContent("2026.07.14");
    });

    it("resumes changed sessions and lets admins navigate incomplete submitted pages", () => {
        const resumed = makeDraftState({ sessions: [{ sessionIndex: 1, answers: { perineum: [] } }] });
        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={overview} initialDraftState={resumed} />,
        );

        expect(container).toHaveTextContent("초안 변경");
        expect(container.querySelector('[data-slot="provider"]')).toHaveTextContent("관리자 편집");
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        const next = screen.getByRole("button", { name: "다음" });
        expect(next).not.toBeDisabled();
    });

    it("saves only draft changes with the current CAS version and keeps source data immutable", async () => {
        const initial = makeDraftState();
        const saved = makeDraftState({ sessions: [{ sessionIndex: 1, notes: "관리자 메모" }] }, 2);
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => saved });
        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={overview} initialDraftState={initial} />,
        );

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        const notesInput = screen.getByPlaceholderText("서비스 제공 관련 특이사항 기록 필요 시 기재");
        fireEvent.change(notesInput, { target: { value: "관리자 메모" } });
        fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));

        await waitFor(() => expect(screen.getByText("저장됨")).toBeInTheDocument());
        expect(global.fetch).toHaveBeenCalledWith(
            "/api/admin/service-records/drafts/draft-1",
            expect.objectContaining({
                method: "PATCH",
                body: JSON.stringify({
                    expectedDraftVersion: 1,
                    changes: { sessions: [{ sessionIndex: 1, notes: "관리자 메모" }] },
                }),
            }),
        );
        expect(overview.record?.sessions[0].serviceDate).toBe("2026-07-11");
    });

    it("keeps the active-day input on 409 until an explicit latest-draft reload", async () => {
        const latest = makeDraftState({ sessions: [{ sessionIndex: 1, notes: "서버 최신 메모" }] }, 3);
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({
                code: "SERVICE_RECORD_EDIT_DRAFT_CONFLICT",
                latestDraft: latest.draft,
                sourceChanged: true,
                sourceCaseVersion: 2,
                sourceFingerprint: "source-2",
            }),
        });
        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={overview} initialDraftState={makeDraftState()} />,
        );

        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        const notesInput = screen.getByPlaceholderText("서비스 제공 관련 특이사항 기록 필요 시 기재");
        fireEvent.change(notesInput, { target: { value: "내 로컬 메모" } });
        fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));

        await waitFor(() => expect(screen.getByText(/다른 관리자의 변경으로 저장되지 않았습니다/)).toBeInTheDocument());
        expect(notesInput).toHaveValue("내 로컬 메모");
        fireEvent.click(screen.getByRole("button", { name: "최신 초안 불러오기" }));
        expect(screen.getByPlaceholderText("서비스 제공 관련 특이사항 기록 필요 시 기재")).toHaveValue("서버 최신 메모");
        expect(screen.getByText("저장됨")).toBeInTheDocument();
    });

    it("keeps local input on permission failure and discards with compare-and-swap", async () => {
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: async () => ({ code: "FORBIDDEN" }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ ...makeDraftState({}, 2), draft: { ...makeDraftState({}, 2).draft, status: "DISCARDED" } }),
            });
        global.fetch = fetchMock;
        const { container } = render(
            <ServiceRecordAdminWizard clientId="42" overview={overview} initialDraftState={makeDraftState()} />,
        );
        fireEvent.click(container.querySelectorAll('[data-slot="day"]')[0]);
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        fireEvent.click(screen.getByRole("button", { name: "다음" }));
        const notesInput = screen.getByPlaceholderText("서비스 제공 관련 특이사항 기록 필요 시 기재");
        fireEvent.change(notesInput, { target: { value: "권한 확인 메모" } });
        fireEvent.click(screen.getByRole("button", { name: "초안 저장" }));
        await waitFor(() => expect(screen.getByText("초안 접근 권한이 없습니다. 현재 입력은 유지됩니다.")).toBeInTheDocument());
        expect(notesInput).toHaveValue("권한 확인 메모");

        fireEvent.click(screen.getByRole("button", { name: "초안 취소" }));
        const modalButtons = screen.getAllByRole("button", { name: "초안 취소" });
        fireEvent.click(modalButtons[modalButtons.length - 1]);
        await waitFor(() => expect(screen.getByText("초안 없음")).toBeInTheDocument());
        expect(fetchMock).toHaveBeenLastCalledWith(
            "/api/admin/service-records/drafts/draft-1/discard",
            expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedDraftVersion: 1 }) }),
        );
    });

    it("uses a high-contrast admin alert for draft failures on the blue header", () => {
        const { container } = render(
            <ServiceRecordAdminWizard
                clientId="42"
                overview={overview}
                initialDraftErrorStatus={403}
            />,
        );

        const alert = container.querySelector('[data-component="desktop_service-record-admin_wizard_top-bar_admin-toolbar_error"]');
        expect(alert).toHaveClass("admin-draft-alert");
        expect(alert).toHaveTextContent("초안 접근 권한이 없습니다");
    });
});
