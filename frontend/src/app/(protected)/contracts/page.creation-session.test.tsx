/**
 * The contracts page owns the creation wizard's active step. These tests pin
 * how that step behaves around a creation session (submit until the user
 * finishes or leaves): the page must not move the step when a session ends on
 * its own, and 전자문서 발송 must resume a running session instead of starting
 * a new one. ContractCreationForm is stubbed; its own behaviour is covered in
 * components/app/contracts/__tests__.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import ContractsPage from "./page";

const PROCESSING_STEP = 4;
const CONTRACT_INFO_STEP = 3;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
  useEformsignDocumentJobs: () => ({ data: undefined }),
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
    getDocumentClientNames: jest.fn().mockResolvedValue([]),
    getDocumentStatusCounts: jest.fn().mockResolvedValue({ documents: [] }),
  },
  withEformsignReauth: jest.fn(),
}));

jest.mock("@/components/app/contracts/ContractCreationForm", () => ({
  CONTRACT_CREATION_STEPPER_STEPS: [{ label: "이용자 정보" }],
  ContractCreationForm: ({
    activeStep,
    onActiveStepChange,
    onSessionStateChange,
  }: {
    activeStep: number;
    onActiveStepChange: (step: number) => void;
    onSessionStateChange: (hasSession: boolean) => void;
  }) => (
    <div>
      <span data-testid="stub-step">{activeStep}</span>
      <button
        type="button"
        onClick={() => {
          onActiveStepChange(4);
          onSessionStateChange(true);
        }}
      >
        stub-begin-session
      </button>
      <button
        type="button"
        onClick={() => {
          onActiveStepChange(3);
          onSessionStateChange(false);
        }}
      >
        stub-fail-to-contract-info
      </button>
    </div>
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContractsPage />
    </QueryClientProvider>,
  );
}

const sendButton = () => screen.getByRole("button", { name: /전자문서 발송/ });
const stubStep = () => screen.getByTestId("stub-step").textContent;

describe("ContractsPage creation session step", () => {
  it("resumes the in-progress creation instead of starting a new send session", () => {
    renderPage();
    fireEvent.click(sendButton());
    fireEvent.click(screen.getByText("stub-begin-session"));
    expect(stubStep()).toBe(String(PROCESSING_STEP));

    fireEvent.click(sendButton());

    expect(stubStep()).toBe(String(PROCESSING_STEP));
  });

  it("does not move the wizard when the session ends by landing on 계약 정보", () => {
    renderPage();
    fireEvent.click(sendButton());
    fireEvent.click(screen.getByText("stub-begin-session"));

    fireEvent.click(screen.getByText("stub-fail-to-contract-info"));

    expect(stubStep()).toBe(String(CONTRACT_INFO_STEP));
  });

  it("starts a genuinely new contract at the first step when nothing is in progress", () => {
    renderPage();
    fireEvent.click(sendButton());
    fireEvent.click(screen.getByText("stub-begin-session"));
    fireEvent.click(screen.getByText("stub-fail-to-contract-info"));
    expect(stubStep()).toBe(String(CONTRACT_INFO_STEP));

    fireEvent.click(sendButton());

    expect(stubStep()).toBe("0");
  });
});
