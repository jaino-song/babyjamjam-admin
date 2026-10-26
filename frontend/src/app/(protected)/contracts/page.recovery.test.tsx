/**
 * /contracts?recoverJobId=<id> opens the failed-job recovery dialog once and clears the param,
 * and "새로 작성" from that dialog never silently discards a creation in progress.
 * ContractCreationForm is stubbed; the dialog itself is covered in
 * components/app/contracts/DocumentJobRecoveryDialog.test.tsx.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { eformsignApi } from "@/services/api";

import ContractsPage from "./page";

const PROCESSING_STEP = 4;

let mockParams = new URLSearchParams();
const mockReplace = jest.fn(() => {
  mockParams = new URLSearchParams();
});
let mockMountCount = 0;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, refresh: jest.fn() }),
  useSearchParams: () => mockParams,
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
  useEnqueueEformsignDocumentFinalization: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useEnqueueEformsignDocumentCreation: () => ({ mutateAsync: jest.fn(), isPending: false }),
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
    claimDocumentJobRecovery: jest.fn(),
    resolveDocumentJob: jest.fn(),
  },
  withEformsignReauth: jest.fn(),
}));

jest.mock("@/components/app/contracts/ContractCreationForm", () => {
  const { useRef } = jest.requireActual<typeof import("react")>("react");
  return {
    CONTRACT_CREATION_STEPPER_STEPS: [{ label: "이용자 정보" }],
    ContractCreationForm: ({
      activeStep,
      onActiveStepChange,
      onSessionStateChange,
    }: {
      activeStep: number;
      onActiveStepChange: (step: number) => void;
      onSessionStateChange: (hasSession: boolean) => void;
    }) => {
      const mountId = useRef<number | null>(null);
      if (mountId.current === null) {
        mockMountCount += 1;
        mountId.current = mockMountCount;
      }
      return (
        <div>
          <span data-testid="stub-step">{activeStep}</span>
          <span data-testid="stub-mount">{mountId.current}</span>
          <button
            type="button"
            onClick={() => {
              onActiveStepChange(4);
              onSessionStateChange(true);
            }}
          >
            stub-begin-session
          </button>
        </div>
      );
    },
  };
});

const claim = eformsignApi.claimDocumentJobRecovery as jest.Mock;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <ContractsPage />
    </QueryClientProvider>
  );
  const view = render(tree());
  // The router would re-render the page with the new URL; do the same by hand.
  return { ...view, followLink: (search: string) => { mockParams = new URLSearchParams(search); view.rerender(tree()); } };
}

const sendButton = () => screen.getByRole("button", { name: /전자문서 발송/ });
const stubStep = () => screen.getByTestId("stub-step").textContent;

function verifyResultClaim() {
  return {
    job: {
      jobId: "j1",
      jobType: "create_document",
      source: "staff",
      status: "requires_attention",
      clientId: 1,
      documentId: "doc-1",
      progressStep: null,
      attempts: 1,
      nextAttemptAt: "2026-11-01T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      clientName: "김하늘",
      recoveryKind: "verify_result",
      lastErrorCode: null,
    },
    recoveryKind: "verify_result",
    payload: null,
    claimExpiresAt: null,
  };
}

describe("ContractsPage failed-job recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = new URLSearchParams();
    mockMountCount = 0;
    claim.mockResolvedValue(verifyResultClaim());
  });

  it("opens the recovery dialog once for ?recoverJobId= and removes the param", async () => {
    mockParams = new URLSearchParams("recoverJobId=j1");
    renderPage();

    expect(await screen.findByText("전자문서 결과 확인 필요")).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith("/contracts", { scroll: false });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith("j1");

    // Closing the dialog does not bring it back: the param is already gone.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("전자문서 결과 확인 필요")).not.toBeInTheDocument());
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("shows no dialog without the param", () => {
    renderPage();

    expect(claim).not.toHaveBeenCalled();
    expect(screen.queryByText("전자문서 결과 확인 필요")).not.toBeInTheDocument();
  });

  it("keeps a creation in progress, with its step, when the discard confirm is cancelled", async () => {
    const page = renderPage();
    fireEvent.click(sendButton());
    fireEvent.click(screen.getByText("stub-begin-session"));
    expect(stubStep()).toBe(String(PROCESSING_STEP));
    const mountBefore = screen.getByTestId("stub-mount").textContent;

    page.followLink("recoverJobId=j1");
    await screen.findByText("전자문서 결과 확인 필요");

    fireEvent.click(await screen.findByRole("button", { name: "새로 작성" }));
    fireEvent.click(await screen.findByRole("button", { name: "확인했어요" }));
    expect(await screen.findByText("작성 중인 계약서를 버리고 새로 작성할까요?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() =>
      expect(screen.queryByText("작성 중인 계약서를 버리고 새로 작성할까요?")).not.toBeInTheDocument(),
    );
    expect(stubStep()).toBe(String(PROCESSING_STEP));
    expect(screen.getByTestId("stub-mount").textContent).toBe(mountBefore);
  });

  it("starts a fresh form at the first step once the discard is confirmed", async () => {
    const page = renderPage();
    fireEvent.click(sendButton());
    fireEvent.click(screen.getByText("stub-begin-session"));
    const mountBefore = screen.getByTestId("stub-mount").textContent;

    page.followLink("recoverJobId=j1");
    await screen.findByText("전자문서 결과 확인 필요");

    fireEvent.click(await screen.findByRole("button", { name: "새로 작성" }));
    fireEvent.click(await screen.findByRole("button", { name: "확인했어요" }));
    fireEvent.click(await screen.findByRole("button", { name: "버리고 새로 작성" }));

    await waitFor(() => expect(screen.queryByText("전자문서 결과 확인 필요")).not.toBeInTheDocument());
    expect(stubStep()).toBe("0");
    expect(screen.getByTestId("stub-mount").textContent).not.toBe(mountBefore);
  });

  it("opens a fresh form without a prompt when nothing is in progress", async () => {
    mockParams = new URLSearchParams("recoverJobId=j1");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "새로 작성" }));
    fireEvent.click(await screen.findByRole("button", { name: "확인했어요" }));

    await waitFor(() => expect(screen.getByTestId("stub-step")).toBeInTheDocument());
    expect(stubStep()).toBe("0");
    expect(screen.queryByText("작성 중인 계약서를 버리고 새로 작성할까요?")).not.toBeInTheDocument();
  });
});
