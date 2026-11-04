import { fireEvent, render, screen } from "@testing-library/react";
import { ChatWorkspaceStats } from "./ChatWorkspaceStats";

const mockContracts = jest.fn();
const mockClients = jest.fn();
const mockRetryContracts = jest.fn();
const mockRetryClients = jest.fn();
const mockContext = { user: { id: 1 } as { id: number } | null, branchId: "a" as string | null, aligned: true };
jest.mock("@/providers/UserProvider", () => ({ useInitialUser: () => mockContext.user }));
jest.mock("@/features/system-templates/branch-context", () => ({ useActiveBranchId: () => mockContext.branchId, isBranchContextAligned: () => mockContext.aligned }));
jest.mock("@/hooks/useDashboardStats", () => ({ useDashboardStats: (options: unknown) => mockContracts(options) }));
jest.mock("@/features/clients/hooks/use-clients", () => ({ useClientListSummary: (options: unknown) => mockClients(options) }));
// DocumentJobsStatMini owns its provider loading/error independently; keep the real StatsBar.
jest.mock("@/components/app/contracts/DocumentJobsStatMini", () => ({ useDocumentJobsStatVisible: () => true, DocumentJobsStatMini: () => <div>전자문서 실제 공급자 슬롯</div> }));

describe("ChatWorkspaceStats truthful independent states", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockContext.user = { id: 1 }; mockContext.branchId = "a"; mockContext.aligned = true;
        mockContracts.mockReturnValue({ data: { contractsNotSent: 0 }, isError: false, isPending: false, isFetching: false, refetch: mockRetryContracts });
        mockClients.mockReturnValue({ data: { serviceEnd: { count: 2 } }, isError: false, isInitialLoading: false, isFetching: false, refetch: mockRetryClients });
    });
    it("shows actual zero and counts with the document jobs slot, scoped options and full component paths", () => {
        const { container } = render(<ChatWorkspaceStats data-component="desktop_chat_workspace_stats" />);
        expect(screen.getByText("0")).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
        expect(screen.getByText("전자문서 실제 공급자 슬롯")).toBeInTheDocument();
        expect(mockContracts).toHaveBeenCalledWith({ branchId: "a", enabled: true });
        expect(mockClients).toHaveBeenCalledWith({ branchId: "a" });
        expect(container.querySelector('[data-component="desktop_chat_workspace_stats_stats_item-0"]')).toHaveTextContent("계약서 필요");
    });
    it("loads each card independently and keeps provider status independent", () => {
        mockContracts.mockReturnValue({ data: undefined, isError: false, isPending: true, refetch: mockRetryContracts });
        render(<ChatWorkspaceStats data-component="desktop_chat_workspace_stats" />);
        expect(screen.queryByText("계약서 필요")).not.toBeInTheDocument();
        expect(screen.getByText("종료 예정 산모")).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
        expect(screen.getByText("전자문서 실제 공급자 슬롯")).toBeInTheDocument();
    });
    it("does not turn errors or stale error data into counts, and retries each source explicitly", () => {
        mockContracts.mockReturnValue({ data: { contractsNotSent: 99 }, isError: true, isPending: false, refetch: mockRetryContracts });
        mockClients.mockReturnValue({ data: undefined, isError: true, isInitialLoading: false, refetch: mockRetryClients });
        render(<ChatWorkspaceStats data-component="desktop_chat_workspace_stats" />);
        expect(screen.queryByText("99")).not.toBeInTheDocument();
        expect(screen.queryByText("0")).not.toBeInTheDocument();
        expect(screen.getAllByText("—")).toHaveLength(2);
        fireEvent.click(screen.getByRole("button", { name: "계약서 필요 현황 다시 시도" }));
        fireEvent.click(screen.getByRole("button", { name: "종료 예정 산모 현황 다시 시도" }));
        expect(mockRetryContracts).toHaveBeenCalledTimes(1);
        expect(mockRetryClients).toHaveBeenCalledTimes(1);
    });
    it.each(["auth", "branch"])("hides cached counts and disables queries while %s is unavailable", (missing) => {
        if (missing === "auth") mockContext.user = null; else mockContext.aligned = false;
        render(<ChatWorkspaceStats data-component="desktop_chat_workspace_stats" />);
        expect(screen.getAllByText("—")).toHaveLength(2);
        expect(screen.queryByText("0")).not.toBeInTheDocument();
        expect(mockContracts).toHaveBeenCalledWith({ branchId: "a", enabled: false });
        expect(mockClients).toHaveBeenCalledWith({ branchId: null });
    });
});
