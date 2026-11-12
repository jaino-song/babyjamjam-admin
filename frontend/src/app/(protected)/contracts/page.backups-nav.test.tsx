import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import ContractsPage from "./page";
import { useInitialUser } from "@/providers/UserProvider";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/contracts",
}));

jest.mock("@/hooks/useBusinessDayCalendar", () => ({
  useBusinessDayCalendar: () => ({ calendar: undefined }),
}));
jest.mock("@/hooks/useEformsignAuth", () => ({
  useEformsignAuth: () => ({ isAuthenticated: false, isLoading: false, error: null }),
}));
jest.mock("@/hooks/useEformsignDocsLiveStream", () => ({
  useEformsignDocsLiveStream: () => undefined,
}));
jest.mock("@/hooks/useInfiniteContracts", () => ({
  useInfiniteContracts: () => ({
    documents: [],
    isLoading: false,
    isFetching: false,
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    error: null,
  }),
}));
jest.mock("@/hooks/useEformsignDocumentJobs", () => ({
  useEformsignDocumentJobs: () => ({
    data: undefined, summary: undefined, isLoading: false, error: null, refetch: jest.fn(),
    summaryQuery: { error: null, isFetching: false, isLoading: false, refetch: jest.fn() },
  }),
  useEnqueueEformsignDocumentFinalization: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks/useEformsignDocuments", () => ({
  useContractClientCandidate: () => ({ data: undefined, isSuccess: false, isError: false }),
  useDeleteEformsignDocument: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks/useVoucherData", () => ({
  useAllVoucherPriceInfos: () => ({ data: [] }),
}));
jest.mock("@/features/system-templates/branch-context", () => ({
  isBranchContextAligned: () => true,
  useActiveBranchId: () => "branch-1",
}));
jest.mock("@/features/service-records/hooks/use-service-records", () => ({
  useClientServiceRecords: () => ({ data: undefined }),
}));
jest.mock("@/services/api", () => ({
  eformsignApi: {
    getLinkConfirmations: jest.fn().mockResolvedValue([]),
    getDocumentClientNames: jest.fn().mockResolvedValue([]),
    getDocumentStatusCounts: jest.fn().mockResolvedValue({ documents: [] }),
  },
  withEformsignReauth: jest.fn(),
}));

jest.mock("@/providers/UserProvider", () => ({ useInitialUser: jest.fn() }));
jest.mock("@/components/app/contracts/EformsignBackupHistory", () => ({
  EformsignBackupHistory: () => <div>backup-history-stub</div>,
}));

function renderPage(role: "owner" | "manager") {
  (useInitialUser as jest.Mock).mockReturnValue({ role });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ContractsPage /></QueryClientProvider>);
}

describe("ContractsPage backup navigation", () => {
  it("shows backup history after an owner selects the section", () => {
    renderPage("owner");
    expect(screen.queryByText("backup-history-stub")).not.toBeInTheDocument();
    // SectionNav renders both its desktop and mobile navigation in the test DOM.
    fireEvent.click(screen.getAllByRole("button", { name: /전자문서 백업/ })[0]);
    expect(screen.getByText("backup-history-stub")).toBeInTheDocument();
  });

  it("hides backup navigation for a manager", () => {
    renderPage("manager");
    expect(screen.queryByRole("button", { name: /전자문서 백업/ })).not.toBeInTheDocument();
    expect(screen.queryByText("backup-history-stub")).not.toBeInTheDocument();
  });
});
