import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
    buildAdminServiceRecordContext,
    buildAdminServiceRecordView,
    ServiceRecordAdminViewer,
    ServiceRecordAdminWizard,
    type AdminServiceRecordEditorOverview,
} from "./ServiceRecordAdminWizard";

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

        const { container } = render(<ServiceRecordAdminWizard overview={overviewWithLegacyRow} />);
        fireEvent.click(screen.getByRole("button", { name: /5회차/ }));
        expect(container).toHaveTextContent("5회차 ·");
        expect(container).toHaveTextContent("2026.07.20");
    });

    it("renders all sessions as navigable read-only days and preserves out-of-period dates", () => {
        const { container } = render(<ServiceRecordAdminWizard overview={overview} />);

        const dayButtons = container.querySelectorAll('[data-slot="day"]');
        expect(dayButtons).toHaveLength(3);
        expect([...dayButtons].every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
        expect(container.querySelector('[data-slot="provider"]')).toHaveClass("org");
        expect(container).toHaveTextContent("2025.01.15");
        expect(container).toHaveTextContent("같은 회차의 추가 기록");
    });

    it("disables every form control and submit action while keeping four-page navigation active", () => {
        const { container } = render(<ServiceRecordAdminWizard overview={overview} />);
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
        const { container } = render(<ServiceRecordAdminWizard overview={overview} />);
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
