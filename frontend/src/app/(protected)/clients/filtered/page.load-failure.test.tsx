import { fireEvent, render, screen } from "@testing-library/react";
import { useFilteredClients } from "@/hooks/useClients";
import type { Client } from "@/lib/client/types";
import FilteredClientsPage from "./page";

let mockFilter: string | null = "starting-soon";
jest.mock("next/navigation", () => ({
    useSearchParams: () => ({ get: () => mockFilter }),
    useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/hooks/useClients", () => ({
    useFilteredClients: jest.fn(),
    useDeleteClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/components/app/clients/ClientDetailModal", () => ({ ClientDetailModal: () => null }));
jest.mock("@/components/app/clients/ClientFormDialog", () => ({ ClientFormDialog: () => null }));

const mockedUseClients = jest.mocked(useFilteredClients);
const cachedClient = {
    id: 1, name: "캐시 고객", startDate: null, documentStatus: null, hasSigned: false,
} as Client;

function mockClients(data: Client[] | undefined, overrides: Record<string, unknown> = {}) {
    const refetch = jest.fn();
    mockedUseClients.mockReturnValue({
        data, isLoading: false, isPaused: false, isError: false, isFetching: false,
        status: "success", fetchStatus: "idle", refetch, ...overrides,
    } as unknown as ReturnType<typeof useFilteredClients>);
    return refetch;
}

describe("FilteredClientsPage query states", () => {
    beforeEach(() => { mockFilter = "starting-soon"; });
    afterEach(() => { jest.clearAllMocks(); });

    it.each([
        { isLoading: true, isPending: true, status: "pending", fetchStatus: "fetching", isFetching: true },
        { isPending: true, isLoading: false, isError: false, isFetching: false, isPaused: true, status: "pending", fetchStatus: "paused" },
    ])("keeps unknown first loads in the existing skeleton: %j", (state) => {
        mockClients(undefined, state);
        const { container } = render(<FilteredClientsPage />);
        expect(container.querySelector('[data-component="desktop_clients-filtered_page_content_loading"]')).toBeInTheDocument();
        expect(screen.queryByText("해당하는 클라이언트가 없습니다")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByText(/0건/)).not.toBeInTheDocument();
    });

    it("shows a retryable panel rather than empty data after a first-load failure", () => {
        const refetch = mockClients(undefined, { isError: true, status: "error", error: new Error("failed") });
        const { rerender } = render(<FilteredClientsPage />);
        expect(screen.getByRole("alert")).toHaveTextContent("고객 목록을 불러오지 못했습니다");
        expect(screen.getByRole("alert")).toHaveAttribute("data-size", "panel");
        expect(screen.queryByText("해당하는 클라이언트가 없습니다")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(refetch).toHaveBeenCalledTimes(1);
        mockClients(undefined, { isLoading: true, isFetching: true, isPending: true, status: "pending", fetchStatus: "fetching" });
        rerender(<FilteredClientsPage />);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByText("해당하는 클라이언트가 없습니다")).not.toBeInTheDocument();
    });

    it("shows the existing empty text after successful empty data", () => {
        mockClients([]);
        render(<FilteredClientsPage />);
        expect(screen.getByText("해당하는 클라이언트가 없습니다")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByText("최신 정보를 불러오지 못했습니다")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    });

    it.each([null, "unknown"])("keeps invalid/disabled filter behavior for %s", (filter) => {
        mockFilter = filter;
        mockClients(undefined, { isPending: true, status: "pending", fetchStatus: "idle" });
        const { container } = render(<FilteredClientsPage />);
        expect(screen.getByRole("alert")).toHaveTextContent("잘못된 필터입니다");
        expect(container.querySelector('[data-component="desktop_clients-filtered_page_content"]')).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    });

    it.each([{ rows: [cachedClient] }, { rows: [] }])("retains cached data (including empty data) with one inline retry notice: %j", ({ rows }) => {
        const refetch = mockClients(rows, { isError: true, status: "error", error: new Error("refetch failed") });
        const { container, rerender } = render(<FilteredClientsPage />);
        const notice = container.querySelector('[data-slot="query-error-state"]');
        expect(container.querySelectorAll('[data-slot="query-error-state"]')).toHaveLength(1);
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(notice).toHaveAttribute("data-size", "inline");
        expect(notice).toHaveTextContent("최신 정보를 불러오지 못했습니다");
        expect(screen.getByText(rows.length ? "캐시 고객" : "해당하는 클라이언트가 없습니다")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(refetch).toHaveBeenCalledTimes(1);
        mockClients(rows, { isError: true, isFetching: true, status: "error", fetchStatus: "fetching" });
        rerender(<FilteredClientsPage />);
        expect(screen.getByRole("button", { name: /다시 시도/ })).toBeDisabled();
    });

    it("does not replace cached data during a paused refetch", () => {
        mockClients([cachedClient], { isPaused: true, fetchStatus: "paused" });
        const { container } = render(<FilteredClientsPage />);
        expect(screen.getByText("캐시 고객")).toBeInTheDocument();
        expect(container.querySelector('[data-component="desktop_clients-filtered_page_content_loading"]')).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});
