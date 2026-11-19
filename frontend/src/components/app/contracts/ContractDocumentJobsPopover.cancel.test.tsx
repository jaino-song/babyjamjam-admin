import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient, makeJob, makeJobList, makeSummary, setBranchCookie } from "@/features/document-jobs/testing/jobs-test-utils";
import { eformsignDocumentJobsQueryKeys, useEformsignDocumentJobs } from "@/hooks/useEformsignDocumentJobs";
import { api } from "@/lib/api/client";
import { eformsignApi } from "@/services/api";

import { ContractDocumentJobsPopover } from "./ContractDocumentJobsPopover";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ usePathname: () => "/contracts", useRouter: () => ({ push: mockPush }) }));
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const JOB = makeJob({ jobId: JOB_ID, status: "requires_attention", cancellable: true, recoveryKind: "manual_send", recoveryPresentation: "iframe" });
const BASE = "desktop_contracts_tests_jobs-popover";
const TITLE = "이 작업을 취소할까요?";
const onOpenChange = jest.fn();

function LiveJobs() {
  const query = useEformsignDocumentJobs({ isPopoverOpen: true });
  return <ContractDocumentJobsPopover defaultOpen documentJobs={query.data} isLoading={query.isLoading} onOpenChange={onOpenChange} data-component={BASE} />;
}

function setup() {
  const client = createTestQueryClient();
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const getJobs = jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList({ requiresAttention: [JOB] }));
  jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ unresolvedCount: 1, unresolvedJobIds: [JOB_ID] }));
  render(<QueryClientProvider client={client}><LiveJobs /></QueryClientProvider>);
  return { client, invalidate, getJobs };
}

async function openConfirmation() {
  const card = await screen.findByRole("button", { name: /김하늘.*상세 보기/ });
  fireEvent.click(card);
  const cancel = screen.getByRole("button", { name: "취소" });
  const panes = window.innerWidth < 1024 ? "body_panes" : "panes";
  expect(cancel).toHaveAttribute("data-component", `${BASE}_${panes}_slide_detail-pane_body_scroll_job_progress_cancel_button`);
  expect(cancel).toHaveAttribute("data-slot", "job-cancel-action");
  fireEvent.click(cancel);
  const dialog = await screen.findByRole("dialog", { name: TITLE });
  expect(dialog).toHaveTextContent("취소하면 이 고객의 전자문서 작업이 닫히고 새로 요청할 수 있어요. 아직 보낸 문서는 없어요.");
  expect(dialog).toHaveClass("z-[1010]");
  expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass("z-[1009]");
  expect(within(dialog).getByRole("button", { name: "작업 취소" })).toHaveAttribute("data-variant", "destructive");
  return { dialog, cancel };
}

describe.each([390, 1280])("document job cancel at %spx", width => {
  let originalWidth: number;
  beforeEach(() => {
    originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    setBranchCookie("branch-a");
    onOpenChange.mockClear(); mockPush.mockClear();
  });
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    setBranchCookie(null); jest.restoreAllMocks();
  });

  it.each(["cancelled", "already_cancelled"] as const)("confirms %s without dismissing the outer window, invalidates and returns focus to the list", async outcome => {
    const { invalidate, getJobs } = setup();
    let finish!: () => void;
    const post = jest.spyOn(api, "post").mockImplementation(() => new Promise(resolve => {
      finish = () => { getJobs.mockResolvedValue(makeJobList()); resolve({ data: { jobId: JOB_ID, outcome } }); };
    }));
    const { dialog } = await openConfirmation();
    expect(post).not.toHaveBeenCalled();
    const approve = within(dialog).getByRole("button", { name: "작업 취소" });
    // Real outside-pointer listeners must see the portalled approval before its click.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.pointerDown(approve); fireEvent.mouseDown(approve); fireEvent.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/eformsign-docs/jobs/${JOB_ID}/cancel`));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(document.querySelector('[data-slot="document-jobs-interaction"]')).toHaveAttribute("inert");
    expect(within(dialog).getByRole("button", { name: "닫기" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "처리 중" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: TITLE })).toBeInTheDocument();
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "전자문서 작업" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "false");
    await waitFor(() => expect(screen.getByRole("button", { name: "전자문서 작업 닫기" })).toHaveFocus());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: eformsignDocumentJobsQueryKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["eformsign-documents"] });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("returns through back() and restores card focus and scroll even when a refreshed row remains", async () => {
    setup();
    jest.spyOn(api, "post").mockResolvedValue({ data: { jobId: JOB_ID, outcome: "cancelled" } });
    const card = await screen.findByRole("button", { name: /김하늘.*상세 보기/ });
    const scroller = document.querySelector('[data-slot="document-jobs-list-scroller"]')!;
    scroller.scrollTop = 67;
    const { dialog } = await openConfirmation();
    scroller.scrollTop = 0;
    fireEvent.click(within(dialog).getByRole("button", { name: "작업 취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).not.toBeInTheDocument());
    await waitFor(() => expect(card).toHaveFocus());
    expect(scroller.scrollTop).toBe(67);
    expect(document.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "false");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it.each([
    [409, "JOB_NOT_CANCELLABLE", "이 작업은 지금 취소할 수 없어요. 새로고침 후 다시 확인해 주세요.", true],
    [409, "OTHER", "작업을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.", false],
    [500, "JOB_NOT_CANCELLABLE", "작업을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.", false],
  ] as const)("shows inline copy for %s/%s and refreshes only the known conflict", async (status, code, message, refresh) => {
    const { getJobs } = setup();
    const post = jest.spyOn(api, "post").mockRejectedValue({ isAxiosError: true, response: { status, data: { code, message: "private backend body" } } });
    const { dialog } = await openConfirmation();
    const callsBefore = getJobs.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "작업 취소" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "작업 취소" })).toBeEnabled());
    if (refresh) await waitFor(() => expect(getJobs.mock.calls.length).toBeGreaterThan(callsBefore));
    else expect(getJobs).toHaveBeenCalledTimes(callsBefore);
    expect(dialog).not.toHaveTextContent("private backend body");
    expect(post).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("dismisses the confirmation without cancelling or closing the outer window", async () => {
    setup();
    const post = jest.spyOn(api, "post");
    const { dialog, cancel } = await openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: TITLE })).not.toBeInTheDocument());
    expect(post).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(document.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "true");
  });
});
