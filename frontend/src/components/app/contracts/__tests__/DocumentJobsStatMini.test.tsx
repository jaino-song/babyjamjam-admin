import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DocumentJobsStatMini } from "@/components/app/contracts/DocumentJobsStatMini";
import {
  createTestQueryClient,
  JobsTestWrapper,
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
});
