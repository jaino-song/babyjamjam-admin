import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

import { DocumentJobsStatMini } from "@/components/app/contracts/DocumentJobsStatMini";
import { eformsignApi } from "@/services/api";

import { useDocumentJobs } from "../DocumentJobsProvider";
import {
  createTestQueryClient,
  JobsTestWrapper,
  makeJob,
  makeJobList,
  makeSummary,
  setBranchCookie,
} from "../testing/jobs-test-utils";

const mockPush = jest.fn();
const mockRouter = { push: mockPush };
let mockPathname = "/dashboard";

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));

function OpenListButton() {
  const { openJobsList } = useDocumentJobs();
  return (
    <button type="button" onClick={openJobsList}>
      목록 열기
    </button>
  );
}

describe("DocumentJobsProvider", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    mockPush.mockClear();
    setBranchCookie("branch-a");
    window.sessionStorage.clear();
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList());
  });

  afterEach(() => {
    setBranchCookie(null);
    jest.restoreAllMocks();
  });

  it("returns an inert value outside the provider instead of throwing", () => {
    const { result } = renderHook(() => useDocumentJobs());

    expect(result.current.summary).toBeUndefined();
    expect(result.current.total).toBe(0);
    expect(result.current.isPopoverOpen).toBe(false);
    expect(() => {
      result.current.setPopoverOpen(true);
      result.current.openJobsList();
      result.current.registerCard("card")();
    }).not.toThrow();
  });

  it("opens the jobs popover when a card is mounted", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 1 }));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <DocumentJobsStatMini mode="whenActive" name="dashboard" />
        <OpenListButton />
      </JobsTestWrapper>,
    );

    await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "목록 열기" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("navigates to /contracts and opens the list there once when no card is mounted", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());
    const queryClient = createTestQueryClient();

    const view = render(
      <JobsTestWrapper queryClient={queryClient}>
        <OpenListButton />
      </JobsTestWrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "목록 열기" }));
    expect(mockPush).toHaveBeenCalledWith("/contracts");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The navigation lands: the contracts page mounts its always-on card.
    mockPathname = "/contracts";
    view.rerender(
      <JobsTestWrapper queryClient={queryClient}>
        <DocumentJobsStatMini mode="always" name="contracts" />
        <OpenListButton />
      </JobsTestWrapper>,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("closes the popover when the pathname changes", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 2 }));
    const queryClient = createTestQueryClient();

    const view = render(
      <JobsTestWrapper queryClient={queryClient}>
        <DocumentJobsStatMini mode="always" name="dashboard" />
        <OpenListButton />
      </JobsTestWrapper>,
    );
    await screen.findByText("2");
    fireEvent.click(screen.getByRole("button", { name: "목록 열기" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    mockPathname = "/clients";
    view.rerender(
      <JobsTestWrapper queryClient={queryClient}>
        <DocumentJobsStatMini mode="always" name="clients" />
        <OpenListButton />
      </JobsTestWrapper>,
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the popover when the last card unmounts", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 2 }));
    const queryClient = createTestQueryClient();

    const view = render(
      <JobsTestWrapper queryClient={queryClient}>
        <DocumentJobsStatMini mode="always" name="dashboard" />
        <OpenListButton />
      </JobsTestWrapper>,
    );
    await screen.findByText("2");
    fireEvent.click(screen.getByRole("button", { name: "목록 열기" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    view.rerender(
      <JobsTestWrapper queryClient={queryClient}>
        <OpenListButton />
      </JobsTestWrapper>,
    );
    view.rerender(
      <JobsTestWrapper queryClient={queryClient}>
        <DocumentJobsStatMini mode="always" name="dashboard" />
        <OpenListButton />
      </JobsTestWrapper>,
    );

    await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows active + unresolved on the card and a failure marker only when something is unresolved", async () => {
    jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValue(
        makeSummary({ activeCount: 3, requiresAttentionCount: 99, unresolvedCount: 2, unresolvedJobIds: ["a", "b"] }),
      );
    const queryClient = createTestQueryClient();

    const view = render(
      <JobsTestWrapper queryClient={queryClient}>
        <DocumentJobsStatMini mode="always" name="contracts" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" });
    await waitFor(() => expect(card).toHaveTextContent("5"));
    expect(card).not.toHaveTextContent("99");
    expect(card).toHaveTextContent("실패 2");
    view.unmount();

    jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockResolvedValue(makeSummary({ activeCount: 3, requiresAttentionCount: 99 }));
    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <DocumentJobsStatMini mode="always" name="contracts" />
      </JobsTestWrapper>,
    );
    const calmCard = await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" });
    await waitFor(() => expect(calmCard).toHaveTextContent("3"));
    expect(calmCard).not.toHaveTextContent("실패");
  });

  it("keeps an unavailable summary distinct from zero, offers a retry, and recovers", async () => {
    const getSummary = jest
      .spyOn(eformsignApi, "getDocumentJobSummary")
      .mockRejectedValueOnce(new Error("summary unavailable"))
      .mockResolvedValue(makeSummary());

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <DocumentJobsStatMini mode="always" name="contracts" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" });
    await waitFor(() => expect(card).toHaveTextContent("—"));
    expect(await screen.findByRole("alert")).toHaveTextContent("전자문서 처리 현황을 불러오지 못했어요");

    fireEvent.click(screen.getByRole("button", { name: "전자문서 처리 현황 다시 시도" }));

    await waitFor(() => expect(card).toHaveTextContent("0"));
    expect(card).not.toHaveTextContent("—");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getSummary).toHaveBeenCalledTimes(2);
  });

  it("hides the whenActive card when the summary failed without data", async () => {
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

  it("keeps list errors independent from the summary card and retries only the list", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 4 }));
    const getJobs = jest.spyOn(eformsignApi, "getDocumentJobs").mockRejectedValue(new Error("list unavailable"));

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <DocumentJobsStatMini mode="always" name="contracts" />
      </JobsTestWrapper>,
    );

    const card = await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" });
    await waitFor(() => expect(card).toHaveTextContent("4"));
    expect(screen.queryByText("전자문서 처리 현황을 불러오지 못했어요")).not.toBeInTheDocument();

    fireEvent.click(card);
    await waitFor(() => expect(screen.getAllByText("전자문서 작업을 불러오지 못했습니다.")).toHaveLength(3));

    const callsBefore = getJobs.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "다시 시도" })[0]);
    await waitFor(() => expect(getJobs.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("lists the jobs from the list endpoint inside the popover", async () => {
    jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary({ activeCount: 1 }));
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(
      makeJobList({
        active: [makeJob({ jobId: "job-active", status: "processing", jobType: "finalize_document", documentId: "doc-1" })],
      }),
    );

    render(
      <JobsTestWrapper queryClient={createTestQueryClient()}>
        <DocumentJobsStatMini mode="always" name="contracts" />
      </JobsTestWrapper>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "전자문서 처리중 작업 보기" }));

    // An active job is read-only: its row is shown, but it links nowhere.
    expect(await screen.findByText("김하늘 · 검토완료")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /검토완료/ })).not.toBeInTheDocument();
  });
});
