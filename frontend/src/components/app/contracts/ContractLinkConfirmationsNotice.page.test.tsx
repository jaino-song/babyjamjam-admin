import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import ContractsPage from "@/app/(protected)/contracts/page";

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/hooks/useBusinessDayCalendar", () => ({ useBusinessDayCalendar: () => ({ calendar: undefined }) }));
jest.mock("@/hooks/useEformsignAuth", () => ({
    useEformsignAuth: () => ({ isAuthenticated: false, isLoading: false, error: null }),
}));
jest.mock("@/hooks/useEformsignDocsLiveStream", () => ({ useEformsignDocsLiveStream: () => undefined }));
jest.mock("@/hooks/useInfiniteContracts", () => ({
    useInfiniteContracts: () => ({
        documents: [], allDocuments: [], totalCount: 0,
        isLoading: false, isFetching: false, isFetchingNextPage: false,
        isError: false, isRefetching: false, isFetchNextPageError: false,
        hasNextPage: false, error: null, refetch: jest.fn(), fetchNextPage: jest.fn(),
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
jest.mock("@/hooks/useVoucherData", () => ({ useAllVoucherPriceInfos: () => ({ data: [] }) }));
jest.mock("@/features/system-templates/branch-context", () => ({
    isBranchContextAligned: () => true, useActiveBranchId: () => "branch-1",
}));
jest.mock("@/features/service-records/hooks/use-service-records", () => ({
    useClientServiceRecords: () => ({ data: undefined }),
}));
jest.mock("@/services/api", () => ({
    eformsignApi: { getDocumentClientNames: jest.fn().mockResolvedValue([]) },
    withEformsignReauth: jest.fn(),
}));
jest.mock("./ContractLinkConfirmationsNotice", () => ({
    ContractLinkConfirmationsNotice: () => <div data-testid="link-confirmations-notice" />,
}));

it("mounts the notice only for maternity contracts, between stats and sections", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { container } = render(<QueryClientProvider client={client}><ContractsPage /></QueryClientProvider>);
    const notice = screen.getByTestId("link-confirmations-notice");
    expect(notice.previousElementSibling).toHaveAttribute("data-slot", "contract-stats-bar");
    expect(notice.nextElementSibling).toHaveAttribute("data-slot", "contracts-sections");
    expect(container.querySelector('[data-component="desktop_contracts_sections"]')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "제공기록지" })[0]);
    expect(screen.queryByTestId("link-confirmations-notice")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "산모 계약서" })[0]);
    expect(screen.getByTestId("link-confirmations-notice")).toBeInTheDocument();
});
