import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Clock3 } from "lucide-react";

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

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/contracts",
}));

const PROCESSING_TILE = { name: "전자문서 처리중 작업 보기" };

const JOBS: ContractDocumentJobsData = {
  active: [
    {
      jobId: "job-active",
      jobType: "finalize_document",
      status: "processing",
      documentId: "document-1",
      progressStep: "전자문서 최종 확인중",
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
    setBranchCookie("branch-a");
    window.sessionStorage.clear();
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList());
  });

  afterEach(() => {
    setBranchCookie(null);
    jest.restoreAllMocks();
  });

  it("renders the three sections; active rows are not links, failed rows open recovery, completed rows open the document", () => {
    renderOpenPopover();

    expect(screen.getByRole("heading", { name: "처리 중" })).toBeInTheDocument();
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.getByText("최근 처리")).toBeInTheDocument();
    expect(screen.getByText("전자문서 최종 확인중")).toBeInTheDocument();

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/contracts?recoverJobId=job-attention",
      "/contracts?documentId=document-3",
    ]);
    expect(screen.queryByRole("link", { name: /전자문서 최종 확인중/ })).not.toBeInTheDocument();
  });

  it("links failed rows to recovery and titles rows with the client name", () => {
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

    const first = screen.getByRole("link", { name: /김하늘 · 계약서 생성/ });
    expect(first).toHaveAttribute("href", "/contracts?recoverJobId=job%20f%2F1");
    expect(screen.getByRole("link", { name: /고객 · 검토완료/ })).toHaveAttribute(
      "href",
      "/contracts?recoverJobId=job-f2",
    );
  });

  it("links an auto-finalize requires_attention job with no recovery kind to its document, not recovery", () => {
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

    expect(screen.getByRole("link")).toHaveAttribute("href", "/contracts?documentId=document%20auto%2F1");
  });

  it("links staff failed (manual_send) and requires_attention (verify_result) rows to recovery", () => {
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

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/contracts?recoverJobId=job-m",
      "/contracts?recoverJobId=job-v",
    ]);
  });

  it("renders a static row for a failed job with no recovery kind and no document id", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [
          { jobId: "job-dead", jobType: "create_document", status: "failed", recoveryKind: null, documentId: null },
        ],
        recent: [],
      },
    });

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
    expect(screen.getByText("처리 중", { selector: "p, span, div" })).toBeInTheDocument();
  });

  it("closes on Escape and mobile backdrop clicks", () => {
    const onOpenChange = jest.fn();
    renderOpenPopover({ onOpenChange });

    const content = screen.getByRole("dialog");
    fireEvent.keyDown(content, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    const backdrop = document.querySelector('[data-slot="popover-backdrop"]');
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows safe copy and no navigation for a completed job without a document id", () => {
    renderOpenPopover({
      documentJobs: {
        active: [],
        requiresAttention: [],
        recent: [{ jobId: "job-done", jobType: "create_document", status: "completed", documentId: null }],
      },
    });

    expect(screen.getByTitle("연결된 계약서가 없어 이동할 수 없어요.")).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getAllByText("전자문서 작업을 불러오지 못했습니다.")).toHaveLength(3));
    const callsBefore = getJobs.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "다시 시도" })[0]);
    await waitFor(() => expect(getJobs.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("lists active jobs from the list endpoint in the card's popover without linking them", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 1 }));
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(
      makeJobList({ active: [makeJob({ jobId: "job-x", status: "processing", jobType: "finalize_document", documentId: "doc-9" })] }),
    );
    renderBar();

    fireEvent.click(await screen.findByRole("button", PROCESSING_TILE));

    expect(await screen.findByText("김하늘 · 검토완료")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /김하늘 · 검토완료/ })).not.toBeInTheDocument();
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
});
