import { render, renderHook, screen, waitFor } from "@testing-library/react";

import { makeJob, makeJobList } from "@/features/document-jobs/testing/jobs-test-utils";
import { useManualDocumentJobRecovery } from "@/features/document-jobs/useManualDocumentJobRecovery";
import { eformsignApi, type EformsignDocumentJobList } from "@/services/eformsign";

import { DocumentJobRecoveryDialog } from "./DocumentJobRecoveryDialog";

let mockJobs: EformsignDocumentJobList | undefined;
const mockToast = jest.fn();
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
  useDocumentJobs: () => ({ jobs: mockJobs, refetchSummary: jest.fn(), refetchJobs: jest.fn() }),
}));
jest.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => mockToast(...args), useToast: () => ({ toast: mockToast }) }));

const job = makeJob({ documentKind: "service_record", source: "auto_finalize", status: "requires_attention", recoveryKind: null, recoveryPresentation: null, retryable: true, cancellable: true });

beforeEach(() => { mockJobs = undefined; mockToast.mockClear(); });
afterEach(() => jest.restoreAllMocks());

it.each(["listed", "fetched"])("explains %s service-record deep links without opening either recovery endpoint", async source => {
  const jobs = makeJobList({ requiresAttention: [job] });
  if (source === "listed") mockJobs = jobs;
  const getJobs = jest.spyOn(eformsignApi, "getDocumentJobs").mockResolvedValue(jobs);
  const open = jest.spyOn(eformsignApi, "openDocumentJobRecovery");
  const claim = jest.spyOn(eformsignApi, "claimDocumentJobRecovery");
  render(<DocumentJobRecoveryDialog presentation="auto" jobId={job.jobId} hasCreationInProgress={false} onStartFresh={jest.fn()} onViewDocument={jest.fn()} onClose={jest.fn()} data-component="desktop_contracts_test_recovery" />);
  expect(await screen.findByText("제공기록지 작업은 수동 전송 화면을 지원하지 않아요. 전자문서 작업 목록에서 재시도하거나 취소해 주세요.")).toBeInTheDocument();
  expect(screen.queryByText("이미 처리됐거나 찾을 수 없는 작업이에요.")).not.toBeInTheDocument();
  expect(document.querySelector("iframe")).toBeNull();
  expect(getJobs).toHaveBeenCalledTimes(source === "listed" ? 0 : 1);
  expect(open).not.toHaveBeenCalled();
  expect(claim).not.toHaveBeenCalled();
});

it("explains RECOVERY_UNSUPPORTED without implying the job is old or an administrator must manually send it", async () => {
  jest.spyOn(eformsignApi, "openDocumentJobRecovery").mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { code: "RECOVERY_UNSUPPORTED", message: "private detail" } } });
  const onClose = jest.fn();
  renderHook(() => useManualDocumentJobRecovery(job.jobId, onClose));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ variant: "destructive", description: "이 작업은 수동 전송 화면을 지원하지 않아요. 전자문서 작업 목록에서 재시도하거나 취소해 주세요." }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
