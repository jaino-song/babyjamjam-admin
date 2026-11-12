import { act, fireEvent, render, screen } from "@testing-library/react";

import { makeJob, makeJobList } from "@/features/document-jobs/testing/jobs-test-utils";
import { RECOVERY_BRIDGE_CHANNEL } from "@/lib/eformsign/recovery-bridge";
import type { VerifyManualRecoveryResponse } from "@/lib/eformsign/manual-recovery-contract";
import { eformsignApi as legacyApi, type EformsignDocumentJobList } from "@/services/api";
import { eformsignApi } from "@/services/eformsign";

import { DocumentJobRecoveryDialog } from "./DocumentJobRecoveryDialog";

const mockToast = jest.fn();
const mockRefetchSummary = jest.fn();
const mockRefetchJobs = jest.fn();
let mockJobs: EformsignDocumentJobList | undefined;

jest.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
  useDocumentJobs: () => ({ jobs: mockJobs, refetchSummary: mockRefetchSummary, refetchJobs: mockRefetchJobs }),
}));
jest.mock("@/services/eformsign", () => ({
  eformsignApi: { openDocumentJobRecovery: jest.fn(), verifyDocumentJobRecovery: jest.fn() },
}));
jest.mock("@/services/api", () => ({
  eformsignApi: { getDocumentJobs: jest.fn(), claimDocumentJobRecovery: jest.fn(), resolveDocumentJob: jest.fn() },
}));

const jobId = "11111111-1111-4111-8111-111111111111";
const boundJob = makeJob({ jobId, documentId: "document012", recoveryPresentation: "iframe" });
const verified: VerifyManualRecoveryResponse = { kind: "verified", jobId, claimEpoch: "42" };

function renderRecovery(presentation: "auto" | "iframe" = "auto") {
  const onClose = jest.fn();
  const tree = (id = jobId) => <DocumentJobRecoveryDialog
    presentation={presentation} jobId={id} onClose={onClose}
    hasCreationInProgress={false} onStartFresh={jest.fn()} onViewDocument={jest.fn()}
    data-component="desktop_contracts_document-job-recovery"
  />;
  const view = render(tree());
  return { ...view, onClose, poll: () => view.rerender(tree()), changeJob: (id: string) => view.rerender(tree(id)) };
}

async function editorSession() {
  const frame = await screen.findByTitle<HTMLIFrameElement>("이폼사인 수동 전송");
  const nonce = frame.getAttribute("src")!.split("#")[1];
  const post = jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
  const changed = () => act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin, source: frame.contentWindow,
      data: { channel: RECOVERY_BRIDGE_CHANNEL, version: 1, nonce, type: "CHANGED" },
    }));
  });
  return { frame, post, changed };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockJobs = makeJobList({ requiresAttention: [boundJob] });
  jest.mocked(legacyApi.getDocumentJobs).mockResolvedValue(makeJobList());
  jest.mocked(eformsignApi.openDocumentJobRecovery).mockResolvedValue({
    kind: "editable", jobId, claimEpoch: "42", claimExpiresAt: new Date(Date.now() + 60000).toISOString(),
    document: { companyId: "company-abc", templateId: "template_ABC", documentId: "document012" },
  });
});
afterEach(() => jest.restoreAllMocks());

test.each(["auto", "iframe"] as const)("%s finishes live verification after polling reports completed/null recovery", async presentation => {
  let finish!: (value: VerifyManualRecoveryResponse) => void;
  jest.mocked(eformsignApi.verifyDocumentJobRecovery).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderRecovery(presentation);
  const editor = await editorSession();
  editor.changed();
  expect(eformsignApi.verifyDocumentJobRecovery).toHaveBeenCalledTimes(1);
  expect(eformsignApi.verifyDocumentJobRecovery).toHaveBeenCalledWith(jobId, "42");

  mockJobs = makeJobList({ recent: [{ ...boundJob, status: "completed", recoveryKind: null, recoveryPresentation: null }] });
  view.poll();
  expect(screen.getByTitle("이폼사인 수동 전송")).toBe(editor.frame);
  expect(editor.post).not.toHaveBeenCalledWith(expect.objectContaining({ type: "CLOSE" }), expect.anything());
  await act(async () => { finish(verified); });

  expect(mockToast).toHaveBeenCalledTimes(1);
  expect(mockToast).toHaveBeenCalledWith({ variant: "success", description: "전자문서를 전송했어요" });
  expect(mockRefetchSummary).toHaveBeenCalledTimes(1);
  expect(mockRefetchJobs).toHaveBeenCalledTimes(1);
  expect(view.onClose).toHaveBeenCalledTimes(1);
  expect(eformsignApi.openDocumentJobRecovery).toHaveBeenCalledTimes(1);
  expect(legacyApi.claimDocumentJobRecovery).not.toHaveBeenCalled();
  expect(legacyApi.resolveDocumentJob).not.toHaveBeenCalled();
});

test("keeps the selected legacy dialog mounted when polling changes its presentation", async () => {
  const job = { ...boundJob, recoveryPresentation: "legacy" as const, recoveryKind: "verify_result" as const };
  mockJobs = makeJobList({ requiresAttention: [job] });
  jest.mocked(legacyApi.claimDocumentJobRecovery).mockResolvedValue({ job, recoveryKind: "verify_result", payload: null, claimExpiresAt: null });
  const view = renderRecovery();
  await screen.findByRole("dialog", { name: "전자문서 결과 확인 필요" });
  mockJobs = makeJobList({ requiresAttention: [boundJob] });
  view.poll();
  expect(screen.getByRole("dialog", { name: "전자문서 결과 확인 필요" })).toBeInTheDocument();
  expect(legacyApi.claimDocumentJobRecovery).toHaveBeenCalledTimes(1);
  expect(eformsignApi.openDocumentJobRecovery).not.toHaveBeenCalled();
});

test.each(["job-change", "unmount", "close"] as const)("%s cancels pending routed verification", async ending => {
  let finish!: (value: VerifyManualRecoveryResponse) => void;
  jest.mocked(eformsignApi.verifyDocumentJobRecovery).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = renderRecovery();
  const editor = await editorSession();
  editor.changed();
  if (ending === "job-change") {
    mockJobs = makeJobList({ requiresAttention: [makeJob({ jobId: "unsupported", recoveryPresentation: undefined })] });
    view.changeJob("unsupported");
    await screen.findByText("작업을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
  } else if (ending === "close") fireEvent.click(screen.getByRole("button", { name: "Close" }));
  else view.unmount();
  await act(async () => { finish(verified); });
  expect(mockToast).not.toHaveBeenCalled();
  expect(mockRefetchSummary).not.toHaveBeenCalled();
  expect(mockRefetchJobs).not.toHaveBeenCalled();
  expect(view.onClose).toHaveBeenCalledTimes(ending === "close" ? 1 : 0);
  expect(eformsignApi.openDocumentJobRecovery).toHaveBeenCalledTimes(1);
  expect(legacyApi.claimDocumentJobRecovery).not.toHaveBeenCalled();
  expect(screen.queryByTitle("이폼사인 수동 전송")).not.toBeInTheDocument();
});

test("closing and reopening the same job selects fresh metadata", async () => {
  const first = renderRecovery();
  await editorSession();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  first.unmount();
  mockJobs = makeJobList({ recent: [{ ...boundJob, status: "completed", recoveryKind: null, recoveryPresentation: null }] });
  renderRecovery();
  await screen.findByText("이미 처리됐거나 찾을 수 없는 작업이에요.");
  expect(eformsignApi.openDocumentJobRecovery).toHaveBeenCalledTimes(1);
  expect(legacyApi.claimDocumentJobRecovery).not.toHaveBeenCalled();
});

test.each(["loading", "unavailable"] as const)("does not latch %s before safe metadata arrives", async initial => {
  mockJobs = initial === "loading" ? undefined : makeJobList({ requiresAttention: [{ ...boundJob, recoveryPresentation: undefined }] });
  jest.mocked(legacyApi.getDocumentJobs).mockReturnValue(new Promise(() => {}));
  const view = renderRecovery();
  if (initial === "loading") expect(screen.getByRole("status", { name: "작업 불러오는 중" })).toBeInTheDocument();
  else expect(screen.getByText("작업을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
  expect(eformsignApi.openDocumentJobRecovery).not.toHaveBeenCalled();
  expect(legacyApi.claimDocumentJobRecovery).not.toHaveBeenCalled();
  mockJobs = makeJobList({ requiresAttention: [boundJob] });
  view.poll();
  await editorSession();
  expect(eformsignApi.openDocumentJobRecovery).toHaveBeenCalledTimes(1);
});
