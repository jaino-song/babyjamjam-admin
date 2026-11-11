import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DocumentJobsStatMini } from "@/components/app/contracts/DocumentJobsStatMini";
import {
  createTestQueryClient,
  JobsTestWrapper,
  makeJob,
  makeJobList,
  makeSummary,
  setBranchCookie,
} from "@/features/document-jobs/testing/jobs-test-utils";
import { eformsignApi } from "@/services/api";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/dashboard",
}));

describe("DocumentJobsStatMini stale summary", () => {
  beforeEach(() => {
    setBranchCookie("branch-a");
    window.sessionStorage.clear();
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue({ active: [], requiresAttention: [], recent: [] });
  });

  afterEach(() => {
    setBranchCookie(null);
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("keeps a whenActive card visible with a stale note and retry when a refresh fails after data", async () => {
    const getSummary = jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValueOnce(makeSummary({ activeCount: 4 }))
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValue(makeSummary({ activeCount: 2 }));
    const queryClient = createTestQueryClient();

    render(
      <JobsTestWrapper queryClient={queryClient}>
        <DocumentJobsStatMini mode="whenActive" name="dashboard" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" });
    await waitFor(() => expect(card).toHaveTextContent("4"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      await queryClient.refetchQueries();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("최근 성공한 처리 현황을 표시하고 있어요");
    expect(card).toHaveTextContent("4");

    fireEvent.click(screen.getByRole("button", { name: "전자문서 처리 현황 다시 시도" }));

    await waitFor(() => expect(card).toHaveTextContent("2"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getSummary).toHaveBeenCalledTimes(3);
  });

  it("renders no card for a whenActive mode when the summary failed without data", async () => {
    const getSummary = jest.spyOn(eformsignApi, "getDocumentJobSummary").mockRejectedValue(new Error("down"));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <DocumentJobsStatMini mode="whenActive" name="dashboard" />
      </JobsTestWrapper>,
    );

    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "전자문서 처리중 작업 보기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses the actual StatMini anchor/namespace and stops list polling after document navigation", async () => {
    jest.useFakeTimers();
    const changed = jest.fn();
    const summary = jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 1 }));
    const jobs = jest.mocked(eformsignApi.getDocumentJobs).mockResolvedValue(makeJobList({ recent: [makeJob({ status: "completed", documentId: "doc /1", documentKind: "service_contract", displayOperation: "generate" })] }));
    render(<JobsTestWrapper queryClient={createTestQueryClient()}><DocumentJobsStatMini mode="always" name="desktop_contracts" onOpenChange={changed} /></JobsTestWrapper>);
    const trigger = await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" });
    await waitFor(() => expect(trigger).toHaveTextContent("1"));
    expect(trigger).toHaveAttribute("data-component", "desktop_contracts_stats_document-jobs-popover_trigger");
    expect(jobs).not.toHaveBeenCalled();
    const anchor = jest.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 230, top: 20, bottom: 52 } as DOMRect);
    fireEvent.click(trigger);
    await screen.findByRole("button", { name: /김하늘.*상세 보기$/ });
    expect(anchor).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-component", "desktop_contracts_stats_document-jobs-popover");
    expect(trigger).not.toHaveAttribute("aria-controls");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(jobs.mock.calls.length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기$/ }));
    const link = screen.getByRole("link", { name: "문서 보기" });
    expect(link).toHaveAttribute("href", "/contracts?documentId=doc%20%2F1");
    fireEvent.click(link);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(changed.mock.calls).toEqual([[true], [false]]);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const calls = jobs.mock.calls.length, summaryCalls = summary.mock.calls.length;
    await act(async () => { await jest.advanceTimersByTimeAsync(10_000); });
    expect(jobs).toHaveBeenCalledTimes(calls);
    expect(summary.mock.calls.length).toBeGreaterThan(summaryCalls);
    expect(trigger).toHaveFocus();
  });
});
