import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Clock3 } from "lucide-react";
import { createRef } from "react";

import {
  createTestQueryClient,
  JobsTestWrapper,
  makeJob,
  makeJobList,
  makeSummary,
  setBranchCookie,
} from "@/features/document-jobs/testing/jobs-test-utils";
import { eformsignDocumentJobsQueryKeys } from "@/hooks/useEformsignDocumentJobs";
import { eformsignApi } from "@/services/api";

import {
  ContractDocumentJobsPopover,
  type ContractDocumentJobsData,
} from "./ContractDocumentJobsPopover";
import { ContractStatsBar } from "./ContractStatsBar";

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => mockToast(...args) }));
const mockPush = jest.fn();
let mockPathname = '/contracts';
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
}));

const PROCESSING_TILE = { name: "전자문서 처리중 작업 보기" };

const RECOVERY_JOB = { jobId: '11111111-1111-4111-8111-111111111111', jobType: 'create_document', source: 'staff', status: 'failed', recoveryKind: 'manual_send', clientName: '복구 고객' } as const;
test.each([390, 1280])('contracts recovery at %spx stays nested, pauses panes, and restores its CTA', async width => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  mockPathname = '/contracts';
  const open = jest.spyOn(eformsignApi, 'openDocumentJobRecovery').mockResolvedValue({ kind: 'editable', jobId: RECOVERY_JOB.jobId, claimEpoch: '42', claimExpiresAt: new Date(Date.now() + 60000).toISOString(), document: { companyId: 'company-abc', templateId: 'template_ABC', documentId: 'document012' } });
  const onOpenChange = jest.fn();
  renderOpenPopover({ documentJobs: { active: [], requiresAttention: [RECOVERY_JOB], recent: [] }, onOpenChange });
  fireEvent.click(screen.getByRole('button', { name: /복구 고객.*상세 보기/ }));
  const trigger = screen.getByRole('button', { name: '수동 전송' });
  const detail = document.querySelector('[data-slot="job-detail-body"]');
  const scroller = document.querySelector('[data-slot="document-jobs-list-scroller"]')!; scroller.scrollTop = 84;
  fireEvent.click(trigger);
  const frame = await screen.findByTitle<HTMLIFrameElement>('이폼사인 수동 전송');
  jest.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  expect(open).toHaveBeenCalledTimes(1); expect(mockPush).not.toHaveBeenCalled();
  expect(document.querySelector('[data-slot="document-jobs-interaction"]')).toHaveAttribute('inert');
  const inner = screen.getByRole('dialog', { name: '전자문서 수동 전송' });
  const check = screen.getByRole('button', { name: 'Close' });
  check.focus(); fireEvent.keyDown(check, { key: 'Tab' });
  expect(inner.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(check, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByText('전자문서 수동 전송')).not.toBeInTheDocument());
  expect(document.querySelector('[data-slot="job-detail-body"]')).toBe(detail);
  expect(document.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute('data-open', 'true');
  expect(scroller.scrollTop).toBe(84);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  open.mockRestore();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

test('recovery on other desktop routes closes jobs and navigates without opening an iframe', () => {
  mockPathname = '/clients'; mockPush.mockClear();
  const open = jest.spyOn(eformsignApi, 'openDocumentJobRecovery');
  const onOpenChange = jest.fn();
  renderOpenPopover({ documentJobs: { active: [], requiresAttention: [RECOVERY_JOB], recent: [] }, onOpenChange });
  fireEvent.click(screen.getByRole('button', { name: /복구 고객.*상세 보기/ }));
  fireEvent.click(screen.getByRole('button', { name: '수동 전송' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(mockPush).toHaveBeenCalledWith(`/contracts?recoverJobId=${RECOVERY_JOB.jobId}`);
  expect(open).not.toHaveBeenCalled(); open.mockRestore(); mockPathname = '/contracts';
});

const JOBS: ContractDocumentJobsData = {
  active: [
    {
      jobId: "job-active",
      jobType: "finalize_document",
      status: "processing",
      documentId: "document-1",
      progressStep: "creating",
      attempts: 1,
    },
  ],
  requiresAttention: [
    {
      jobId: "job-attention",
      jobType: "finalize_document",
      status: "requires_attention",
      documentId: "document-2",
      recoveryKind: "verify_result",
      attempts: 3,
    },
  ],
  recent: [
    {
      jobId: "job-recent",
      jobType: "create_document",
      status: "completed",
      documentId: "document-3",
      completedAt: "2026-08-13T01:00:00.000Z",
    },
  ],
};

function renderOpenPopover(overrides: Partial<React.ComponentProps<typeof ContractDocumentJobsPopover>> = {}) {
  return render(
    <ContractDocumentJobsPopover
      open
      summary={{ activeCount: 4, requiresAttentionCount: 1 }}
      documentJobs={JOBS}
      trigger={<button type="button">전자문서 처리중</button>}
      {...overrides}
    />,
  );
}

const STAT_ITEMS = Array.from({ length: 5 }, (_, index) => ({
  icon: Clock3,
  value: index + 1,
  label: `통계 ${index + 1}`,
  counter: "건",
}));

function renderBar(props: Partial<React.ComponentProps<typeof ContractStatsBar>> = {}) {
  const queryClient = createTestQueryClient();
  render(
    <JobsTestWrapper queryClient={queryClient}>
      <ContractStatsBar name="desktop_contracts" items={STAT_ITEMS} {...props} />
    </JobsTestWrapper>,
  );
  return queryClient;
}

describe("ContractDocumentJobsPopover", () => {
  beforeEach(() => {
    mockPathname = '/contracts'; mockPush.mockClear();
    setBranchCookie("branch-a");
    window.sessionStorage.clear();
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList());
  });

  afterEach(() => {
    setBranchCookie(null);
    jest.restoreAllMocks();
  });

  it("opens every desktop status in place and exposes document links only in detail", () => {
    renderOpenPopover();

    expect(screen.getByRole("button", { name: "처리중 1건" })).toBeInTheDocument();
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.getByText("최근 처리")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "최근 처리 1건" }));
    for (const status of ["처리중", "처리 실패", "완료"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`${status} 상세 보기$`) }));
      expect(document.querySelector('[data-slot="job-info-card"]')).toHaveTextContent(status);
      expect(screen.queryByRole("link", { name: "문서 보기" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "목록으로 돌아가기" }));
    }
  });

  it("uses customer-only titles and opens failed jobs without row recovery links", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [
          { jobId: "job f/1", jobType: "create_document", status: "failed", clientName: "김하늘", recoveryKind: "manual_send" },
          { jobId: "job-f2", jobType: "finalize_document", status: "failed", clientName: null, recoveryKind: "manual_send" },
        ],
        recent: [],
      },
    });

    expect(screen.getByText("김하늘")).toBeInTheDocument();
    expect(screen.getByText("고객 정보 확인 필요")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    expect(screen.getByRole("button", { name: "수동 전송" })).toBeEnabled();
    expect(screen.queryByText("연결된 문서가 없습니다")).not.toBeInTheDocument();
  });

  it("opens auto-finalize attention in detail before its secondary document link", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [
          {
            jobId: "job-auto",
            jobType: "finalize_document",
            source: "auto_finalize",
            status: "requires_attention",
            documentId: "document auto/1",
            recoveryKind: null,
          },
        ],
        recent: [],
      },
    });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /상세 보기$/ }));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("enables both staff recovery actions inside detail", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [
          { jobId: "job-m", jobType: "create_document", source: "staff", status: "failed", recoveryKind: "manual_send", documentId: "d-1" },
          { jobId: "job-v", jobType: "finalize_document", source: "staff", status: "requires_attention", recoveryKind: "verify_result", documentId: "d-2" },
        ],
        recent: [],
      },
    });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /상세 보기$/ })[0]);
    expect(screen.getByRole("button", { name: "수동 전송" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "목록으로 돌아가기" }));
    fireEvent.click(screen.getAllByRole("button", { name: /상세 보기$/ })[1]);
    expect(screen.getByRole("button", { name: "결과 확인" })).toBeEnabled();
  });

  it("opens a failed job without a recovery kind or document ID in place", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [
          { jobId: "job-dead", jobType: "create_document", status: "failed", recoveryKind: null, documentId: null },
        ],
        recent: [],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /상세 보기$/ }));
    expect(screen.queryByText("연결된 문서가 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a claimed job as ordinary progress, not its raw step name", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [
          { jobId: "job-claimed", jobType: "create_document", status: "failed", progressStep: "manual_in_progress", clientName: "김하늘" },
        ],
        recent: [],
      },
    });

    expect(screen.queryByText("manual_in_progress")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /상세 보기$/ }));
    expect(screen.getByRole("heading", { name: "수동 처리중" })).toBeInTheDocument();
  });

  it("shows an authorized job as 전송 준비 중, not its raw step name", () => {
    renderOpenPopover({
      documentJobs: {
        active: [
          { jobId: "job-authorized", jobType: "create_document", status: "processing", progressStep: "dispatch_authorized", clientName: "김하늘", documentKind: "service_contract", displayOperation: "generate" },
        ],
        requiresAttention: [],
        recent: [],
      },
    });

    expect(screen.queryByText("dispatch_authorized")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /상세 보기$/ }));
    expect(screen.getByRole("heading", { name: "전송 준비 중" })).toBeInTheDocument();
  });

  describe("phone shared-pane progress and safe copy", () => {
  let width: number;
  beforeEach(() => { width = window.innerWidth; Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 }); });
  afterEach(() => Object.defineProperty(window, "innerWidth", { configurable: true, value: width }));
  it.each([
    ["queued", "현재 상태 확인 중"], ["processing", "현재 상태 확인 중"],
    ["client-started", "문서 작성 중"], ["info-inserted", "문서 작성 중"],
    ["creating", "전송 중"], ["sent", "전송 결과 확인 중"], ["failed", "현재 상태 확인 중"],
    ["reconciling", "현재 상태 확인 중"], ["dispatch_authorized", "전송 준비 중"],
    ["manual_resolved", "현재 상태 확인 중"], ["manual_in_progress", "수동 처리중"],
  ])("labels the %s step in Korean and never shows the key", (step, label) => {
    renderOpenPopover({
      documentJobs: {
        active: [
          { jobId: "job-step", jobType: "create_document", status: "processing", progressStep: step, clientName: "김하늘", documentId: "doc-step" },
        ],
        requiresAttention: [],
        recent: [],
      },
    });

    expect(screen.queryByText(step)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    expect(screen.queryByText("문서 ID doc-step")).not.toBeInTheDocument();
  });

  it("shows no raw key, user id or expiry for a claim step stored with its owner", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [
          { jobId: "job-claim", jobType: "create_document", status: "failed", progressStep: "manual_in_progress:42:2026-10-29T01:00:00.000Z", clientName: "김하늘" },
        ],
        recent: [],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    expect(screen.getByRole("heading", { name: "수동 처리중" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/manual_in_progress|42|2026-10-29/);
  });

  it("falls back to the document line, never the raw key, for an unknown step", () => {
    renderOpenPopover({
      documentJobs: {
        active: [
          { jobId: "job-unknown", jobType: "create_document", status: "processing", progressStep: "some-new-step", clientName: "김하늘", documentId: "doc-7" },
          { jobId: "job-unknown-2", jobType: "create_document", status: "processing", progressStep: "other_step", clientName: "이하늘" },
        ],
        requiresAttention: [],
        recent: [],
      },
    });

    expect(document.body.textContent).not.toMatch(/some-new-step|other_step/);
    for (const name of ["김하늘", "이하늘"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`${name}.*상세 보기`) }));
      expect(screen.getByRole("heading", { name: "현재 상태 확인 중" })).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/some-new-step|other_step/);
      fireEvent.click(screen.getByRole("button", { name: "목록으로 돌아가기" }));
    }
  });

  });

  it("does not label a needs-check job as 최근 완료 although it carries its failure time", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [
          { jobId: "job-check", jobType: "create_document", status: "requires_attention", attempts: 1, completedAt: "2026-08-13T01:00:00.000Z", recoveryKind: "verify_result", clientName: "김하늘" },
        ],
        recent: [],
      },
    });

    expect(screen.queryByText("최근 완료")).not.toBeInTheDocument();
  });

  it("uses 최근 처리 without the old recent-completion meta", () => {
    renderOpenPopover();

    expect(screen.getByText("최근 처리")).toBeInTheDocument();
    expect(screen.queryByText("최근 완료")).not.toBeInTheDocument();
  });

  it("closes the shared desktop dialog on Escape with one backdrop and no Popover content", () => {
    const onOpenChange = jest.fn();
    renderOpenPopover({ onOpenChange });

    const content = screen.getByRole("dialog");
    expect(content).toHaveAttribute("data-slot", "anchored-notification-panel");
    expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
    expect(document.querySelectorAll('[data-slot="anchored-notification-backdrop"]')).toHaveLength(1);
    expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeInTheDocument();
    fireEvent.keyDown(content, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe("below the lg breakpoint", () => {
    const originalWidth = window.innerWidth;

    beforeEach(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
    });

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: originalWidth });
    });

    it("keeps auto-finalize attention without recovery permission on its encoded document link", () => {
      renderOpenPopover({ documentJobs: { active: [], recent: [], requiresAttention: [{
        jobId: "job auto/1", jobType: "finalize_document", source: "auto_finalize", status: "requires_attention",
        documentId: "document auto/1", recoveryKind: null,
      }] } });

      expect(screen.getByRole("dialog", { name: "전자문서 작업" })).toHaveAttribute("data-side", "bottom");
      fireEvent.click(screen.getByRole("button", { name: /상세 보기$/ }));
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(document.querySelector('a[href*="recoverJobId="]')).toBeNull();
    });

    it.each([
      ["manual_send", "failed", "create_document"],
      ["verify_result", "requires_attention", "finalize_document"],
    ] as const)("routes mobile %s recovery through the encoded job ID", (recoveryKind, status, jobType) => {
      mockPathname = '/clients';
      const onOpenChange = jest.fn();
      renderOpenPopover({ onOpenChange, documentJobs: { active: [], recent: [], requiresAttention: [{
        jobId: "job f/1", jobType, source: "staff", status, recoveryKind, documentId: "document auto/1",
      }] } });
      expect(screen.getByRole("dialog", { name: "전자문서 작업" })).toHaveAttribute("data-side", "bottom");
      fireEvent.click(screen.getByRole("button", { name: /상세 보기$/ }));
      fireEvent.click(screen.getByRole("button", { name: recoveryKind === "manual_send" ? "수동 전송" : "결과 확인" }));
      expect(mockPush).toHaveBeenCalledWith("/contracts?recoverJobId=job%20f%2F1");
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(document.querySelector("iframe")).toBeNull();
    });

    it("keeps the completed mobile row's no-document tooltip and prevents navigation", () => {
      renderOpenPopover({ documentJobs: { active: [], requiresAttention: [], recent: [{
        jobId: "job-done-no-document", jobType: "create_document", status: "completed", documentId: null, clientName: "완료 고객",
      }] } });

      expect(screen.getByRole("dialog", { name: "전자문서 작업" })).toHaveAttribute("data-side", "bottom");
      expect(screen.getByRole("button", { name: "최근 처리 1건" })).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(screen.getByRole("button", { name: "최근 처리 1건" }));
      fireEvent.click(screen.getByRole("button", { name: /완료 고객.*상세 보기/ }));
      expect(screen.getByRole("heading", { name: "전송 완료" })).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("renders the list in a bottom sheet outside any popper wrapper, with its rows and header", () => {
      renderOpenPopover({ "data-component": "jobs_popover", className: "mobile-custom-content" });

      const sheet = screen.getByRole("dialog", { name: "전자문서 작업" });
      expect(sheet).toHaveAttribute("data-slot", "document-jobs-popover");
      expect(sheet).toHaveAttribute("data-side", "bottom");
      expect(sheet).toHaveAttribute("data-component", "jobs_popover");
      expect(sheet).toHaveAttribute("data-source-component", "ContractDocumentJobsPopover");
      expect(sheet).toHaveClass("mobile-custom-content");
      // The popper wrapper is a transformed, content-sized box that collapses a fixed child.
      expect(document.querySelector("[data-radix-popper-content-wrapper]")).not.toBeInTheDocument();
      expect(sheet.closest("[data-radix-popper-content-wrapper]")).toBeNull();
      expect(sheet.querySelector('[data-source-component="ContractDocumentJobsPanes"]')).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "처리중 1건" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "최근 처리 1건" })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getAllByRole("button", { name: /상세 보기$/ })).toHaveLength(2);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("closes on Escape and on a backdrop (overlay) click", async () => {
      const onOpenChange = jest.fn();
      renderOpenPopover({ onOpenChange });
      // Radix registers its outside-pointer listener on the next tick.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(onOpenChange).toHaveBeenCalledWith(false);

      onOpenChange.mockClear();
      const overlay = document.querySelector('[data-slot="sheet-overlay"]');
      expect(overlay).toBeInTheDocument();
      fireEvent.pointerDown(overlay as HTMLElement);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("returns focus and scroll to the selected phone card on back", () => {
      renderOpenPopover();
      const card = screen.getAllByRole("button", { name: /상세 보기$/ })[0];
      const scroller = document.querySelector('[data-slot="document-jobs-list-scroller"]')!;
      scroller.scrollTop = 67; fireEvent.click(card); scroller.scrollTop = 0;
      fireEvent.click(screen.getByRole("button", { name: "목록으로 돌아가기" }));
      expect(card).toHaveFocus(); expect(scroller.scrollTop).toBe(67);
    });

    it("opens from its trigger", () => {
      const onOpenChange = jest.fn();
      render(
        <ContractDocumentJobsPopover
          onOpenChange={onOpenChange}
          documentJobs={JOBS}
          trigger={<button type="button">전자문서 처리중</button>}
        />,
      );

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "전자문서 처리중" }));
      expect(onOpenChange).toHaveBeenCalledWith(true);
      expect(screen.getByRole("dialog", { name: "전자문서 작업" })).toBeInTheDocument();
    });
  });

  it("shows safe copy and no navigation for a completed job without a document id", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [],
        recent: [{ jobId: "job-done", jobType: "create_document", status: "completed", documentId: null }],
      },
    });

    expect(screen.queryByTitle("연결된 계약서가 없어 이동할 수 없어요.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "최근 처리 1건" }));
    fireEvent.click(screen.getByRole("button", { name: /상세 보기$/ }));
    expect(screen.queryByText("연결된 문서가 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the processing tile first in the row, without ms-auto, from active + unresolved only", async () => {
    jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValue(makeSummary({ activeCount: 7, requiresAttentionCount: 99 }));
    renderBar({ items: STAT_ITEMS });

    const processingTile = await screen.findByRole("button", PROCESSING_TILE);
    await waitFor(() => expect(processingTile).toHaveTextContent("7"));
    expect(processingTile).not.toHaveTextContent("99");
    expect(processingTile).not.toHaveClass("ms-auto");

    const stats = document.querySelector('[data-component="desktop_contracts_stats"]') as HTMLElement;
    expect(stats.firstElementChild).toBe(processingTile);
    expect(
      processingTile.compareDocumentPosition(
        stats.querySelector('[data-component="desktop_contracts_stats_stat-0"]') as Node,
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows an unavailable processing count and retries the summary after an initial failure", async () => {
    const getSummary = jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockRejectedValueOnce(new Error("summary unavailable"))
      .mockResolvedValue(makeSummary());
    renderBar();

    const processingTile = await screen.findByRole("button", PROCESSING_TILE);
    expect(await screen.findByRole("alert")).toHaveTextContent("전자문서 처리 현황을 불러오지 못했어요");
    expect(processingTile).toHaveTextContent("—");

    fireEvent.click(screen.getByRole("button", { name: "전자문서 처리 현황 다시 시도" }));
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(processingTile).toHaveTextContent("0");
  });

  it("keeps a successful zero distinct from an unavailable summary", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());
    renderBar();

    const processingTile = await screen.findByRole("button", PROCESSING_TILE);
    await waitFor(() => expect(processingTile).toHaveTextContent("0"));
    expect(processingTile).not.toHaveTextContent("—");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains a cached summary count and offers a stale retry after a refresh failure", async () => {
    const getSummary = jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValueOnce(makeSummary({ activeCount: 4 }))
      .mockRejectedValue(new Error("summary refresh failed"));
    const queryClient = renderBar();

    const processingTile = await screen.findByRole("button", PROCESSING_TILE);
    await waitFor(() => expect(processingTile).toHaveTextContent("4"));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.summary("branch-a") });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("최근 성공한 처리 현황을 표시하고 있어요");
    expect(processingTile).toHaveTextContent("4");

    getSummary.mockResolvedValue(makeSummary({ activeCount: 5 }));
    fireEvent.click(screen.getByRole("button", { name: "전자문서 처리 현황 다시 시도" }));
    await waitFor(() => expect(processingTile).toHaveTextContent("5"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("keeps list errors and retries independent from the summary tile", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 4 }));
    const getJobs = jest.spyOn(eformsignApi, "getDocumentJobs").mockRejectedValue(new Error("list unavailable"));
    renderBar();

    const processingTile = await screen.findByRole("button", PROCESSING_TILE);
    await waitFor(() => expect(processingTile).toHaveTextContent("4"));
    expect(screen.queryByText("전자문서 처리 현황을 불러오지 못했어요")).not.toBeInTheDocument();

    fireEvent.click(processingTile);
    await waitFor(() => expect(screen.getAllByText("전자문서 작업을 불러오지 못했습니다.")).toHaveLength(1));
    const callsBefore = getJobs.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "다시 시도" })[0]);
    await waitFor(() => expect(getJobs.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("lists active jobs from the endpoint as desktop detail buttons", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 1 }));
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(
      makeJobList({ active: [makeJob({ jobId: "job-x", status: "processing", jobType: "finalize_document", documentId: "doc-9" })] }),
    );
    renderBar();

    fireEvent.click(await screen.findByRole("button", PROCESSING_TILE));

    expect(await screen.findByRole("button", { name: /김하늘.*상세 보기$/ })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders no jobs card and touches neither provider nor react-query with showDocumentJobs={false}", () => {
    const getSummary = jest.spyOn(eformsignApi, "getDocumentJobSummary");
    render(<ContractStatsBar name="contracts" items={STAT_ITEMS} showDocumentJobs={false} />);

    expect(screen.queryByRole("button", PROCESSING_TILE)).not.toBeInTheDocument();
    expect(screen.getByText("통계 1")).toBeInTheDocument();
    expect(getSummary).not.toHaveBeenCalled();
  });

  it("still accepts the deprecated job-data props and ignores them", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 2 }));
    renderBar({
      items: [],
      summary: { activeCount: 50, requiresAttentionCount: 50 },
      summaryError: new Error("ignored"),
      summaryHasData: true,
      documentJobs: JOBS,
      jobsError: new Error("ignored"),
      onRetrySummary: jest.fn(),
      onRetryJobs: jest.fn(),
    });

    const processingTile = await screen.findByRole("button", PROCESSING_TILE);
    await waitFor(() => expect(processingTile).toHaveTextContent("2"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["Enter", " "])("keeps real trigger/ref and a single toggle for a %s native-key/click sequence", (key) => {
    const ref = createRef<HTMLButtonElement>(), clicked = jest.fn(), changed = jest.fn();
    const { container } = render(<ContractDocumentJobsPopover onOpenChange={changed} jobs={JOBS}
      trigger={<button ref={ref} onClick={clicked}>실제 트리거</button>} />);
    const trigger = screen.getByRole("button", { name: "실제 트리거" });
    const anchor = jest.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 123, top: 20, bottom: 52 } as DOMRect);
    expect(ref.current).toBe(trigger);
    expect(trigger.parentElement).toBe(container);
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).not.toHaveAttribute("aria-controls");
    fireEvent.keyDown(trigger, { key }); fireEvent.click(trigger); fireEvent.keyUp(trigger, { key });
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls).toEqual([[true]]);
    expect(anchor).toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveStyle({ left: "123px" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "전자문서 작업 닫기" }));
    expect(changed.mock.calls).toEqual([[true], [false]]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains controlled open and defaultOpen without double callbacks", () => {
    const changed = jest.fn();
    const { rerender } = render(<ContractDocumentJobsPopover open={false} onOpenChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "전자문서 처리중" }));
    expect(changed.mock.calls).toEqual([[true]]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<ContractDocumentJobsPopover open onOpenChange={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "전자문서 작업 닫기" }));
    expect(changed.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(<ContractDocumentJobsPopover open={false} onOpenChange={changed} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([undefined, "", "desktop_contracts_stats_document-jobs-popover"])("forwards optional caller metadata %s verbatim", (base) => {
    render(<ContractDocumentJobsPopover defaultOpen jobs={JOBS} data-component={base} />);
    const dialog = screen.getByRole("dialog");
    if (base) {
      expect(dialog).toHaveAttribute("data-component", "desktop_contracts_stats_document-jobs-popover");
      expect(document.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-component", "desktop_contracts_stats_document-jobs-popover_panes_slide");
    } else expect(dialog.querySelectorAll("[data-component]")).toHaveLength(0);
    expect(dialog.getAttribute("data-component")).toBe(base || null);
  });

  it.each(["isLoading", "isJobsLoading"] as const)("forwards %s and legacy loading aliases", (flag) => {
    renderOpenPopover({ [flag]: true });
    expect(screen.getByRole("status", { name: "전자문서 작업 불러오는 중" })).toBeInTheDocument();
  });

  it("retains job/error/retry alias precedence", () => {
    const retry = jest.fn(), aliasRetry = jest.fn();
    const { rerender } = renderOpenPopover({ error: new Error("primary"), jobsError: new Error("alias"), onRetry: retry, onRetryJobs: aliasRetry });
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1); expect(aliasRetry).not.toHaveBeenCalled();
    rerender(<ContractDocumentJobsPopover open jobs={JOBS} error={false} jobsError={new Error("ignored")} />);
    expect(screen.getAllByRole("button", { name: /상세 보기$/ })).toHaveLength(2);
    rerender(<ContractDocumentJobsPopover open jobsError={new Error("alias")} onRetryJobs={aliasRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(aliasRetry).toHaveBeenCalledTimes(1);
  });

  it("prefers documentJobs and falls back to jobs when the preferred alias is null", () => {
    const alias = { ...JOBS, active: [{ ...JOBS.active[0], clientName: "별칭 고객" }] };
    const { rerender } = renderOpenPopover({ jobs: alias });
    expect(screen.queryByText("별칭 고객")).not.toBeInTheDocument();
    rerender(<ContractDocumentJobsPopover open jobs={alias} documentJobs={null} />);
    expect(screen.getByRole("button", { name: /별칭 고객.*상세 보기$/ })).toBeInTheDocument();
  });
});

test('verify_only refetches the job, closes recovery and updates the selected detail to 전송 완료', async () => {
  mockPathname = '/contracts'; mockToast.mockClear();
  setBranchCookie('branch-a'); window.sessionStorage.clear();
  const job = makeJob({ ...RECOVERY_JOB, documentKind: 'service_contract', displayOperation: 'generate' });
  const getJobs = jest.spyOn(eformsignApi, 'getDocumentJobs').mockResolvedValue(makeJobList({ requiresAttention: [job] }));
  const getSummary = jest.spyOn(eformsignApi, 'getDocumentJobSummary').mockResolvedValue(makeSummary({ unresolvedCount: 1 }));
  const open = jest.spyOn(eformsignApi, 'openDocumentJobRecovery').mockImplementation(async () => {
    getJobs.mockResolvedValue(makeJobList({ recent: [{ ...job, status: 'completed', progressStep: 'sent' }] }));
    getSummary.mockResolvedValue(makeSummary());
    return { kind: 'verify_only', jobId: job.jobId, claimEpoch: '42', claimExpiresAt: new Date(Date.now() + 60000).toISOString() };
  });
  try {
    renderBar({ items: [] });
    fireEvent.click(await screen.findByRole('button', { name: '문서 처리 실패 작업 보기' }));
    fireEvent.click(await screen.findByRole('button', { name: /복구 고객.*상세 보기/ }));
    fireEvent.click(screen.getByRole('button', { name: '수동 전송' }));
    await screen.findByRole('heading', { name: '전송 완료' });
    expect(mockToast).toHaveBeenCalledWith({ variant: 'success', description: '전자문서를 전송했어요' });
    expect(screen.queryByRole('dialog', { name: '전자문서 수동 전송' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '전자문서 작업' })).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
  } finally { setBranchCookie(null); jest.restoreAllMocks(); }
});

test('phone recovery returns focus to the sheet trigger when its source is removed', async () => {
  const width = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  mockPathname = '/contracts';
  jest.spyOn(eformsignApi, 'openDocumentJobRecovery').mockResolvedValue({ kind: 'editable', jobId: RECOVERY_JOB.jobId, claimEpoch: '42', claimExpiresAt: new Date(Date.now() + 60000).toISOString(), document: { companyId: 'company-abc', templateId: 'template_ABC', documentId: 'document012' } });
  try {
    const view = renderOpenPopover({ documentJobs: { active: [], requiresAttention: [RECOVERY_JOB], recent: [] } });
    fireEvent.click(screen.getByRole('button', { name: /복구 고객.*상세 보기/ }));
    fireEvent.click(screen.getByRole('button', { name: '수동 전송' }));
    const frame = await screen.findByTitle<HTMLIFrameElement>('이폼사인 수동 전송');
    jest.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    view.rerender(<ContractDocumentJobsPopover open documentJobs={{ active: [], requiresAttention: [], recent: [] }} trigger={<button>전자문서 처리중</button>} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.querySelector('[data-slot="document-jobs-trigger"]')).toHaveFocus());
    expect(screen.getByRole('dialog', { name: '전자문서 작업' })).toBeInTheDocument();
  } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); jest.restoreAllMocks(); }
});
