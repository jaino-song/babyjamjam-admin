import { fireEvent, render, screen } from "@testing-library/react";
import type { Client } from "@/lib/client/types";
import { useClients } from "@/hooks/useClients";
import {
    buildMonthCalendarDays,
    EmployeeScheduleManager,
    getScheduleMonthRange,
} from "./EmployeeScheduleManager";

jest.mock("@/hooks/useClients", () => ({
    useClients: jest.fn(),
}));

jest.mock("@/components/app/clients/ClientDetailPanel", () => ({
    ClientDetailPanel: ({ client }: { client: Client }) => <section aria-label="고객 상세" data-testid="client-detail">{client.id} · {client.name}</section>,
}));

const mockedUseClients = jest.mocked(useClients);

function makeClient(overrides: Partial<Client>): Client {
    return {
        id: 1,
        name: "박서연",
        birthday: null,
        dueDate: null,
        birthDate: null,
        address: null,
        phone: null,
        primaryEmployee: { id: 7, name: "김하늘" },
        secondaryEmployee: null,
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        careCenter: null,
        voucherClient: true,
        breastPump: false,
        serviceStatus: "active",
        eDocId: null,
        hasSigned: false,
        documentStatus: null,
        ...overrides,
    };
}

function localDateKey(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function mockClients(clients: Client[] = [], overrides: Record<string, unknown> = {}) {
    const refetch = jest.fn();
    mockedUseClients.mockReturnValue({
        data: { data: clients },
        isLoading: false,
        isError: false,
        refetch,
        ...overrides,
    } as unknown as ReturnType<typeof useClients>);
    return refetch;
}

function renderManager() {
    return render(<EmployeeScheduleManager data-component="test_schedule_manager" />);
}

describe("EmployeeScheduleManager calendar grid", () => {
    it("starts every month on Sunday and aligns a Thursday-start month", () => {
        const horizonStart = new Date(2026, 8, 1);
        const horizonEnd = new Date(2026, 10, 30);
        const sundayStart = buildMonthCalendarDays(new Date(2026, 10, 1), horizonStart, horizonEnd);
        const thursdayStart = buildMonthCalendarDays(new Date(2026, 9, 1), horizonStart, horizonEnd);

        expect(sundayStart[0]).toEqual(expect.objectContaining({ dateKey: "2026-11-01" }));
        expect(sundayStart[0]?.date.getDay()).toBe(0);
        expect(thursdayStart[0]?.dateKey).toBe("2026-09-27");
        expect(thursdayStart[0]?.date.getDay()).toBe(0);
        expect(thursdayStart[4]?.dateKey).toBe("2026-10-01");
    });

    it("rolls the navigable range across a month boundary and marks dates beyond day 30 out of scope", () => {
        const range = getScheduleMonthRange(new Date("2026-09-29T09:00:00+09:00"));
        const october = buildMonthCalendarDays(new Date(2026, 9, 1), range.horizonStart, range.horizonEnd);

        expect(range.minMonthKey).toBe("2026-09");
        expect(range.maxMonthKey).toBe("2026-10");
        expect(october.find((day) => day.dateKey === "2026-10-29")?.isInHorizon).toBe(true);
        expect(october.find((day) => day.dateKey === "2026-10-30")?.isInHorizon).toBe(false);
    });
});

describe("EmployeeScheduleManager interactions", () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it("selects a date without opening entry detail, then reveals detail only after an entry click", () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowKey = localDateKey(tomorrow);
        mockClients([makeClient({ startDate: tomorrowKey })]);

        const { container } = renderManager();
        const dayButton = container.querySelector(`[data-slot="calendar-day"][data-date="${tomorrowKey}"]`);

        expect(dayButton).toBeInTheDocument();
        fireEvent.click(dayButton!);
        expect(screen.getByText("1건")).toBeInTheDocument();
        expect(screen.queryByText("일정 유형")).not.toBeInTheDocument();

        const agendaRow = container.querySelector('[data-component="test_schedule_manager_agenda_row"]');
        expect(agendaRow).toBeInTheDocument();
        fireEvent.click(agendaRow!);

        expect(screen.getByRole("region", { name: "고객 상세" })).toHaveTextContent("1 · 박서연");
        const back = screen.getByRole("button", { name: "서비스 일정으로 돌아가기" });
        expect(back).toHaveFocus();
        expect(container.querySelector('[data-slot="sliding-detail-list"]')).toHaveAttribute("inert");
        fireEvent.click(back);
        expect(container.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "false");
        expect(dayButton).toHaveAttribute("aria-pressed", "true");
        expect(container.querySelector('[data-slot="sliding-detail-content"]')).toHaveAttribute("inert");
    });

    it("switches between calendar and list views while keeping the same entry selection", () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowKey = localDateKey(tomorrow);
        mockClients([makeClient({ startDate: tomorrowKey })]);

        const { container } = renderManager();
        expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "test_schedule_manager-view-tab-calendar");
        fireEvent.click(screen.getByRole("tab", { name: "목록" }));
        expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "test_schedule_manager-view-panel-list");

        expect(container.querySelector('[data-panel="calendar"]')).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelector('[data-slot="schedule-entry-list"]')).toBeInTheDocument();

        const listRow = container.querySelector('[data-component="test_schedule_manager_list_row"]');
        expect(listRow).toBeInTheDocument();
        fireEvent.click(listRow!);
        expect(screen.getByRole("region", { name: "고객 상세" })).toHaveTextContent("1 · 박서연");
    });

    it("renders empty, loading, and retryable error states", () => {
        mockClients([]);
        const { container, rerender } = renderManager();
        fireEvent.click(screen.getByRole("tab", { name: "목록" }));
        expect(screen.getByText("앞으로 30일 일정이 없습니다.")).toBeInTheDocument();

        mockedUseClients.mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            refetch: jest.fn(),
        } as unknown as ReturnType<typeof useClients>);
        rerender(<EmployeeScheduleManager data-component="test_schedule_manager" />);
        expect(screen.getByRole("status", { name: "일정 로딩 중" })).toBeInTheDocument();

        const refetch = mockClients([], { data: undefined, isError: true });
        rerender(<EmployeeScheduleManager data-component="test_schedule_manager" />);
        expect(screen.getByRole("alert")).toHaveTextContent("일정을 불러오지 못했습니다");
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(refetch).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-slot="schedule-error"]')).toBeInTheDocument();
    });
});
