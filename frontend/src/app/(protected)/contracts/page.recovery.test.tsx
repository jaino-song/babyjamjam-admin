/**
 * /contracts?recoverJobId=<id> opens iframe recovery once and clears the parameter.
 * Closing recovery preserves a creation session. Its bridge lifecycle has separate tests.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { EformsignDocument } from "@/lib/eformsign/types";
import { eformsignApi } from "@/services/api";
import { useFormStore } from "@/stores/form-store";

import ContractsPage from "./page";
import { eformsignApi as manualApi } from "@/services/eformsign";
jest.mock("@/services/eformsign", () => ({ eformsignApi: { openDocumentJobRecovery: jest.fn(), verifyDocumentJobRecovery: jest.fn() } }));

const PROCESSING_STEP = 4;

let mockParams = new URLSearchParams();
const mockReplace = jest.fn(() => {
  mockParams = new URLSearchParams();
});
let mockMountCount = 0;
let mockDocuments: EformsignDocument[] = [];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, refresh: jest.fn() }),
  useSearchParams: () => mockParams,
  usePathname: () => '/contracts',
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
    documents: mockDocuments,
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
    getDocument: jest.fn(),
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

const openRecovery = manualApi.openDocumentJobRecovery as jest.Mock;

const targetDocument: EformsignDocument = {
  id: "doc-1", document_name: "복구 대상 계약서", document_number: "1",
  created_date: 100, updated_date: 100,
  template: { id: "template", name: "Contract" },
  creator: { recipient_type: "01", name: "Test" },
  last_editor: { recipient_type: "01", name: "Test" },
  current_status: {
    status_type: "003", status_doc_type: "", status_doc_detail: "",
    step_type: "", step_index: "", step_name: "", step_recipients: [],
    step_group: 0, expired_date: 0, _expired: false,
  },
  fields: [], next_status: [], previous_status: [], histories: [],
  recipients: [], detail_template_info: [],
};


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



describe("ContractsPage iframe recovery entry", () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockParams = new URLSearchParams(); mockMountCount = 0; mockDocuments = [targetDocument];
    useFormStore.getState().resetAll();
    (eformsignApi.getDocument as jest.Mock).mockResolvedValue(targetDocument);
    openRecovery.mockResolvedValue({ kind: "editable", document: { companyId: "company-abc", templateId: "template_ABC", documentId: "document012" }, jobId: "11111111-1111-4111-8111-111111111111", claimEpoch: "42", claimExpiresAt: new Date(Date.now() + 60000).toISOString() });
  });
  it("opens the iframe presentation once, clears the URL, and never claims or resolves through legacy methods", async () => {
    mockParams = new URLSearchParams("recoverJobId=11111111-1111-4111-8111-111111111111"); renderPage();
    await screen.findByText("전자문서 수동 전송");
    expect(mockReplace).toHaveBeenCalledWith("/contracts", { scroll: false });
    expect(openRecovery).toHaveBeenCalledTimes(1);
    expect(openRecovery).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("전자문서 수동 전송")).not.toBeInTheDocument());
    expect(eformsignApi.claimDocumentJobRecovery).not.toHaveBeenCalled();
    expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
    expect(openRecovery).toHaveBeenCalledTimes(1);
  });
  it("does not open without a recovery parameter", () => { renderPage(); expect(openRecovery).not.toHaveBeenCalled(); });
  it("preserves the mounted creation session, current step and values on recovery close", async () => {
    const page = renderPage(); fireEvent.click(sendButton()); fireEvent.click(screen.getByText("stub-begin-session"));
    useFormStore.getState().setName("김하늘"); const mountBefore = screen.getByTestId("stub-mount").textContent;
    page.followLink("recoverJobId=11111111-1111-4111-8111-111111111111");
    await screen.findByText("전자문서 수동 전송"); fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(stubStep()).toBe(String(PROCESSING_STEP)); expect(screen.getByTestId("stub-mount").textContent).toBe(mountBefore);
    expect(useFormStore.getState().name).toBe("김하늘");
  });
});
