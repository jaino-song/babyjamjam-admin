/**
 * "계약서 보기" in the failed-job recovery dialog must not discard an ordinary editing draft.
 * Real page + real ContractCreationForm (no stub): the form reports a creation *session* only
 * while it is processing, so an earlier-step draft has to stay mounted — hidden — on its own,
 * with its component-local state, and be reachable again from the page.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { EformsignDocument } from "@/lib/eformsign/types";
import { eformsignApi } from "@/services/api";
import { useFormStore } from "@/stores/form-store";

import ContractsPage from "./page";

let mockParams = new URLSearchParams();
const mockReplace = jest.fn(() => {
  mockParams = new URLSearchParams();
});
let mockDocuments: EformsignDocument[] = [];

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

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { phone: "010-1234-5678" } }),
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAllClients: () => ({ data: [], isLoading: false }),
}));
jest.mock("@/hooks/useEmployees", () => ({
  ...jest.requireActual("@/hooks/useEmployees"),
  useEmployees: () => ({ data: [], isLoading: false }),
  useCreateEmployee: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAreaTemplates: () => ({
    data: [{ id: "at-1", areaId: "Namdonggu", templateId: "t-1", templateName: "남동구 산모 계약서" }],
    isLoading: false,
  }),
}));
jest.mock("@/lib/sse/reconnecting-event-source", () => ({
  createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const claim = eformsignApi.claimDocumentJobRecovery as jest.Mock;

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
const DETAIL_SELECTOR =
  '[data-component^="desktop_contracts_sections_section-content_maternity-section_split-layout_detail-panel-document"]';

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


const FORM_SELECTOR = '[data-component="desktop_contracts_creation_form"]';
const SESSION_WRAPPER_SELECTOR =
  '[data-component="desktop_contracts_sections_section-content_maternity-section_split-layout_creation-session"]';
const dueDateInput = () => document.getElementById("contract-creation-due-date") as HTMLInputElement;

// Types into a component-local field (the due date is held in the form's own state, not the
// store), then fills the required step-1 fields and advances to the 제공인력 step.
async function startDraftOnEmployeeStep() {
  fireEvent.click(sendButton());
  fireEvent.change(dueDateInput(), { target: { value: "2026-11-20" } });
  act(() => {
    useFormStore.getState().setName("김하늘");
    useFormStore.getState().setPhone("010-1234-5678");
    useFormStore.getState().setArea("Namdonggu");
  });
  const next = await screen.findByTestId("contract-creation-next");
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  await waitFor(() => expect(dueDateInput()).not.toBeInTheDocument());
}

describe("ContractsPage recovery dialog with an ordinary (non-processing) creation draft", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = new URLSearchParams();
    mockDocuments = [targetDocument];
    useFormStore.getState().resetAll();
    (eformsignApi.getDocument as jest.Mock).mockResolvedValue(targetDocument);
    claim.mockResolvedValue(verifyResultClaim());
  });

  it("keeps the draft form mounted, hidden, and returns to the same step and typed value", async () => {
    const page = renderPage();
    await startDraftOnEmployeeStep();
    const formBefore = document.querySelector(FORM_SELECTOR);
    expect(formBefore).not.toBeNull();
    expect(document.querySelector(DETAIL_SELECTOR)).not.toBeInTheDocument();

    page.followLink("recoverJobId=j1");
    await screen.findByText("전자문서 결과 확인 필요");
    fireEvent.click(await screen.findByRole("button", { name: "계약서 보기" }));

    await waitFor(() => expect(document.querySelector(DETAIL_SELECTOR)).toBeInTheDocument());
    // The very same form element is still in the DOM, inside the hidden wrapper.
    expect(document.querySelector(FORM_SELECTOR)).toBe(formBefore);
    expect(document.querySelector(SESSION_WRAPPER_SELECTOR)).toHaveClass("hidden");

    // Back to the form through the page's own entry point: same step, nothing lost.
    fireEvent.click(sendButton());
    await waitFor(() => expect(document.querySelector(DETAIL_SELECTOR)).not.toBeInTheDocument());
    expect(document.querySelector(FORM_SELECTOR)).toBe(formBefore);
    expect(document.querySelector(SESSION_WRAPPER_SELECTOR)).not.toHaveClass("hidden");
    expect(dueDateInput()).not.toBeInTheDocument(); // still on the employee step, not reset to step 1
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await waitFor(() => expect(dueDateInput()).toBeInTheDocument());
    expect(dueDateInput().value).toBe("2026-11-20");
    expect(useFormStore.getState().name).toBe("김하늘");
  });

  it("shows the document and mounts no form when no creation form is open", async () => {
    mockParams = new URLSearchParams("recoverJobId=j1");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "계약서 보기" }));

    await waitFor(() => expect(document.querySelector(DETAIL_SELECTOR)).toBeInTheDocument());
    expect(document.querySelector(FORM_SELECTOR)).not.toBeInTheDocument();
    expect(document.querySelector(SESSION_WRAPPER_SELECTOR)).not.toBeInTheDocument();
  });
});
