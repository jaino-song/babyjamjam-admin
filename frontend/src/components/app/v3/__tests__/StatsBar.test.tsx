import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Clock3 } from "lucide-react";

import {
  createTestQueryClient,
  JobsTestWrapper,
  makeJob,
  makeJobList,
  makeSummary,
  setBranchCookie,
} from "@/features/document-jobs/testing/jobs-test-utils";
import { eformsignApi } from "@/services/api";
import { api } from "@/lib/api/client";

import { StatsBar } from "../StatsBar";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/dashboard",
}));

const ITEMS = [
  { icon: Clock3, value: 1, label: "첫째", counter: "건" },
  { icon: Clock3, value: 2, label: "둘째", counter: "건" },
];

const CARD = { name: "전자문서 처리중 작업 보기" };

describe("StatsBar document jobs card", () => {
  beforeEach(() => {
    setBranchCookie("branch-a");
    window.sessionStorage.clear();
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList());
  });

  afterEach(() => {
    setBranchCookie(null);
    jest.restoreAllMocks();
  });

  it("hides the whenActive card while there is nothing active or unresolved", async () => {
    const getSummary = jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={ITEMS} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    expect(screen.queryByRole("button", CARD)).not.toBeInTheDocument();
    expect(screen.getByText("첫째")).toBeInTheDocument();
  });

  it("shows the whenActive card as the first child once there are jobs", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 2 }));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={ITEMS} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", CARD);
    const bar = document.querySelector('[data-component="dashboard_stats"]') as HTMLElement;
    expect(bar.firstElementChild).toBe(card);
    expect(card).toHaveTextContent("2");
    expect(card).not.toHaveClass("ms-auto");
  });

  it("shows the whenActive card for unresolved failures alone", async () => {
    jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValue(makeSummary({ unresolvedJobIds: ["a"] }));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={ITEMS} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", { name: "문서 처리 실패 작업 보기" });
    expect(card).toHaveTextContent("1건문서 처리 실패");
    expect(card.querySelector('[data-slot="stat-mini-marker"]')).toBeNull();
  });

  it("keeps the always card at zero", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="contracts" items={ITEMS} showDocumentJobs="always" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", CARD);
    await waitFor(() => expect(card).toHaveTextContent("0"));
    expect(card).not.toHaveTextContent("실패");
  });

  // Caller ownership is checked by the six page/manager render suites.
  it.each([390, 1280])("keeps the empty list open after cancelling the last unresolved job at %spx, then hides the card on close", async width => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    const base = "desktop_clients";
    const job = makeJob({ cancellable: true, status: "requires_attention" });
    let cancelled = false;
    jest.mocked(eformsignApi.getDocumentJobs).mockRestore();
    const get = jest.spyOn(api, "get").mockImplementation(async url => {
      if (url === "/eformsign-docs/jobs/summary") {
        return { data: makeSummary({ unresolvedJobIds: cancelled ? [] : [job.jobId] }) };
      }
      if (url === "/eformsign-docs/jobs") {
        return { data: makeJobList({ requiresAttention: cancelled ? [] : [job] }) };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    const post = jest.spyOn(api, "post").mockImplementation(async () => {
      cancelled = true;
      return { data: { jobId: job.jobId, outcome: "cancelled" } };
    });

    try {
      render(
        <JobsTestWrapper queryClient={createTestQueryClient()}>
          <StatsBar name={base} density="responsive-square" items={[]} showDocumentJobs="whenActive" />
        </JobsTestWrapper>,
      );
      const trigger = await screen.findByRole("button", { name: "문서 처리 실패 작업 보기" });
      fireEvent.click(trigger);
      fireEvent.click(await screen.findByRole("button", { name: /김하늘.*상세 보기/ }));
      const cancelButton = screen.getByRole("button", { name: "취소" });
      const panes = width < 1024 ? "body_panes" : "panes";
      expect(cancelButton).toHaveAttribute("data-component",
        `${base}_stats_document-jobs-popover_${panes}_slide_detail-pane_body_scroll_job_progress_cancel_button`);
      expect(cancelButton.getAttribute("data-component")).toMatch(/^desktop_.*_job_progress_cancel_button$/);
      fireEvent.click(cancelButton);
      const confirmation = await screen.findByRole("dialog", { name: "이 작업을 취소할까요?" });
      expect(post).not.toHaveBeenCalled();
      // Let the real outside-pointer listeners observe the portalled approval.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      const approve = within(confirmation).getByRole("button", { name: "작업 취소" });
      fireEvent.pointerDown(approve);
      fireEvent.mouseDown(approve);
      fireEvent.click(approve);

      await waitFor(() => expect(post).toHaveBeenCalledWith(`/eformsign-docs/jobs/${job.jobId}/cancel`));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "이 작업을 취소할까요?" })).not.toBeInTheDocument());
      expect(screen.getByRole("dialog", { name: "전자문서 작업" })).toBeInTheDocument();
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveTextContent("0");
      expect(screen.getByText("처리중인 전자문서가 없습니다.")).toBeVisible();
      expect(screen.getByText("확인이 필요한 전자문서가 없습니다.")).toBeVisible();
      expect(screen.queryByRole("button", { name: /김하늘.*상세 보기/ })).not.toBeInTheDocument();
      expect(document.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "false");
      const close = screen.getByRole("button", { name: "전자문서 작업 닫기" });
      await waitFor(() => expect(close).toHaveFocus());
      expect(get.mock.calls.filter(([url]) => url === "/eformsign-docs/jobs/summary").length).toBeGreaterThan(1);
      expect(get.mock.calls.filter(([url]) => url === "/eformsign-docs/jobs").length).toBeGreaterThan(1);
      fireEvent.click(close);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "전자문서 작업" })).not.toBeInTheDocument());
      expect(trigger).not.toBeInTheDocument();
      expect(document.querySelector(`[data-component="${base}_stats"]`)).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("renders nothing when it has no items and the jobs card is hidden", async () => {
    const getSummary = jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={[]} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    expect(document.querySelector('[data-component="dashboard_stats"]')).not.toBeInTheDocument();
  });

  it("shows an item-less bar once the jobs card has something to show", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 1 }));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <StatsBar name="dashboard" items={[]} showDocumentJobs="whenActive" />
      </JobsTestWrapper>,
    );

    expect(await screen.findByRole("button", CARD)).toBeInTheDocument();
    expect(document.querySelector('[data-component="dashboard_stats"]')).toBeInTheDocument();
  });

  it("renders no jobs card and needs no provider when the prop is omitted", () => {
    render(<StatsBar name="plain" items={ITEMS} />);

    expect(screen.queryByRole("button", CARD)).not.toBeInTheDocument();
    expect(screen.getByText("둘째")).toBeInTheDocument();
  });
  it("supports independent item loading while retaining the shared default", () => {
    const { container } = render(<StatsBar name="desktop_chat_stats" isLoading items={[
      { icon: Clock3, value: 7, label: "공유 로딩" },
      { icon: Clock3, value: 0, label: "독립 완료", isLoading: false },
      { icon: Clock3, value: 9, label: "독립 로딩", isLoading: true },
    ]} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_chat_stats_stats_item-1"]')).toHaveTextContent("독립 완료");
  });
});

describe("StatsBar trailing slot", () => {
  it("renders trailing after existing mapped items", () => {
    render(<JobsTestWrapper queryClient={createTestQueryClient()}>
      <StatsBar name="desktop_clients" items={ITEMS} trailing={<span>추가 통계</span>} />
    </JobsTestWrapper>);
    const bar = document.querySelector('[data-component="desktop_clients_stats"]')!;
    expect(bar.lastElementChild).toHaveTextContent("추가 통계");
    expect(bar.children[0]).toHaveAttribute("data-component", "desktop_clients_stats_item-0");
    expect(bar.children[1]).toHaveAttribute("data-component", "desktop_clients_stats_item-1");
  });

  it("preserves the empty-row early return even with a trailing slot", () => {
    render(<JobsTestWrapper queryClient={createTestQueryClient()}>
      <StatsBar name="desktop_clients" items={[]} trailing={<span>추가 통계</span>} />
    </JobsTestWrapper>);
    expect(document.querySelector('[data-component="desktop_clients_stats"]')).toBeNull();
    expect(screen.queryByText("추가 통계")).not.toBeInTheDocument();
  });
});
