import { createContext, useContext, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { adminServiceRecordEditApi } from "@/features/service-records/api/admin-service-record-edit.api";
import type {
    ServiceRecordRevisionChangesResponse,
    ServiceRecordRevisionHistoryResponse,
} from "@/features/service-records/types";

import { RevisionHistoryView } from "./RevisionHistoryView";
import { ServiceRecordAdminWizard, type AdminServiceRecordEditorOverview } from "./ServiceRecordAdminWizard";
import {
    formatRevisionChangeValue,
    formatRevisionTimestamp,
    revisionChangeLabel,
} from "./revision-change-display";

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/features/service-records/case-events", () => ({
    subscribeServiceRecordCaseChanges: jest.fn(() => () => undefined),
}));
jest.mock("@/features/service-records/api/service-records.api", () => ({
    serviceRecordsApi: {
        getClientRevisionHistory: jest.fn(),
        getClientRevisionChanges: jest.fn(),
    },
}));
// Repo convention (see SendNotificationSection.test.tsx): jsdom cannot drive a Radix Select, so each option is a plain button.
jest.mock("@/components/ui/select", () => {
    const SelectContext = createContext<{ value?: string; onValueChange: (value: string) => void }>({ onValueChange: () => {} });
    function Select({ value, onValueChange, children }: { value?: string; onValueChange: (value: string) => void; children: ReactNode }) {
        return <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>;
    }
    function SelectTrigger({ children }: { children: ReactNode }) {
        return <>{children}</>;
    }
    function SelectContent({ children }: { children: ReactNode }) {
        return <div role="listbox">{children}</div>;
    }
    function SelectValue() {
        return null;
    }
    function SelectItem({ value, children }: { value: string; children: ReactNode }) {
        const context = useContext(SelectContext);
        return (
            <button type="button" role="option" aria-selected={context.value === value} onClick={() => context.onValueChange(value)}>
                {children}
            </button>
        );
    }
    return { Select, SelectTrigger, SelectContent, SelectItem, SelectValue };
});

const mockHistory = serviceRecordsApi.getClientRevisionHistory as jest.Mock;
const mockChanges = serviceRecordsApi.getClientRevisionChanges as jest.Mock;

// Deliberately oldest first: the view must order them newest first itself.
const history: ServiceRecordRevisionHistoryResponse = {
    caseId: "case-1",
    caseVersion: 4,
    currentRevisionId: "rev-3",
    currentUsableRevisionId: "rev-3",
    revisions: [
        // 10:02 in Korea.
        { id: "rev-1", revisionNumber: 1, confirmedAt: "2026-09-08T01:02:03.000Z", isCurrent: false, documents: [] },
        // 16:30 UTC is 01:30 the next day in Korea.
        { id: "rev-2", revisionNumber: 2, confirmedAt: "2026-09-09T16:30:00.000Z", isCurrent: false, documents: [] },
        // 15:05 UTC is 00:05 the next day in Korea.
        { id: "rev-3", revisionNumber: 3, confirmedAt: "2026-09-11T15:05:00.000Z", isCurrent: true, documents: [] },
    ],
};

const changesByRevision: Record<string, ServiceRecordRevisionChangesResponse> = {
    "rev-3": {
        revisionId: "rev-3",
        revisionNumber: 3,
        confirmedAt: "2026-09-11T15:05:00.000Z",
        formVersion: 1,
        beforeAvailable: true,
        basicInfo: [
            { path: "header.momName", before: "김산모", after: "이산모" },
            { path: "header.deliveryType", before: "자연분만", after: "제왕절개" },
            { path: "period.endDate", before: "2026-07-14", after: "2026-07-15" },
        ],
        sessions: [
            {
                sessionIndex: 2,
                kind: "changed",
                serviceDateBefore: "2026-07-12",
                serviceDateAfter: "2026-07-13",
                changes: [
                    { path: "session.answers.meals_meal", before: "3", after: "4" },
                    { path: "session.answers.perineum", before: ["이상없음"], after: ["열상", "혈종"] },
                    { path: "session.answers.mystery_key", before: null, after: "새 값" },
                    { path: "session.paymentConfirmed", before: false, after: true },
                    { path: "session.clientSignature", before: "present", after: "replaced" },
                    { path: "session.notes", before: "", after: "메모" },
                ],
            },
            { sessionIndex: 3, kind: "added", serviceDateBefore: null, serviceDateAfter: "2026-07-15", changes: [] },
            { sessionIndex: 4, kind: "removed", serviceDateBefore: "2026-07-16", serviceDateAfter: null, changes: [] },
            // A session reported with nothing to show is dropped, not rendered as an empty group.
            { sessionIndex: 5, kind: "changed", serviceDateBefore: "2026-07-17", serviceDateAfter: "2026-07-17", changes: [] },
        ],
    },
    "rev-2": {
        revisionId: "rev-2",
        revisionNumber: 2,
        confirmedAt: "2026-09-09T16:30:00.000Z",
        formVersion: 1,
        beforeAvailable: false,
        basicInfo: [],
        sessions: [],
    },
    "rev-1": {
        revisionId: "rev-1",
        revisionNumber: 1,
        confirmedAt: "2026-09-08T01:02:03.000Z",
        formVersion: 1,
        beforeAvailable: true,
        basicInfo: [],
        sessions: [],
    },
};

function renderWithQuery(node: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
    mockHistory.mockReset();
    mockChanges.mockReset();
    mockHistory.mockResolvedValue({ data: history });
    mockChanges.mockImplementation(async (_clientId: number, revisionId: string) => ({ data: changesByRevision[revisionId] }));
});

describe("revision change display helpers", () => {
    it("formats instants as KST YYYY-MM-DD HH:mm, across midnight", () => {
        expect(formatRevisionTimestamp("2026-09-08T01:02:03.000Z")).toBe("2026-09-08 10:02");
        expect(formatRevisionTimestamp("2026-09-09T16:30:00.000Z")).toBe("2026-09-10 01:30");
        expect(formatRevisionTimestamp("2026-12-31T15:00:00.000Z")).toBe("2027-01-01 00:00");
        expect(formatRevisionTimestamp("not a date")).toBe("not a date");
    });

    it("labels answer keys from the form layout and falls back to the raw key", () => {
        expect(revisionChangeLabel("session.answers.sitzBath")).toBe("④ 좌욕");
        expect(revisionChangeLabel("session.answers.meals_snack")).toBe("⑤ 식사/간식 간식");
        expect(revisionChangeLabel("session.answers.stool_color")).toBe("⑩ 배변양상 색깔 등");
        expect(revisionChangeLabel("session.answers.unknown_key")).toBe("unknown_key");
        expect(revisionChangeLabel("header.momName")).toBe("산모 성명");
        expect(revisionChangeLabel("header.deliveryType")).toBe("분만형태");
        expect(revisionChangeLabel("header.unknown")).toBe("unknown");
        expect(revisionChangeLabel("period.startDate")).toBe("서비스 시작일");
        expect(revisionChangeLabel("period.endDate")).toBe("서비스 종료일");
        expect(revisionChangeLabel("session.employee")).toBe("제공인력");
    });

    it("formats values: signatures, booleans, empty values and lists", () => {
        expect(formatRevisionChangeValue("session.clientSignature", "absent")).toBe("없음");
        expect(formatRevisionChangeValue("session.clientSignature", "present")).toBe("있음");
        expect(formatRevisionChangeValue("session.clientSignature", "replaced")).toBe("다시 서명됨");
        expect(formatRevisionChangeValue("session.paymentConfirmed", true)).toBe("예");
        expect(formatRevisionChangeValue("session.paymentConfirmed", false)).toBe("아니오");
        expect(formatRevisionChangeValue("session.notes", null)).toBe("—");
        expect(formatRevisionChangeValue("session.notes", "")).toBe("—");
        expect(formatRevisionChangeValue("session.answers.perineum", [])).toBe("—");
        expect(formatRevisionChangeValue("session.answers.perineum", ["열상", "혈종"])).toBe("열상, 혈종");
        expect(formatRevisionChangeValue("session.answers.meals_meal", 4)).toBe("4");
        // The signature mapping applies to the signature path only.
        expect(formatRevisionChangeValue("session.notes", "present")).toBe("present");
    });
});

describe("RevisionHistoryView", () => {
    function open(onBack = jest.fn()) {
        const result = renderWithQuery(<RevisionHistoryView data-component="test_history" clientId="42" onBack={onBack} />);
        return { ...result, onBack };
    }

    function rowFor(label: string): HTMLElement {
        return screen.getByText(label).closest('[role="group"]') as HTMLElement;
    }

    it("titles the page 수정 이력 and lists the edit times newest first in KST, numbered so same-minute edits stay distinct", async () => {
        open();
        expect(screen.getByRole("heading", { level: 1, name: "수정 이력" })).toBeInTheDocument();

        const options = await screen.findAllByRole("option");
        expect(options.map((option) => option.textContent)).toEqual([
            "#3 · 2026-09-12 00:05",
            "#2 · 2026-09-10 01:30",
            "#1 · 2026-09-08 10:02",
        ]);
        // The newest one is selected on entering the view.
        expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
        expect(mockHistory).toHaveBeenCalledWith(42);
        await waitFor(() => expect(mockChanges).toHaveBeenCalledWith(42, "rev-3"));
        expect(mockChanges).toHaveBeenCalledTimes(1);
    });

    it("shows the selected edit as before → after with question labels", async () => {
        open();
        await screen.findByText("김산모");

        const mom = rowFor("산모 성명");
        expect(within(mom).getByText("김산모")).toHaveAttribute("data-slot", "before-value");
        expect(within(mom).getByText("이산모")).toHaveAttribute("data-slot", "after-value");
        expect(within(rowFor("분만형태")).getByText("제왕절개")).toBeInTheDocument();
        expect(within(rowFor("서비스 종료일")).getByText("2026-07-14")).toBeInTheDocument();

        // Session group heading: number and date (after, else before), plus the 추가됨 / 삭제됨 tags.
        expect(screen.getByRole("heading", { name: "2회차 · 2026-07-13" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "3회차 · 2026-07-15" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "4회차 · 2026-07-16" })).toBeInTheDocument();
        expect(screen.getByText("추가됨")).toBeInTheDocument();
        expect(screen.getByText("삭제됨")).toBeInTheDocument();
        expect(screen.queryByText(/5회차/)).not.toBeInTheDocument();

        const meals = rowFor("⑤ 식사/간식 식사");
        expect(within(meals).getByText("3")).toHaveAttribute("data-slot", "before-value");
        expect(within(meals).getByText("4")).toHaveAttribute("data-slot", "after-value");
        const perineum = rowFor("① 회음절개부위 (또는 수술부위)");
        expect(within(perineum).getByText("이상없음")).toBeInTheDocument();
        expect(within(perineum).getByText("열상, 혈종")).toBeInTheDocument();
        // An answer key the form does not know shows the key; null reads as —.
        const unknown = rowFor("mystery_key");
        expect(within(unknown).getByText("—")).toHaveAttribute("data-slot", "before-value");
        expect(within(unknown).getByText("새 값")).toBeInTheDocument();
        const payment = rowFor("결제 확인");
        expect(within(payment).getByText("아니오")).toBeInTheDocument();
        expect(within(payment).getByText("예")).toBeInTheDocument();
        const signature = rowFor("산모 서명");
        expect(within(signature).getByText("있음")).toBeInTheDocument();
        expect(within(signature).getByText("다시 서명됨")).toBeInTheDocument();
        const notes = rowFor("특이사항");
        expect(within(notes).getByText("—")).toHaveAttribute("data-slot", "before-value");
        expect(within(notes).getByText("메모")).toBeInTheDocument();
    });

    it("shows the plain notice and no diff for an edit without stored before content", async () => {
        const { container } = open();
        fireEvent.click(await screen.findByRole("option", { name: "#2 · 2026-09-10 01:30" }));

        expect(await screen.findByText("변경 전 내용이 기록되지 않은 수정입니다.")).toBeInTheDocument();
        expect(mockChanges).toHaveBeenCalledWith(42, "rev-2");
        expect(container.querySelector('[data-slot="change"], [data-slot="changes"]')).toBeNull();
        expect(screen.queryByText("표시할 변경 내용이 없습니다.")).not.toBeInTheDocument();
        expect(screen.getByRole("option", { name: "#2 · 2026-09-10 01:30" })).toHaveAttribute("aria-selected", "true");
    });

    it("says there is nothing to show for an edit with no listed changes", async () => {
        open();
        fireEvent.click(await screen.findByRole("option", { name: "#1 · 2026-09-08 10:02" }));
        expect(await screen.findByText("표시할 변경 내용이 없습니다.")).toBeInTheDocument();
        expect(screen.queryByText("변경 전 내용이 기록되지 않은 수정입니다.")).not.toBeInTheDocument();
    });

    it("says there is no history when there are no revisions", async () => {
        mockHistory.mockResolvedValue({ data: { ...history, currentRevisionId: null, currentUsableRevisionId: null, revisions: [] } });
        open();
        expect(await screen.findByText("수정 이력이 없습니다.")).toBeInTheDocument();
        expect(screen.queryByRole("option")).not.toBeInTheDocument();
        expect(mockChanges).not.toHaveBeenCalled();
    });

    it("reports a failed history or changes load instead of an empty view", async () => {
        mockHistory.mockRejectedValue(new Error("boom"));
        const first = open();
        expect(await screen.findByText("수정 이력을 불러오지 못했습니다.")).toBeInTheDocument();
        first.unmount();

        mockHistory.mockResolvedValue({ data: history });
        mockChanges.mockRejectedValue(new Error("boom"));
        open();
        expect(await screen.findByText("변경 내용을 불러오지 못했습니다.")).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "#3 · 2026-09-12 00:05" })).toBeInTheDocument();
    });

    it("calls onBack from the back control", async () => {
        const { onBack } = open();
        await screen.findAllByRole("option");
        fireEvent.click(screen.getByRole("button", { name: "이전" }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});

describe("ServiceRecordAdminWizard 수정 이력 entry", () => {
    const dates = ["2026-09-07", "2026-09-08", "2026-09-09"];
    const wizardOverview = {
        record: {
            id: "case-1",
            status: "COMPLETED",
            startDate: dates[0],
            endDate: dates[2],
            totalSessions: 3,
            completedAt: null,
            finalizationDueAt: null,
            finalizedAt: null,
            documentsCompletedAt: null,
            lastError: null,
            header: {
                momName: "김산모", momBirth: "1990-01-01", babyName: "김아기", babyBirth: "2026-07-14",
                deliveryType: "자연분만", babyWeight: "3.2",
                createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
            },
            sessions: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1, serviceDate, locked: false, submittedAt: "2026-09-08T07:14:00Z",
                updatedAt: "2026-07-01T00:00:00.000Z", answers: {}, etcService: null, notes: null,
                paymentConfirmed: false, hasMomApproval: false, employeeId: null, employeeName: null, formVersion: 1,
            })),
            signatureDocs: [],
        },
        assignments: [],
        scheduleProjection: {
            entries: dates.map((serviceDate, index) => ({
                sessionIndex: index + 1, serviceDate, originalDate: serviceDate,
                assignmentId: "assignment-7", scheduleId: 7, employeeId: 7, provenanceVersion: "projection-1",
            })),
            blockingReasons: [],
        },
    } as unknown as AdminServiceRecordEditorOverview;

    function openWizard() {
        return renderWithQuery(
            <ServiceRecordAdminWizard
                clientId="42"
                overview={wizardOverview}
                initialDraftState={{
                    draft: null, sourceChanged: false, sourceCaseVersion: 1, sourceFingerprint: "source-1",
                } as never}
            />,
        );
    }

    beforeEach(() => {
        jest.spyOn(adminServiceRecordEditApi, "getDraft").mockResolvedValue({
            draft: null, sourceChanged: false, sourceCaseVersion: 1, sourceFingerprint: "source-1",
        } as never);
    });
    afterEach(() => { jest.restoreAllMocks(); });

    it("puts 수정 이력 보기 directly under 기본정보 수정", () => {
        const { container } = openWizard();
        const headerEdit = screen.getByRole("button", { name: "기본정보 수정" });
        const historyOpen = screen.getByRole("button", { name: "수정 이력 보기" });
        const actions = container.querySelector('[data-slot="edit-actions"]')!;
        expect(Array.from(actions.children)).toEqual([headerEdit, historyOpen]);
        expect(actions).toHaveClass("flex-col");
        expect(headerEdit).toBeEnabled();
        expect(historyOpen).toBeEnabled();
        // It is not a list at the bottom of the page: the overview shows no history until the button is pressed.
        expect(screen.queryByText("수정 이력")).not.toBeInTheDocument();
        expect(mockHistory).not.toHaveBeenCalled();
    });

    it("switches to the 수정 이력 view and back to the overview", async () => {
        const { container } = openWizard();
        fireEvent.click(screen.getByRole("button", { name: "수정 이력 보기" }));

        expect(screen.getByRole("heading", { level: 1, name: "수정 이력" })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: /제공기록지/ })).not.toBeInTheDocument();
        expect(container.querySelectorAll('[data-slot="day"]')).toHaveLength(0);
        const options = await screen.findAllByRole("option");
        expect(options[0]).toHaveTextContent("2026-09-12 00:05");

        fireEvent.click(screen.getByRole("button", { name: "이전" }));
        expect(screen.getByRole("heading", { level: 1, name: /제공기록지/ })).toBeInTheDocument();
        expect(container.querySelectorAll('[data-slot="day"]')).toHaveLength(3);
        expect(screen.getByRole("button", { name: "수정 이력 보기" })).toBeEnabled();
        expect(screen.queryByRole("heading", { name: "수정 이력" })).not.toBeInTheDocument();
    });

    it("keeps the button and shows the empty message when there are no revisions", async () => {
        mockHistory.mockResolvedValue({ data: { ...history, currentRevisionId: null, currentUsableRevisionId: null, revisions: [] } });
        openWizard();
        expect(screen.getByRole("button", { name: "수정 이력 보기" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "수정 이력 보기" }));
        expect(await screen.findByText("수정 이력이 없습니다.")).toBeInTheDocument();
    });
});
