import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import {
  INITIAL_DOCUMENT_RECOVERY_COPY as copy,
} from "@/features/document-jobs/service-record-recovery-copy";
import { createTestQueryClient, makeJobList, makeSummary, setBranchCookie } from "@/features/document-jobs/testing/jobs-test-utils";
import { useEformsignDocumentJobs } from "@/hooks/useEformsignDocumentJobs";
import { api } from "@/lib/api/client";
import { INITIAL_DOCUMENT_STATE_CODES as state } from "@/lib/eformsign/initial-document-recovery-contract";
import { eformsignApi } from "@/services/eformsign";

import { ContractDocumentJobsPopover } from "./ContractDocumentJobsPopover";

jest.mock("next/navigation", () => ({ usePathname: () => "/contracts", useRouter: () => ({ push: jest.fn() }) }));

const target = {
  stateId: "22222222-2222-4222-8222-222222222222",
  revisionId: "11111111-1111-4111-8111-111111111111",
  generation: "generation-1",
};
const confirmation = { ...target, suffix: "[SR-12abcdef-r2-v3]", unlinkedChunkOrdinals: ["(2/3)", "(3/3)"] };
const ready = { ...target, clientId: 24, ready: true, reasonCode: null };
const request = { documentStateId: target.stateId, revisionId: target.revisionId, expectedGeneration: target.generation };

function LiveJobs() {
  const query = useEformsignDocumentJobs({ isPopoverOpen: true });
  return <ContractDocumentJobsPopover defaultOpen documentJobs={query.data} isLoading={query.isLoading}
    summary={query.summary} data-component="desktop_contracts_test_jobs" />;
}

function setup(data: ReturnType<typeof makeJobList>) {
  const fetchJobs = jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(data);
  jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());
  render(<QueryClientProvider client={createTestQueryClient()}><LiveJobs /></QueryClientProvider>);
  return fetchJobs;
}

async function openDetail() {
  fireEvent.click(await screen.findByRole("button", { name: /복구 상태 보기/ }));
}

async function approve(label: string, title: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const dialog = await screen.findByRole("dialog", { name: title });
  return { dialog, approve: within(dialog).getByRole("button", { name: label }) };
}

function conflict(reason: string) {
  return { isAxiosError: true, response: { status: 409, data: { code: "REQUEST_CONFLICT", reason } } };
}

beforeEach(() => { setBranchCookie("branch-a"); });
afterEach(() => { setBranchCookie(null); jest.restoreAllMocks(); });

it("shows neither action for a branch without a recovery projection", async () => {
  setup(makeJobList());
  await screen.findByText("처리중인 전자문서가 없습니다.");
  expect(screen.queryByText("제공기록지 복구")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: copy.regenerateLabel })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: copy.confirmLabel })).not.toBeInTheDocument();
});

it.each([
  [state.siblingInProgress, "일부 문서가 아직 진행 중이에요."],
  [state.siblingCompleted, "일부 문서가 이미 완료됨 · 관리자 문의"],
  [state.completedDocumentDeleted, "일부 문서가 이미 완료됨 · 관리자 문의"],
  [state.deletedStatusUnknown, "삭제된 문서의 완료 여부를 확인할 수 없음 · 관리자 문의"],
])("shows the %s reason and keeps unsafe actions hidden", async (reasonCode, message) => {
  setup(makeJobList({ initialRegenerations: [{ ...ready, ready: false, reasonCode }] }));
  await openDetail();
  expect(screen.getByText(message, { exact: false })).toHaveAttribute("data-slot", "initial-document-readiness");
  expect(screen.queryByRole("button", { name: copy.regenerateLabel })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: copy.confirmLabel })).not.toBeInTheDocument();
  expect(screen.queryByText(/삭제해 주세요/)).not.toBeInTheDocument();
});

it("asks for approval before regenerating and refreshes the jobs afterwards", async () => {
  const fetchJobs = setup(makeJobList({ initialRegenerations: [ready] }));
  const post = jest.spyOn(api, "post").mockImplementation(async () => {
    fetchJobs.mockResolvedValue(makeJobList());
    return { data: {} };
  });
  await openDetail();
  const { dialog, approve: button } = await approve(copy.regenerateLabel, copy.regenerateTitle);
  expect(dialog).toHaveTextContent(copy.regenerateDescription);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: copy.regenerateTitle })).not.toBeInTheDocument());
  expect(post).toHaveBeenCalledWith("/eformsign-docs/jobs/regenerate-initial", request);
  expect(screen.queryByRole("button", { name: copy.regenerateLabel })).not.toBeInTheDocument();
});

it.each([
  [state.siblingInProgress, "일부 문서가 아직 진행 중이에요."],
  [state.siblingCompleted, "일부 문서가 이미 완료됨 · 관리자 문의"],
  [state.deletedStatusUnknown, "삭제된 문서의 완료 여부를 확인할 수 없음 · 관리자 문의"],
])("renders the regenerate 409 reason %s inside the confirmation", async (reason, message) => {
  setup(makeJobList({ initialRegenerations: [ready] }));
  jest.spyOn(api, "post").mockRejectedValue(conflict(reason));
  await openDetail();
  const { dialog, approve: button } = await approve(copy.regenerateLabel, copy.regenerateTitle);
  fireEvent.click(button);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
});

it.each([
  [null, null],
  [state.siblingInProgress, "일부 문서가 아직 진행 중이에요."],
  [state.siblingCompleted, "일부 문서가 이미 완료됨 · 관리자 문의"],
  [state.deletedStatusUnknown, "삭제된 문서의 완료 여부를 확인할 수 없음 · 관리자 문의"],
])("uses new readiness %s following the provider check", async (reasonCode, message) => {
  const fetchJobs = setup(makeJobList({ noProviderDocumentConfirmable: [confirmation] }));
  const post = jest.spyOn(api, "post").mockImplementation(async () => {
    fetchJobs.mockResolvedValue(makeJobList({ initialRegenerations: [{ ...ready, ready: !reasonCode, reasonCode }] }));
    return { data: {} };
  });
  await openDetail();
  expect(screen.queryByRole("button", { name: copy.regenerateLabel })).not.toBeInTheDocument();
  const { dialog, approve: button } = await approve(copy.confirmLabel, copy.confirmTitle);
  expect(dialog).toHaveTextContent(confirmation.suffix);
  expect(dialog).toHaveTextContent("(2/3), (3/3)");
  expect(dialog).toHaveTextContent(/진행중, 완료, 반려\/취소/);
  expect(dialog).toHaveTextContent(/서버가 이폼사인을 다시 조회/);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: copy.confirmTitle })).not.toBeInTheDocument());
  expect(post).toHaveBeenCalledWith("/eformsign-docs/jobs/confirm-no-provider-document", request, { timeout: 180_000, _retry: true });
  expect(screen.queryByRole("button", { name: copy.confirmLabel })).not.toBeInTheDocument();
  if (message) {
    expect(screen.getByText(message, { exact: false })).toBeVisible();
    expect(screen.queryByRole("button", { name: copy.regenerateLabel })).not.toBeInTheDocument();
  } else {
    expect(screen.getByRole("button", { name: copy.regenerateLabel })).toBeVisible();
  }
});

it.each([
  ["NOT_ELIGIBLE", "현재 상태에서는 보낸 문서 없음을 확인할 수 없어요."],
  ["GENERATION_CHANGED", "대상 문서의 세대가 바뀌었어요."],
  ["SETTLING", "전송 결과를 기다리고 있어요."],
  ["VENDOR_CHECK_IN_PROGRESS", "다른 요청에서 이폼사인을 확인하고 있어요."],
  ["VENDOR_CHECK_INCOMPLETE", "이폼사인 목록을 모두 확인하지 못했어요."],
  ["PROVIDER_DOCUMENT_FOUND", "이폼사인에서 보낸 문서를 찾았어요."],
  ["LEFT_TO_PROVIDER_RECOVERY", "모든 문서 조각이 이미 연결됐어요."],
  ["STATE_CHANGED", "확인하는 동안 문서 상태가 바뀌었어요."],
  ["NOT_READY_AFTER_OUTCOME", "재생성에 필요한 상태를 확인하지 못했어요."],
])("renders provider-check conflict %s without offering regeneration", async (reason, message) => {
  setup(makeJobList({ noProviderDocumentConfirmable: [{ ...confirmation, unlinkedChunkOrdinals: [] }] }));
  jest.spyOn(api, "post").mockRejectedValue(conflict(`SERVICE_RECORD_INITIAL_NO_DOC_${reason}`));
  await openDetail();
  const { dialog, approve: button } = await approve(copy.confirmLabel, copy.confirmTitle);
  expect(dialog).toHaveTextContent(copy.confirmEmptyOrdinals);
  fireEvent.click(button);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
  expect(screen.queryByRole("button", { name: copy.regenerateLabel })).not.toBeInTheDocument();
});

it("keeps the phone sheet open and prevents duplicate confirmation submissions while pending", async () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  try {
    const fetchJobs = setup(makeJobList({ noProviderDocumentConfirmable: [confirmation] }));
    let finish = () => {};
    const post = jest.spyOn(api, "post").mockImplementation(() => new Promise(resolve => {
      finish = () => {
        fetchJobs.mockResolvedValue(makeJobList({ initialRegenerations: [ready] }));
        resolve({ data: {} });
      };
    }));
    await openDetail();
    const { dialog, approve: button } = await approve(copy.confirmLabel, copy.confirmTitle);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole("button", { name: "닫기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "처리 중" })).toHaveAttribute("aria-busy", "true");
    finish();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "전자문서 작업" })).toBeVisible();
    expect(screen.getByRole("button", { name: copy.regenerateLabel })).toBeVisible();
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  }
});

it("withholds confirmation when the active branch changes before approval", async () => {
  setup(makeJobList({ noProviderDocumentConfirmable: [confirmation] }));
  const post = jest.spyOn(api, "post").mockResolvedValue({ data: {} });
  await openDetail();
  const { dialog, approve: button } = await approve(copy.confirmLabel, copy.confirmTitle);
  setBranchCookie("branch-b");
  fireEvent.click(button);
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(post).not.toHaveBeenCalled();
});
