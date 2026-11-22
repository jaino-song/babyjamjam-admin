import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { eformsignDocumentJobsQueryKeys } from "@/hooks/useEformsignDocumentJobs";
import { eformsignApi } from "@/services/api";

import { createTestQueryClient, JobsTestWrapper, makeJob, makeJobList, makeSummary, setBranchCookie } from "../testing/jobs-test-utils";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }), usePathname: () => "/dashboard" }));

afterEach(() => { setBranchCookie(null); jest.restoreAllMocks(); });

it("routes a service-record failure popup to the jobs list without offering manual recovery", async () => {
  setBranchCookie("branch-a");
  window.sessionStorage.clear();
  const job = makeJob({ jobId: "service-record", documentKind: "service_record", source: "auto_finalize", status: "requires_attention", recoveryKind: null, recoveryPresentation: null, failureReasonCode: "PRE_SEND_RETRY_EXHAUSTED", retryable: true, cancellable: true, documentId: null });
  const getSummary = jest.spyOn(eformsignApi, "getDocumentJobSummary").mockResolvedValue(makeSummary());
  jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(makeJobList({ requiresAttention: [job] }));
  const open = jest.spyOn(eformsignApi, "openDocumentJobRecovery");
  const claim = jest.spyOn(eformsignApi, "claimDocumentJobRecovery");
  const client = createTestQueryClient();
  render(<JobsTestWrapper queryClient={client}>{null}</JobsTestWrapper>);
  const key = eformsignDocumentJobsQueryKeys.summary("branch-a");
  await waitFor(() => expect(client.getQueryState(key)?.status).toBe("success"));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  getSummary.mockResolvedValue(makeSummary({ unresolvedJobIds: [job.jobId] }));
  await act(async () => { await client.invalidateQueries({ queryKey: key }); });
  expect(await screen.findByText("제공기록지 생성 실패")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "확인하기" }));
  expect(mockPush).toHaveBeenCalledWith("/contracts");
  expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining("recoverJobId"));
  expect(open).not.toHaveBeenCalled();
  expect(claim).not.toHaveBeenCalled();
});
