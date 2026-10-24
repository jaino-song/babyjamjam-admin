import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";

import { eformsignDocumentJobsQueryKeys } from "@/hooks/useEformsignDocumentJobs";
import { eformsignApi } from "@/services/api";
import type { EformsignDocumentJobSummary } from "@/services/api";

import { failureSeenStorageKey } from "../failure-seen-storage";
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

const SEEN_KEY_A = failureSeenStorageKey("user-1", "branch-a");

function mockSummaries(summary: EformsignDocumentJobSummary) {
  return jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(summary);
}

function renderStack(queryClient: QueryClient = createTestQueryClient()) {
  render(<JobsTestWrapper queryClient={queryClient}>{null}</JobsTestWrapper>);
  return queryClient;
}

/** Wait for the first (empty) summary to be fetched AND processed, so the next one is a "later" one. */
async function settleFirstSummary(queryClient: QueryClient, branchId = "branch-a") {
  await waitFor(() =>
    expect(queryClient.getQueryState(eformsignDocumentJobsQueryKeys.summary(branchId))?.status).toBe("success"),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function refetchSummary(queryClient: QueryClient, branchId = "branch-a") {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: eformsignDocumentJobsQueryKeys.summary(branchId) });
  });
}

const FAILURES = [
  makeJob({ jobId: "j-create", jobType: "create_document", recoveryKind: "manual_send", clientName: "김하늘" }),
  makeJob({ jobId: "j-finalize", jobType: "finalize_document", recoveryKind: "manual_send", clientName: "이수진" }),
  makeJob({ jobId: "j-verify", jobType: "create_document", recoveryKind: "verify_result", clientName: null }),
  makeJob({ jobId: "j-extra", jobType: "create_document", recoveryKind: "manual_send", clientName: "박민수" }),
];

describe("document job failure popups", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    mockPush.mockClear();
    setBranchCookie("branch-a");
    window.sessionStorage.clear();
    jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList({ requiresAttention: FAILURES }));
  });

  afterEach(() => {
    jest.useRealTimers();
    setBranchCookie(null);
    jest.restoreAllMocks();
  });

  it("shows ONE summary popup for unseen failures on first load, not one per job", async () => {
    mockSummaries(makeSummary({ unresolvedJobIds: ["j-create", "j-finalize"] }));
    const getJobs = jest.spyOn(eformsignApi, "getDocumentJobs");

    renderStack();

    expect(await screen.findByText("확인이 필요한 전자문서 2건")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(getJobs).not.toHaveBeenCalled();
  });

  it("takes the summary popup's count from unresolvedCount, not the capped id list", async () => {
    mockSummaries(makeSummary({ unresolvedJobIds: ["j-create"], unresolvedCount: 73 }));

    renderStack();

    expect(await screen.findByText("확인이 필요한 전자문서 73건")).toBeInTheDocument();
  });

  it("opens the jobs list from the summary popup and closes the popup", async () => {
    mockSummaries(makeSummary({ unresolvedJobIds: ["j-create"] }));

    renderStack();
    fireEvent.click(await screen.findByRole("button", { name: "목록 보기" }));

    // No card is mounted in this tree, so the list lives on /contracts.
    expect(mockPush).toHaveBeenCalledWith("/contracts");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows nothing when this browser session has already seen every unresolved id", async () => {
    window.sessionStorage.setItem(SEEN_KEY_A, JSON.stringify(["j-create", "j-finalize"]));
    const getSummary = mockSummaries(makeSummary({ unresolvedJobIds: ["j-create", "j-finalize"] }));

    renderStack();

    await waitFor(() => expect(getSummary).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("gives each failure that appears later its own popup with copy for its recovery kind", async () => {
    const getSummary = mockSummaries(makeSummary());
    const queryClient = renderStack();
    await settleFirstSummary(queryClient);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: ["j-create", "j-finalize", "j-verify"] }));
    await refetchSummary(queryClient);

    const create = await screen.findByText("계약서 자동 전송 실패");
    expect(within(create.closest('[role="alert"]') as HTMLElement).getByText(/김하늘 님/)).toBeInTheDocument();
    expect(within(create.closest('[role="alert"]') as HTMLElement).getByRole("button", { name: "직접 작성하기" })).toBeInTheDocument();

    const finalize = await screen.findByText("검토완료 자동 처리 실패");
    expect(within(finalize.closest('[role="alert"]') as HTMLElement).getByText(/이수진 님/)).toBeInTheDocument();
    expect(within(finalize.closest('[role="alert"]') as HTMLElement).getByRole("button", { name: "직접 처리하기" })).toBeInTheDocument();

    const verify = await screen.findByText("전자문서 결과 확인 필요");
    expect(within(verify.closest('[role="alert"]') as HTMLElement).getByText(/고객 님/)).toBeInTheDocument();
    expect(within(verify.closest('[role="alert"]') as HTMLElement).getByRole("button", { name: "결과 확인" })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(3);
  });

  it("uses generic copy while the job's details have not arrived", async () => {
    const getSummary = mockSummaries(makeSummary());
    jest.spyOn(eformsignApi, "getDocumentJobs").mockImplementation(() => new Promise(() => {}));
    const queryClient = renderStack();
    await settleFirstSummary(queryClient);

    getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: ["j-create"] }));
    await refetchSummary(queryClient);

    expect(await screen.findByText("전자문서 작업 실패")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인하기" })).toBeInTheDocument();
  });

  it("collapses failures beyond three into one '실패 N건 더 보기' popup", async () => {
    const getSummary = mockSummaries(makeSummary());
    const queryClient = renderStack();
    await settleFirstSummary(queryClient);

    getSummary.mockResolvedValue(
      makeSummary({ unresolvedJobIds: ["j-create", "j-finalize", "j-verify", "j-extra"] }),
    );
    await refetchSummary(queryClient);

    expect(await screen.findByText("실패 1건 더 보기")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(4);

    fireEvent.click(within(screen.getByText("실패 1건 더 보기").closest('[role="alert"]') as HTMLElement).getByRole("button", { name: "목록 보기" }));
    expect(mockPush).toHaveBeenCalledWith("/contracts");
  });

  it("closing a popup removes only that popup and promotes a hidden one", async () => {
    const getSummary = mockSummaries(makeSummary());
    const queryClient = renderStack();
    await settleFirstSummary(queryClient);
    getSummary.mockResolvedValue(
      makeSummary({ unresolvedJobIds: ["j-create", "j-finalize", "j-verify", "j-extra"] }),
    );
    await refetchSummary(queryClient);
    await screen.findByText("실패 1건 더 보기");

    const first = (await screen.findByText("계약서 자동 전송 실패")).closest('[role="alert"]') as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: "알림 닫기" }));

    await waitFor(() => expect(screen.queryByText("실패 1건 더 보기")).not.toBeInTheDocument());
    expect(screen.getByText("검토완료 자동 처리 실패")).toBeInTheDocument();
    expect(screen.getByText("전자문서 결과 확인 필요")).toBeInTheDocument();
    // j-create (first in order) is gone; j-extra, the former overflow, took its place.
    expect(screen.getAllByText("계약서 자동 전송 실패")).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(3);
  });

  it("sends the action button to the recovery view for that job and closes the popup", async () => {
    const getSummary = mockSummaries(makeSummary());
    const queryClient = renderStack();
    await settleFirstSummary(queryClient);
    getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: ["j-create"] }));
    await refetchSummary(queryClient);

    fireEvent.click(await screen.findByRole("button", { name: "직접 작성하기" }));

    expect(mockPush).toHaveBeenCalledWith("/contracts?recoverJobId=j-create");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("drops the popup of a job the server no longer lists as unresolved", async () => {
    const getSummary = mockSummaries(makeSummary());
    const queryClient = renderStack();
    await settleFirstSummary(queryClient);
    getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: ["j-create", "j-finalize"] }));
    await refetchSummary(queryClient);
    await screen.findByText("검토완료 자동 처리 실패");

    getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: ["j-finalize"] }));
    await refetchSummary(queryClient);

    await waitFor(() => expect(screen.queryByText("계약서 자동 전송 실패")).not.toBeInTheDocument());
    expect(screen.getByText("검토완료 자동 처리 실패")).toBeInTheDocument();
  });

  it("prunes the stored seen-set to the ids the server still lists", async () => {
    const getSummary = mockSummaries(makeSummary({ unresolvedJobIds: ["j-create", "j-finalize"] }));
    const queryClient = renderStack();
    await screen.findByText("확인이 필요한 전자문서 2건");
    expect(JSON.parse(window.sessionStorage.getItem(SEEN_KEY_A) ?? "[]")).toEqual(["j-create", "j-finalize"]);

    getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: ["j-finalize"] }));
    await refetchSummary(queryClient);

    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(SEEN_KEY_A) ?? "[]")).toEqual(["j-finalize"]));
  });

  it("keeps ids seen on one branch from suppressing the same ids on another", async () => {
    const getSummary = mockSummaries(makeSummary({ unresolvedJobIds: ["j-create"] }));
    renderStack();
    fireEvent.click(await screen.findByRole("button", { name: "알림 닫기" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: ["j-create"] }));
    act(() => {
      setBranchCookie("branch-b");
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(await screen.findByText("확인이 필요한 전자문서 1건")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(failureSeenStorageKey("user-1", "branch-b"))).toBe(
      JSON.stringify(["j-create"]),
    );
  });

  it("still works when sessionStorage throws", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mockSummaries(makeSummary({ unresolvedJobIds: ["j-create", "j-finalize"] }));

    renderStack();

    expect(await screen.findByText("확인이 필요한 전자문서 2건")).toBeInTheDocument();
  });

  it("stops asking for details after the list answers twice without the job", async () => {
    jest.useFakeTimers();
    const getSummary = mockSummaries(makeSummary());
    const getJobs = jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList());
    const queryClient = renderStack();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(getSummary).toHaveBeenCalledTimes(1);

    getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: ["j-gone"] }));
    await refetchSummary(queryClient);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText("전자문서 작업 실패")).toBeInTheDocument();

    // Let several list polling intervals pass; it must give up after two answers.
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3_000);
      });
    }
    const callsAfterGivingUp = getJobs.mock.calls.length;
    expect(callsAfterGivingUp).toBeLessThanOrEqual(3);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(9_000);
    });
    expect(getJobs.mock.calls.length).toBe(callsAfterGivingUp);
    expect(screen.getByText("전자문서 작업 실패")).toBeInTheDocument();
  });
});
