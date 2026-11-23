import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { INITIAL_DOCUMENT_RECOVERY_COPY as copy } from "@/features/document-jobs/service-record-recovery-copy";
import { createTestQueryClient, makeSummary, setBranchCookie } from "@/features/document-jobs/testing/jobs-test-utils";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import { useClientServiceRecordRevisionHistory } from "@/features/service-records/hooks/use-service-records";
import type { ServiceRecordRevisionDocumentSummary } from "@/features/service-records/types";
import { api } from "@/lib/api/client";
import { INITIAL_DOCUMENT_STATE_CODES as state } from "@/lib/eformsign/initial-document-recovery-contract";
import type { EformsignDocumentJobSummary } from "@/services/eformsign";

import { ClientServiceRecordsTab } from "../ClientServiceRecordsTab";

let mockSummary: EformsignDocumentJobSummary | undefined;
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
  useDocumentJobs: () => ({ summary: mockSummary }),
}));
jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { role: "user", branchRole: "manager" } }),
}));
jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

const revisionId = "11111111-1111-4111-8111-111111111111";
const documentStateId = "22222222-2222-4222-8222-222222222222";
const generation = "generation-1";
const confirmation = {
  stateId: documentStateId, revisionId, generation, suffix: "[SR-12abcdef-r1-v2]", unlinkedChunkOrdinals: ["(2/2)"],
};
const document: ServiceRecordRevisionDocumentSummary = {
  id: documentStateId, operation: "record_snapshot", status: "failed", generation,
  documentVersion: 2, canRetry: false, reasonCode: state.noProviderDocument,
};
const history = (value: ServiceRecordRevisionDocumentSummary) => ({
  caseId: "case-a", caseVersion: 3, currentRevisionId: revisionId, currentUsableRevisionId: null,
  revisions: [{
    id: revisionId, revisionNumber: 1, confirmedAt: "2026-09-08T01:02:03.000Z", isCurrent: true,
    documents: [value],
  }],
});
const path = `/admin/service-records/revisions/${revisionId}/documents/${documentStateId}`;

function LiveTab() {
  const query = useClientServiceRecordRevisionHistory(42);
  return <ClientServiceRecordsTab data-component="desktop_clients-detail_panel_service-records"
    clientId={42} isError={false} isLoading={false} revisionHistory={query.data}
    isRevisionHistoryLoading={query.isPending} onRetryRevisionDocument={jest.fn()} />;
}

function setup(override: Partial<ServiceRecordRevisionDocumentSummary> = {}) {
  const get = jest.spyOn(api, "get").mockResolvedValue({ data: history({ ...document, ...override }) });
  const queryClient = createTestQueryClient();
  render(<QueryClientProvider client={queryClient}><LiveTab /></QueryClientProvider>);
  return { get, queryClient };
}

beforeEach(() => { mockSummary = undefined; setBranchCookie("branch-a"); });
afterEach(() => { setBranchCookie(null); jest.restoreAllMocks(); });

it.each([
  [state.noProviderDocument, "이폼사인에 보낸 문서가 없음을 확인했어요."],
  [state.partialDispatch, "일부 문서만 이폼사인에 전송됐어요."],
  [state.completedDocumentDeleted, "완료된 문서가 삭제됐어요."],
  [state.deletedStatusUnknown, "삭제된 문서의 완료 여부를 확인할 수 없어요."],
])("labels %s and hides retry when canRetry is false", async (reasonCode, label) => {
  setup({ reasonCode });
  expect(await screen.findByText(label)).toBeVisible();
  expect(screen.queryByRole("button", { name: copy.regenerateLabel })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: copy.confirmLabel })).not.toBeInTheDocument();
  if (reasonCode === state.completedDocumentDeleted || reasonCode === state.deletedStatusUnknown) {
    expect(screen.getByText(/관리자 문의/)).toBeVisible();
    expect(screen.queryByText(/삭제해 주세요/)).not.toBeInTheDocument();
  }
});

it.each([state.rejected, state.voided, state.noProviderDocument, state.partialDispatch])(
  "labels retryable INITIAL %s as regeneration and uses the admin retry endpoint after approval",
  async reasonCode => {
    setup({ reasonCode, canRetry: true });
    const post = jest.spyOn(api, "post").mockResolvedValue({ data: document });
    const button = await screen.findByRole("button", { name: copy.regenerateLabel });
    expect(button).toHaveAttribute("data-slot", "revision-document-retry");
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: copy.regenerateTitle });
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: copy.regenerateLabel }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`${path}/retry`, { expectedGeneration: generation }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
);

it.each([
  [state.siblingInProgress, "일부 문서가 아직 진행 중이에요."],
  [state.siblingCompleted, "일부 문서가 이미 완료됨 · 관리자 문의"],
  [state.completedDocumentDeleted, "일부 문서가 이미 완료됨 · 관리자 문의"],
  [state.deletedStatusUnknown, "삭제된 문서의 완료 여부를 확인할 수 없음 · 관리자 문의"],
  [state.jobInProgress, "문서 생성 작업이 아직 진행 중이에요."],
])("renders the admin retry 409 reason %s in the regeneration dialog", async (reason, message) => {
  setup({ canRetry: true });
  const post = jest.spyOn(api, "post").mockRejectedValue({
    isAxiosError: true,
    response: { status: 409, data: { code: "REQUEST_CONFLICT", reason } },
  });

  fireEvent.click(await screen.findByRole("button", { name: copy.regenerateLabel }));
  const dialog = await screen.findByRole("dialog", { name: copy.regenerateTitle });
  fireEvent.click(within(dialog).getByRole("button", { name: copy.regenerateLabel }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
  expect(post).toHaveBeenCalledWith(`${path}/retry`, { expectedGeneration: generation });
});

it.each([
  {
    label: copy.regenerateLabel,
    title: copy.regenerateTitle,
    initial: { ...document, canRetry: true },
    next: document,
  },
  {
    label: copy.confirmLabel,
    title: copy.confirmTitle,
    initial: { ...document, noProviderDocumentConfirmable: confirmation },
    next: { ...document, generation: "generation-2",
      noProviderDocumentConfirmable: { ...confirmation, generation: "generation-2" } },
  },
])("blocks $label when refreshed revision history invalidates the open dialog", async ({ label, title, initial, next }) => {
  const { get, queryClient } = setup(initial);
  const post = jest.spyOn(api, "post").mockResolvedValue({ data: document });

  fireEvent.click(await screen.findByRole("button", { name: label }));
  const dialog = await screen.findByRole("dialog", { name: title });
  const approve = within(dialog).getByRole("button", { name: label });
  expect(approve).toBeEnabled();

  get.mockResolvedValue({ data: history(next) });
  await act(() => queryClient.invalidateQueries({ queryKey: serviceRecordKeys.revisionHistory(42) }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(copy.unavailable);
  expect(approve).toBeDisabled();
  fireEvent.click(approve);
  expect(post).not.toHaveBeenCalled();
});

it("preserves a matched confirmation projection and re-reads canRetry after confirmation", async () => {
  const { get } = setup({ status: "manual_review", reasonCode: null, noProviderDocumentConfirmable: confirmation });
  const post = jest.spyOn(api, "post").mockImplementation(async () => {
    get.mockResolvedValue({ data: history({ ...document, canRetry: true }) });
    return { data: {} };
  });

  fireEvent.click(await screen.findByRole("button", { name: copy.confirmLabel }));
  const dialog = await screen.findByRole("dialog", { name: copy.confirmTitle });
  expect(dialog).toHaveTextContent(confirmation.suffix);
  expect(dialog).toHaveTextContent("(2/2)");
  expect(dialog).toHaveTextContent(/진행중, 완료, 반려\/취소/);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: copy.confirmLabel }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(post).toHaveBeenCalledWith(`${path}/confirm-no-provider-document`, { expectedGeneration: generation }, { timeout: 180_000, _retry: true });
  expect(screen.getByRole("button", { name: copy.regenerateLabel })).toBeVisible();
  expect(screen.queryByRole("button", { name: copy.confirmLabel })).not.toBeInTheDocument();
});

it("uses the exact projected readiness for a partially dispatched state", async () => {
  mockSummary = makeSummary({
    initialRegenerations: [
      { ...confirmation, generation: "older", clientId: 42, ready: false, reasonCode: state.siblingInProgress },
      { ...confirmation, clientId: 42, ready: false, reasonCode: state.siblingCompleted },
    ],
  });
  setup({ reasonCode: state.partialDispatch });
  expect(await screen.findByText("일부 문서가 이미 완료됨 · 관리자 문의")).toBeVisible();
  expect(screen.queryByText(/아직 진행 중/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: copy.regenerateLabel })).not.toBeInTheDocument();
});

it("ignores a confirm projection for a different revision", async () => {
  setup({ noProviderDocumentConfirmable: { ...confirmation, revisionId: confirmation.stateId } });
  await screen.findByText("이폼사인에 보낸 문서가 없음을 확인했어요.");
  expect(screen.queryByRole("button", { name: copy.confirmLabel })).not.toBeInTheDocument();
});
