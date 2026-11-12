/**
 * /contracts?recoverJobId=<id> opens iframe recovery once and clears the parameter.
 * Closing recovery preserves a creation session. Its bridge lifecycle has separate tests.
 */
import { makeJob, makeJobList } from "@/features/document-jobs/testing/jobs-test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";
import type { ClientFormDialogProps } from "@/components/app/clients/ClientFormDialog";
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
let mockIsAuthenticated = false;
let mockClientCandidate: EformsignContractClientCandidateResponse | undefined;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, refresh: jest.fn() }),
  useSearchParams: () => mockParams,
  usePathname: () => '/contracts',
}));

jest.mock("@/hooks/useBusinessDayCalendar", () => ({
  useBusinessDayCalendar: () => ({ calendar: undefined }),
}));
jest.mock("@/hooks/useEformsignAuth", () => ({
  useEformsignAuth: () => ({ isAuthenticated: mockIsAuthenticated, isLoading: false, error: null }),
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
  useContractClientCandidate: (documentId: string | null) => ({
    data: documentId === mockClientCandidate?.documentId ? mockClientCandidate : undefined,
    isSuccess: documentId !== null && documentId === mockClientCandidate?.documentId,
    isError: false,
  }),
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
    getDocumentJobs: jest.fn(),
    claimDocumentJobRecovery: jest.fn(),
    resolveDocumentJob: jest.fn(),
    getDocument: jest.fn(),
  },
  withEformsignReauth: jest.fn(),
}));

jest.mock("@/components/app/clients/ClientFormDialog", () => ({
  ClientFormDialog: ({ open, prefill, "data-component": dataComponent }: ClientFormDialogProps) => (
    open ? <div role="dialog" aria-label="고객 등록" data-component={dataComponent}>{prefill?.name}</div> : null
  ),
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
    mockIsAuthenticated = false;
    mockClientCandidate = undefined;
    useFormStore.getState().resetAll();
    (eformsignApi.getDocument as jest.Mock).mockResolvedValue(targetDocument);
    (eformsignApi.getDocumentJobs as jest.Mock).mockResolvedValue(makeJobList({ requiresAttention: [makeJob({ jobId: "11111111-1111-4111-8111-111111111111", recoveryPresentation: "iframe" })] }));
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
  it.each(["finalize_document", "create_document"] as const)("routes requires_attention %s through legacy resolve without automatic resend", async jobType => {
    const job = makeJob({ jobId: "legacy-job", jobType, status: "requires_attention", recoveryKind: "verify_result", recoveryPresentation: "legacy", documentId: "doc-1" });
    (eformsignApi.getDocumentJobs as jest.Mock).mockResolvedValue(makeJobList({ requiresAttention: [job] }));
    (eformsignApi.claimDocumentJobRecovery as jest.Mock).mockResolvedValue({ job, recoveryKind: "verify_result", payload: null, claimExpiresAt: null });
    (eformsignApi.resolveDocumentJob as jest.Mock).mockResolvedValue({ job: { ...job, recoveryKind: null, recoveryPresentation: null }, alreadyResolved: false });
    mockParams = new URLSearchParams("recoverJobId=legacy-job"); renderPage();
    await screen.findByText("전자문서 결과 확인 필요");
    expect(openRecovery).not.toHaveBeenCalled();
    expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
    if (jobType === "finalize_document") {
      expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "계약서 보기" })).toBeEnabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "처리됨으로 표시" }));
    fireEvent.click(await screen.findByRole("button", { name: "처리됨으로 표시", hidden: false }));
    await waitFor(() => expect(eformsignApi.resolveDocumentJob).toHaveBeenCalledWith("legacy-job"));
    await waitFor(() => expect(screen.queryByText("전자문서 결과 확인 필요")).not.toBeInTheDocument());
    expect(screen.queryByTestId("stub-step")).not.toBeInTheDocument();
  });

  it("resolves a failed finalize before opening its contract, with no draft or iframe", async () => {
    const job = makeJob({ jobId: "finalize-job", jobType: "finalize_document", recoveryPresentation: "legacy", documentId: "doc-1" });
    (eformsignApi.getDocumentJobs as jest.Mock).mockResolvedValue(makeJobList({ requiresAttention: [job] }));
    (eformsignApi.claimDocumentJobRecovery as jest.Mock).mockResolvedValue({ job, recoveryKind: "manual_send", payload: { documentId: "doc-1" }, claimExpiresAt: null });
    let finish!: () => void;
    (eformsignApi.resolveDocumentJob as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = () => resolve({ job, alreadyResolved: false }); }));
    mockParams = new URLSearchParams("recoverJobId=finalize-job"); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "처리됨으로 표시하고 계약서 열기" }));
    expect(screen.queryByTestId("stub-step")).not.toBeInTheDocument();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "전자문서 작업 복구" })).not.toBeInTheDocument());
    expect(document.querySelector('[data-component^="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document"]')).toBeInTheDocument();
    expect(openRecovery).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stub-step")).not.toBeInTheDocument();
  });

  it("closes candidate registration and opens the requested document through legacy recovery", async () => {
    const candidateDocument = { ...targetDocument, id: "candidate-doc", document_name: "등록 후보 계약서" };
    mockDocuments = [candidateDocument, targetDocument];
    mockIsAuthenticated = true;
    mockClientCandidate = {
      documentId: candidateDocument.id, extracted: true, name: "등록 후보 고객",
      phone: null, address: null, birthday: null, dueDate: null, startDate: null, endDate: null,
      primaryEmployeeId: null, secondaryEmployeeId: null, type: null, duration: null,
      fullPrice: null, grant: null, actualPrice: null, careCenter: null,
      voucherClient: false, breastPump: false,
    };
    const job = makeJob({ jobId: "legacy-job", jobType: "finalize_document", status: "requires_attention", recoveryKind: "verify_result", recoveryPresentation: "legacy", documentId: targetDocument.id });
    (eformsignApi.getDocumentJobs as jest.Mock).mockResolvedValue(makeJobList({ requiresAttention: [job] }));
    (eformsignApi.claimDocumentJobRecovery as jest.Mock).mockResolvedValue({ job, recoveryKind: "verify_result", payload: null, claimExpiresAt: null });
    (eformsignApi.getDocument as jest.Mock).mockImplementation((documentId: string) => Promise.resolve(
      documentId === candidateDocument.id ? candidateDocument : targetDocument,
    ));
    const page = renderPage();
    fireEvent.click(await screen.findByText(candidateDocument.document_name));
    fireEvent.keyDown(await screen.findByRole("button", { name: "계약 작업 더보기" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "고객 등록" }));
    expect(await screen.findByRole("dialog", { name: "고객 등록" })).toHaveTextContent("등록 후보 고객");

    page.followLink("recoverJobId=legacy-job");
    fireEvent.click(await screen.findByRole("button", { name: "계약서 보기" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "고객 등록" })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "전자문서 결과 확인 필요" })).not.toBeInTheDocument();
    const detail = document.querySelector<HTMLElement>('[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document"]');
    expect(detail).toBeInTheDocument();
    if (!detail) throw new Error("Expected the recovered contract detail panel");
    expect(within(detail).getByText(targetDocument.document_name)).toBeVisible();
    expect(within(detail).queryByText(candidateDocument.document_name)).not.toBeInTheDocument();
    expect(openRecovery).not.toHaveBeenCalled();
    expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
  });

  it("waits for deep-link metadata before selecting the iframe", async () => {
    let finish!: (value: ReturnType<typeof makeJobList>) => void;
    (eformsignApi.getDocumentJobs as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    mockParams = new URLSearchParams("recoverJobId=11111111-1111-4111-8111-111111111111"); renderPage();
    expect(screen.getByRole("status", { name: "작업 불러오는 중" })).toBeInTheDocument();
    expect(openRecovery).not.toHaveBeenCalled(); expect(eformsignApi.claimDocumentJobRecovery).not.toHaveBeenCalled();
    await act(async () => finish(makeJobList({ requiresAttention: [makeJob({ jobId: "11111111-1111-4111-8111-111111111111", status: "requires_attention", recoveryKind: "verify_result", recoveryPresentation: "iframe" })] })));
    const frame = await screen.findByTitle<HTMLIFrameElement>("이폼사인 수동 전송");
    jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(openRecovery).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null] as const)("does not infer a create generation from missing/null presentation %s", async recoveryPresentation => {
    const job = makeJob({ jobId: "unknown-create", recoveryPresentation });
    (eformsignApi.getDocumentJobs as jest.Mock).mockResolvedValue(makeJobList({ requiresAttention: [job] }));
    mockParams = new URLSearchParams("recoverJobId=unknown-create"); renderPage();
    await screen.findByText(recoveryPresentation === undefined ? "작업을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." : "이미 처리됐거나 찾을 수 없는 작업이에요.");
    expect(openRecovery).not.toHaveBeenCalled(); expect(eformsignApi.claimDocumentJobRecovery).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
  });

  it("keeps an unknown deep link safe when the list does not contain it", async () => {
    (eformsignApi.getDocumentJobs as jest.Mock).mockResolvedValue(makeJobList());
    mockParams = new URLSearchParams("recoverJobId=missing-job"); renderPage();
    await screen.findByText("작업을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    expect(openRecovery).not.toHaveBeenCalled(); expect(eformsignApi.claimDocumentJobRecovery).not.toHaveBeenCalled();
  });

  it("opens a legacy finalize document from an older server without a presentation field", async () => {
    const job = makeJob({ jobId: "old-finalize", jobType: "finalize_document", recoveryPresentation: undefined, status: "requires_attention", recoveryKind: "verify_result", documentId: "doc-1" });
    (eformsignApi.getDocumentJobs as jest.Mock).mockResolvedValue(makeJobList({ requiresAttention: [job] }));
    (eformsignApi.claimDocumentJobRecovery as jest.Mock).mockResolvedValue({ job, recoveryKind: "verify_result", payload: null, claimExpiresAt: null });
    mockParams = new URLSearchParams("recoverJobId=old-finalize"); renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "계약서 보기" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "전자문서 결과 확인 필요" })).not.toBeInTheDocument());
    expect(document.querySelector('[data-component^="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document"]')).toBeInTheDocument();
    expect(openRecovery).not.toHaveBeenCalled(); expect(eformsignApi.resolveDocumentJob).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stub-step")).not.toBeInTheDocument();
  });

});
