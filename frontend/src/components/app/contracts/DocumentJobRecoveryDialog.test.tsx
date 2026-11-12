import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";

import { makeJob, makeJobList } from "@/features/document-jobs/testing/jobs-test-utils";
import { eformsignApi, type ClaimEformsignDocumentJobRecoveryResponse, type EformsignDocumentJobList } from "@/services/api";

import {
  DocumentJobRecoveryDialog,
  type DocumentJobRecoveryDialogProps,
} from "./DocumentJobRecoveryDialog";

const mockRefetchSummary = jest.fn();
const mockRefetchJobs = jest.fn();
const mockToast = jest.fn();

let mockJobList: EformsignDocumentJobList | undefined;

jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
  useDocumentJobs: () => ({ refetchSummary: mockRefetchSummary, refetchJobs: mockRefetchJobs, jobs: mockJobList }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }), toast: (...args: unknown[]) => mockToast(...args) }));

const CONTRACT_DATA = {
  customerName: "김하늘",
  customerContact: "010-1234-5678",
  caretaker1Name: "박관리",
  type: "A-가1",
  days: "10",
  area: "인천",
  contractDuration: "2026-11-01 ~ 2026-11-14",
  startDate: "2026-11-01",
  endDate: "2026-11-14",
  fullPrice: "1500000",
  grant: "1000000",
  actualPrice: "500000",
};

function createClaim(
  overrides: Partial<ClaimEformsignDocumentJobRecoveryResponse> = {},
  jobOverrides: Parameters<typeof makeJob>[0] = {},
): ClaimEformsignDocumentJobRecoveryResponse {
  return {
    job: makeJob({ jobId: "job-1", jobType: "create_document", status: "failed", ...jobOverrides }),
    recoveryKind: "manual_send",
    payload: { clientId: 7, contractData: CONTRACT_DATA, supersedeDocumentId: "old-doc" },
    claimExpiresAt: "2026-11-01T01:10:00.000Z",
    ...overrides,
  };
}

function httpError(status: number, data: Record<string, unknown> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
}

function networkError() {
  return Object.assign(new Error("Network Error"), { isAxiosError: true });
}

let claimSpy: jest.SpyInstance;
let resolveSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let finalizeSpy: jest.SpyInstance;

function renderDialog(props: Partial<DocumentJobRecoveryDialogProps> = {}, wrap?: (node: ReactElement) => ReactElement) {
  const onClose = jest.fn();
  const onStartFresh = jest.fn();
  const onViewDocument = jest.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <DocumentJobRecoveryDialog
        jobId="job-1"
        hasCreationInProgress={false}
        onStartFresh={onStartFresh}
        onViewDocument={onViewDocument}
        onClose={onClose}
        resolveRetryDelayMs={0}
        {...props}
      />
    </QueryClientProvider>
  );
  const result = render(wrap ? wrap(tree) : tree);
  return { ...result, onClose, onStartFresh, onViewDocument, tree };
}

function getSummary(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-slot="document-job-recovery-summary"]') as HTMLElement;
}

const button = (name: string | RegExp) => screen.findByRole("button", { name });

const EXPIRED_NEUTRAL = "보관 기간(7일)이 지나 저장된 내용이 없어요.";
const EXPIRED_CREATE = "보관 기간(7일)이 지나 저장된 내용이 없어요. 새로 작성하면 이 작업은 처리됨으로 닫혀요.";
const EXPIRED_FINALIZE =
  "보관 기간(7일)이 지나 저장된 내용이 없어요. 처리됨으로 표시한 뒤 계약서에서 검토완료를 다시 눌러 주세요.";
const OPEN_LABEL = "처리됨으로 표시하고 계약서 열기";

/** Call order across spies and callbacks, to prove resolve happens before the form opens. */
function trackOrder(onStartFresh: jest.Mock, onViewDocument?: jest.Mock): string[] {
  const order: string[] = [];
  resolveSpy.mockImplementation(async () => {
    order.push("resolve");
    return { job: makeJob({ jobId: "job-1" }), alreadyResolved: false };
  });
  onStartFresh.mockImplementation(() => order.push("startFresh"));
  onViewDocument?.mockImplementation(() => order.push("viewDocument"));
  return order;
}

function finalizeClaim(jobOverrides: Parameters<typeof makeJob>[0] = {}, overrides: Partial<ClaimEformsignDocumentJobRecoveryResponse> = {}) {
  return createClaim(
    { payload: { documentId: "doc-9", prefillEndDate: "2026-11-30" }, ...overrides },
    { jobType: "finalize_document", ...jobOverrides },
  );
}

/** Clicks inside act so the async resolve chain it starts settles before the next assertion. */
async function clickButton(target: HTMLElement) {
  await act(async () => {
    fireEvent.click(target);
  });
}

async function openConfirmAndApprove(openLabel: string | RegExp, approveLabel: string | RegExp) {
  fireEvent.click(await button(openLabel));
  const approve = await screen.findByRole("button", { name: approveLabel });
  await act(async () => {
    fireEvent.click(approve);
  });
}

describe("DocumentJobRecoveryDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJobList = undefined;
    claimSpy = jest.spyOn(eformsignApi, "claimDocumentJobRecovery").mockResolvedValue(createClaim());
    resolveSpy = jest.spyOn(eformsignApi, "resolveDocumentJob").mockResolvedValue({
      job: makeJob({ jobId: "job-1" }),
      alreadyResolved: false,
    });
    createSpy = jest
      .spyOn(eformsignApi, "enqueueDocumentCreation")
      .mockResolvedValue({ jobId: "job-2", status: "queued", existing: false });
    finalizeSpy = jest
      .spyOn(eformsignApi, "enqueueDocumentFinalization")
      .mockResolvedValue({ jobId: "job-2", status: "queued", existing: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("routed metadata retry", () => {
    const unavailableCopy = "작업을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
    const goneCopy = "이미 처리됐거나 찾을 수 없는 작업이에요.";
    const base = "desktop_contracts_panel_document-job-recovery";
    const jobId = "11111111-1111-4111-8111-111111111111";
    function metadataJob(overrides: Parameters<typeof makeJob>[0] = {}) {
      return makeJob({ jobId, ...overrides });
    }
    let lookupSpy: jest.SpyInstance;
    let openSpy: jest.SpyInstance;

    function deferredLookup() {
      let finish!: (list: EformsignDocumentJobList) => void;
      const promise = new Promise<EformsignDocumentJobList>(resolve => { finish = resolve; });
      return { promise, finish };
    }

    function renderRouted() {
      const onClose = jest.fn(), onStartFresh = jest.fn(), onViewDocument = jest.fn();
      const tree = (id = jobId) => <DocumentJobRecoveryDialog
        presentation="auto" jobId={id} hasCreationInProgress={false}
        onClose={onClose} onStartFresh={onStartFresh} onViewDocument={onViewDocument}
        data-component={base}
      />;
      const view = render(tree());
      return { ...view, onClose, onStartFresh, onViewDocument, poll: () => view.rerender(tree()), changeJob: (id: string) => view.rerender(tree(id)) };
    }

    function expectNoRecovery() {
      expect(claimSpy).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
    }

    beforeEach(() => {
      lookupSpy = jest.spyOn(eformsignApi, "getDocumentJobs").mockRejectedValue(networkError());
      openSpy = jest.spyOn(eformsignApi, "openDocumentJobRecovery").mockImplementation(async jobId => ({
        kind: "editable", jobId, claimEpoch: "42", claimExpiresAt: new Date(Date.now() + 60000).toISOString(),
        document: { companyId: "company-abc", templateId: "template_ABC", documentId: "document012" },
      }));
    });

    it("shares one in-flight metadata lookup under StrictMode and accepts its safe result", async () => {
      const pending = deferredLookup();
      lookupSpy.mockReturnValue(pending.promise);
      renderDialog({ presentation: "auto" }, node => <StrictMode>{node}</StrictMode>);
      expect(lookupSpy).toHaveBeenCalledTimes(1);
      expectNoRecovery();
      await act(async () => { pending.finish(makeJobList({ requiresAttention: [makeJob({ recoveryPresentation: "legacy" })] })); });
      expect(await button("새로 작성")).toBeInTheDocument();
      expect(claimSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it.each(["iframe", "legacy"] as const)("retries a failed lookup and routes fresh %s metadata over a stale unknown list row", async presentation => {
      const view = renderRouted();
      await screen.findByText(unavailableCopy);
      expectNoRecovery();
      mockJobList = makeJobList({ requiresAttention: [metadataJob()] });
      view.poll();
      lookupSpy.mockResolvedValueOnce(makeJobList({ requiresAttention: [metadataJob({ recoveryPresentation: presentation })] }));

      await clickButton(await button("다시 시도"));

      if (presentation === "iframe") {
        const frame = await screen.findByTitle<HTMLIFrameElement>("이폼사인 수동 전송");
        jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
        expect(frame).toBeInTheDocument();
        expect(openSpy).toHaveBeenCalledTimes(1);
        expect(claimSpy).not.toHaveBeenCalled();
      } else {
        expect(await button("새로 작성")).toBeInTheDocument();
        expect(claimSpy).toHaveBeenCalledTimes(1);
        expect(openSpy).not.toHaveBeenCalled();
      }
      expect(lookupSpy).toHaveBeenCalledTimes(2);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
      expect(view.onStartFresh).not.toHaveBeenCalled();
      expect(view.onViewDocument).not.toHaveBeenCalled();
      view.unmount();
    });

    it("keeps retry available through lookup failures and unknown metadata without entering recovery", async () => {
      mockJobList = makeJobList({ requiresAttention: [metadataJob()] });
      const view = renderRouted();
      expect(lookupSpy).not.toHaveBeenCalled();
      await clickButton(await button("다시 시도"));
      expect(await screen.findByText(unavailableCopy)).toHaveClass("text-[calc(14px*var(--glint-ui-scale,1))]", "text-v3-text");
      expect(screen.getByRole("button", { name: "다시 시도" })).toHaveAttribute("data-component", `${base}_retry-metadata`);
      lookupSpy.mockResolvedValueOnce(makeJobList({ requiresAttention: [metadataJob()] }));
      await clickButton(await button("다시 시도"));
      expect(await screen.findByText(unavailableCopy)).toBeInTheDocument();
      lookupSpy.mockRejectedValueOnce(networkError());
      await clickButton(await button("다시 시도"));
      expect(lookupSpy).toHaveBeenCalledTimes(3);
      expectNoRecovery();
      expect(view.onStartFresh).not.toHaveBeenCalled();
      expect(view.onViewDocument).not.toHaveBeenCalled();
    });

    it.each([
      metadataJob({ recoveryPresentation: null }),
      metadataJob({ status: "completed", recoveryKind: null }),
      metadataJob({ source: "auto_finalize" }),
    ])("offers no retry for known nonrecoverable metadata: %j", async job => {
      mockJobList = makeJobList({ recent: [job] });
      renderRouted();
      expect(await screen.findByText(goneCopy)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
      expect(lookupSpy).not.toHaveBeenCalled();
      expectNoRecovery();
    });

    it("stops offering retry when fresh metadata confirms the job is no longer recoverable", async () => {
      mockJobList = makeJobList({ requiresAttention: [metadataJob()] });
      renderRouted();
      await screen.findByText(unavailableCopy);
      lookupSpy.mockResolvedValueOnce(makeJobList({ recent: [metadataJob({ status: "completed", recoveryKind: null, recoveryPresentation: null })] }));
      await clickButton(await button("다시 시도"));
      expect(await screen.findByText(goneCopy)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
      expectNoRecovery();
    });

    it("shows centered pending feedback and disables retry while one read-only request is running", async () => {
      const pending = deferredLookup();
      lookupSpy.mockReturnValueOnce(pending.promise);
      renderRouted();
      expect(screen.getByRole("status", { name: "작업 불러오는 중" })).toHaveClass("flex", "min-h-24", "items-center", "justify-center");
      await act(async () => { pending.finish(makeJobList({ requiresAttention: [metadataJob()] })); });
      const retry = await button("다시 시도");
      const retried = deferredLookup();
      lookupSpy.mockReturnValueOnce(retried.promise);
      act(() => { fireEvent.click(retry); fireEvent.click(retry); });
      expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "다시 시도" })).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status", { name: "작업 불러오는 중" })).toBeInTheDocument();
      expect(lookupSpy).toHaveBeenCalledTimes(2);
      expectNoRecovery();
      await act(async () => { retried.finish(makeJobList({ requiresAttention: [metadataJob()] })); });
      expect(await button("다시 시도")).toBeEnabled();
    });

    it("allows safe polling metadata after an unknown retry and keeps that first safe selection", async () => {
      mockJobList = makeJobList({ requiresAttention: [metadataJob()] });
      const view = renderRouted();
      lookupSpy.mockResolvedValueOnce(makeJobList({ requiresAttention: [metadataJob()] }));
      await clickButton(await button("다시 시도"));
      expectNoRecovery();
      mockJobList = makeJobList({ requiresAttention: [metadataJob({ recoveryPresentation: "iframe" })] });
      view.poll();
      const frame = await screen.findByTitle<HTMLIFrameElement>("이폼사인 수동 전송");
      jest.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => {});
      mockJobList = makeJobList({ requiresAttention: [metadataJob({ recoveryPresentation: "legacy" })] });
      view.poll();
      expect(screen.getByTitle("이폼사인 수동 전송")).toBe(frame);
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(claimSpy).not.toHaveBeenCalled();
      view.unmount();
    });

    it("uses a known nonrecoverable poll update after an unknown lookup", async () => {
      mockJobList = makeJobList({ requiresAttention: [metadataJob()] });
      const view = renderRouted();
      lookupSpy.mockResolvedValueOnce(makeJobList({ requiresAttention: [metadataJob()] }));
      await clickButton(await button("다시 시도"));
      mockJobList = makeJobList({ recent: [metadataJob({ status: "completed", recoveryKind: null, recoveryPresentation: null })] });
      view.poll();
      expect(await screen.findByText(goneCopy)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
      expectNoRecovery();
    });

    it.each(["close", "escape", "unmount", "job-change"] as const)("ignores retry responses after %s and resets a newly opened job", async ending => {
      mockJobList = makeJobList({ requiresAttention: [metadataJob()] });
      const view = renderRouted();
      const pending = deferredLookup();
      lookupSpy.mockReturnValueOnce(pending.promise);
      fireEvent.click(await button("다시 시도"));
      if (ending === "close") fireEvent.click(screen.getByRole("button", { name: "닫기" }));
      else if (ending === "escape") fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      else if (ending === "unmount") view.unmount();
      else {
        mockJobList = makeJobList({ requiresAttention: [metadataJob({ jobId: "job-2" })] });
        view.changeJob("job-2");
      }
      await act(async () => { pending.finish(makeJobList({ requiresAttention: [metadataJob({ recoveryPresentation: "iframe" })] })); });
      expectNoRecovery();
      expect(view.onClose).toHaveBeenCalledTimes(ending === "close" || ending === "escape" ? 1 : 0);
      if (ending !== "job-change") {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        view.unmount();
        mockJobList = makeJobList({ requiresAttention: [metadataJob()] });
        renderRouted();
      }
      expect(screen.getByText(unavailableCopy)).toBeInTheDocument();
      expect(await button("다시 시도")).toBeEnabled();
    });
  });

  describe("claim", () => {
    it("claims the job once even under StrictMode", async () => {
      renderDialog({}, (node) => <StrictMode>{node}</StrictMode>);

      expect(await button("새로 작성")).toBeInTheDocument();
      expect(claimSpy).toHaveBeenCalledTimes(1);
      expect(claimSpy).toHaveBeenCalledWith("job-1");
    });

    it.each([
      [
        "409 claimed",
        httpError(409, { code: "MANUAL_RECOVERY_CLAIMED", expiresAt: "2026-11-01T01:10:00.000Z" }),
        /다른 곳에서 처리 중이에요\. \d{2}:\d{2} 이후 다시 시도해 주세요\./,
      ],
      ["410 expired, job unknown", httpError(410, { code: "RECOVERY_PAYLOAD_EXPIRED" }), EXPIRED_NEUTRAL],
      ["403", httpError(403), "이 작업은 관리자 권한이 필요해요. 지점 관리자에게 요청해 주세요."],
      ["404", httpError(404, { code: "RESOURCE_NOT_FOUND" }), "이미 처리됐거나 찾을 수 없는 작업이에요."],
      ["409 not recoverable", httpError(409, { code: "JOB_NOT_RECOVERABLE", status: "completed" }), "이미 처리됐거나 찾을 수 없는 작업이에요."],
    ])("shows the matching copy for %s", async (_label, error, copy) => {
      claimSpy.mockReset().mockRejectedValue(error);
      renderDialog();

      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("refreshes the jobs list when the job is already gone", async () => {
      claimSpy.mockReset().mockRejectedValue(httpError(404));
      renderDialog();

      await screen.findByText("이미 처리됐거나 찾을 수 없는 작업이에요.");
      expect(mockRefetchSummary).toHaveBeenCalled();
      expect(mockRefetchJobs).toHaveBeenCalled();
    });

    it("offers 목록에서 닫기 for an expired payload, and closing resolves the job", async () => {
      mockJobList = makeJobList({ requiresAttention: [makeJob({ jobId: "job-1", jobType: "create_document" })] });
      claimSpy.mockReset().mockRejectedValue(httpError(410, { code: "RECOVERY_PAYLOAD_EXPIRED" }));
      const { onClose, onStartFresh } = renderDialog();

      fireEvent.click(await button("목록에서 닫기"));

      await waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(createSpy).not.toHaveBeenCalled();
      expect(onStartFresh).not.toHaveBeenCalled();
    });

    it("resolves the expired create job before starting a fresh form", async () => {
      mockJobList = makeJobList({ requiresAttention: [makeJob({ jobId: "job-1", jobType: "create_document" })] });
      claimSpy.mockReset().mockRejectedValue(httpError(410));
      const { onClose, onStartFresh } = renderDialog();
      const order = trackOrder(onStartFresh);

      expect(await screen.findByText(EXPIRED_CREATE)).toBeInTheDocument();
      await clickButton(await button("새로 작성"));

      await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
      expect(order).toEqual(["resolve", "startFresh"]);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("finds the expired job in the recent list when it is no longer awaiting attention", async () => {
      mockJobList = makeJobList({ recent: [makeJob({ jobId: "job-1", jobType: "create_document" })] });
      claimSpy.mockReset().mockRejectedValue(httpError(410));
      renderDialog();

      expect(await screen.findByText(EXPIRED_CREATE)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "새로 작성" })).toBeInTheDocument();
    });

    it("opens the contract of an expired finalize job after resolving it, with no 새로 작성", async () => {
      mockJobList = makeJobList({
        requiresAttention: [makeJob({ jobId: "job-1", jobType: "finalize_document", documentId: "doc-9" })],
      });
      claimSpy.mockReset().mockRejectedValue(httpError(410));
      const { onClose, onStartFresh, onViewDocument } = renderDialog();
      const order = trackOrder(onStartFresh, onViewDocument);

      expect(await screen.findByText(EXPIRED_FINALIZE)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "목록에서 닫기" })).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));
      });

      await waitFor(() => expect(onViewDocument).toHaveBeenCalledWith("doc-9"));
      expect(order).toEqual(["resolve", "viewDocument"]);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith({
        variant: "success",
        description: "처리됨으로 표시했어요. 계약서에서 검토완료를 다시 눌러 주세요.",
      });
    });

    it.each([
      ["the jobs list does not hold the job", undefined],
      ["the job is an expired finalize job without a document id", makeJobList({ requiresAttention: [makeJob({ jobId: "job-1", jobType: "finalize_document", documentId: null })] })],
      ["the jobs list holds only other jobs", makeJobList({ requiresAttention: [makeJob({ jobId: "other", jobType: "create_document" })] })],
    ])("fails closed on 410 when %s: only 닫기 and 목록에서 닫기", async (_label, list) => {
      mockJobList = list;
      claimSpy.mockReset().mockRejectedValue(httpError(410));
      renderDialog();

      expect(await screen.findByText(EXPIRED_NEUTRAL)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "닫기" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "목록에서 닫기" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: OPEN_LABEL })).not.toBeInTheDocument();
    });

    it("fails closed on a payload it cannot trust", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim({ payload: { clientId: "7", contractData: CONTRACT_DATA } }),
      );
      renderDialog();

      expect(await screen.findByText(EXPIRED_CREATE)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "새로 작성" })).toBeInTheDocument();
    });

    it("treats a finalization payload with prefillAmounts as malformed, and offers no 새로 작성", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim(
          { payload: { documentId: "doc-9", prefillEndDate: "2026-11-30", prefillAmounts: { fullPrice: "1" } } },
          { jobType: "finalize_document" },
        ),
      );
      renderDialog();

      expect(await screen.findByText(EXPIRED_NEUTRAL)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: OPEN_LABEL })).not.toBeInTheDocument();
    });

    it("opens the contract for a malformed finalization payload when the job knows its document", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim(
          { payload: { documentId: "doc-9", prefillAmounts: { fullPrice: "1" } } },
          { jobType: "finalize_document", documentId: "doc-9" },
        ),
      );
      renderDialog();

      expect(await screen.findByText(EXPIRED_FINALIZE)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: OPEN_LABEL })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
    });

    it("lets staff retry when the claim itself could not be loaded", async () => {
      claimSpy.mockReset().mockRejectedValueOnce(networkError()).mockResolvedValue(createClaim());
      renderDialog();

      fireEvent.click(await button("다시 시도"));

      expect(await screen.findByText("자동 전송이 끝내 실패했어요. 아무것도 전송되지 않았어요.")).toBeInTheDocument();
      expect(claimSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("manual_send", () => {
    it("shows the non-delivery copy and the saved input read-only, with exactly two actions", async () => {
      renderDialog();

      expect(await screen.findByText("자동 전송이 끝내 실패했어요. 아무것도 전송되지 않았어요.")).toBeInTheDocument();
      const summary = getSummary();
      expect(summary).toHaveTextContent("김하늘");
      expect(summary).toHaveTextContent("2026-11-01 ~ 2026-11-14");
      expect(summary).toHaveTextContent("1,500,000원");
      expect(summary).toHaveTextContent("500,000원");
      expect(summary).toHaveTextContent("기존 계약서를 대체해요");
      expect(summary.querySelector("input, textarea, select")).toBeNull();

      const footerButtons = screen
        .getAllByRole("button")
        .map((node) => node.textContent?.trim())
        .filter((text) => text === "새로 작성" || text === "처리됨으로 표시" || text?.includes("다시 보내기"));
      expect(screen.getByText("새로 작성하면 이 작업은 처리됨으로 닫혀요.")).toBeInTheDocument();
      expect(footerButtons).toEqual(["새로 작성", "처리됨으로 표시"]);
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
      expect(claimSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it("shows the saved finalization input read-only, with no 새로 작성 and a way to open the contract", async () => {
      claimSpy.mockReset().mockResolvedValue(finalizeClaim({ documentId: "doc-9" }));
      renderDialog();

      await screen.findByText("검토완료 자동 처리가 끝내 실패했어요. 아무것도 전송되지 않았어요.");
      expect(screen.queryByText("새로 작성하면 이 작업은 처리됨으로 닫혀요.")).not.toBeInTheDocument();
      const summary = getSummary();
      expect(summary).toHaveTextContent("doc-9");
      expect(summary).toHaveTextContent("2026-11-30");
      expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "처리됨으로 표시" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: OPEN_LABEL })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it("takes the document id of a finalize job from its saved input when the job row has none", async () => {
      claimSpy.mockReset().mockResolvedValue(finalizeClaim({ documentId: null }));
      const { onViewDocument, onClose } = renderDialog();

      await clickButton(await button(OPEN_LABEL));

      await waitFor(() => expect(onViewDocument).toHaveBeenCalledWith("doc-9"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("resolves a finalize job before opening its contract", async () => {
      claimSpy.mockReset().mockResolvedValue(finalizeClaim({ documentId: "doc-9" }));
      const { onViewDocument, onClose, onStartFresh } = renderDialog();
      const order = trackOrder(onStartFresh, onViewDocument);

      await clickButton(await button(OPEN_LABEL));

      await waitFor(() => expect(onViewDocument).toHaveBeenCalledWith("doc-9"));
      expect(order).toEqual(["resolve", "viewDocument"]);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith({
        variant: "success",
        description: "처리됨으로 표시했어요. 계약서에서 검토완료를 다시 눌러 주세요.",
      });
      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["a 409", httpError(409, { code: "JOB_NOT_RECOVERABLE", status: "completed" }), "이미 처리됐거나 찾을 수 없는 작업이에요."],
      ["a final 5xx", httpError(502), "처리됨으로 표시하지 못했어요. 다시 시도해 주세요."],
    ])("keeps the dialog open and opens no contract when resolving ends in %s", async (_label, error, copy) => {
      claimSpy.mockReset().mockResolvedValue(finalizeClaim({ documentId: "doc-9" }));
      resolveSpy.mockReset().mockRejectedValue(error);
      const { onViewDocument, onClose } = renderDialog();

      await clickButton(await button(OPEN_LABEL));

      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(onViewDocument).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("offers only 처리됨으로 표시 when a finalize job has no document id to open", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim({ payload: { documentId: "", prefillEndDate: "2026-11-30" } }, { jobType: "finalize_document", documentId: null }),
      );
      renderDialog();

      await screen.findByText(EXPIRED_NEUTRAL);
      expect(screen.queryByRole("button", { name: OPEN_LABEL })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
    });

    it("keeps the dialog open and never opens a form when resolving a create job fails before 새로 작성", async () => {
      resolveSpy.mockReset().mockRejectedValue(httpError(409, { code: "JOB_NOT_RECOVERABLE", status: "completed" }));
      const { onStartFresh, onClose } = renderDialog();

      await clickButton(await button("새로 작성"));

      expect(await screen.findByText("이미 처리됐거나 찾을 수 없는 작업이에요.")).toBeInTheDocument();
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "새로 작성" })).toBeEnabled();
    });

    it("keeps the dialog open and never opens a form when resolving still fails after the automatic retries", async () => {
      resolveSpy.mockReset().mockRejectedValue(httpError(503));
      const { onStartFresh, onClose } = renderDialog();

      await clickButton(await button("새로 작성"));

      expect(await screen.findByText("처리됨으로 표시하지 못했어요. 다시 시도해 주세요.")).toBeInTheDocument();
      expect(resolveSpy).toHaveBeenCalledTimes(4);
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("resolve", () => {
    it("retries network errors and 5xx before marking the job handled", async () => {
      resolveSpy
        .mockReset()
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(httpError(502))
        .mockResolvedValue({ job: makeJob(), alreadyResolved: false });
      const { onClose } = renderDialog();

      await openConfirmAndApprove("처리됨으로 표시", "처리됨으로 표시");

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(resolveSpy).toHaveBeenCalledTimes(3);
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it("offers 처리됨 표시 다시 시도 after four failures, and retrying only resolves", async () => {
      resolveSpy.mockReset().mockRejectedValue(networkError());
      const { onClose } = renderDialog();

      await openConfirmAndApprove("처리됨으로 표시", "처리됨으로 표시");

      expect(await screen.findByText("처리됨으로 표시하지 못했어요. 다시 시도해 주세요.")).toBeInTheDocument();
      expect(resolveSpy).toHaveBeenCalledTimes(4);
      expect(onClose).not.toHaveBeenCalled();

      resolveSpy.mockReset().mockResolvedValue({ job: makeJob(), alreadyResolved: false });
      await openConfirmAndApprove("처리됨 표시 다시 시도", "처리됨으로 표시");

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it.each([
      [409, { code: "JOB_NOT_RECOVERABLE", status: "completed" }, "이미 처리됐거나 찾을 수 없는 작업이에요."],
      [404, { code: "RESOURCE_NOT_FOUND" }, "이미 처리됐거나 찾을 수 없는 작업이에요."],
      [409, { code: "MANUAL_RECOVERY_CLAIMED", expiresAt: "2026-11-01T01:10:00.000Z" }, /다른 곳에서 처리 중이에요\./],
    ])("stops on %s without retrying and shows the matching copy", async (status, body, copy) => {
      resolveSpy.mockReset().mockRejectedValue(httpError(status, body));
      const { onClose } = renderDialog();

      await openConfirmAndApprove("처리됨으로 표시", "처리됨으로 표시");

      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(mockRefetchSummary).toHaveBeenCalled();
    });

    it("marks a job handled after a confirm, and nothing is resolved before it", async () => {
      const { onClose } = renderDialog();

      fireEvent.click(await button("처리됨으로 표시"));
      await screen.findByText("이 작업을 목록에서 정리해요. 계약서를 다시 보내지는 않아요.");
      expect(resolveSpy).not.toHaveBeenCalled();
      await clickButton(await screen.findByRole("button", { name: "처리됨으로 표시" }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
    });
  });

  describe("verify_result", () => {
    beforeEach(() => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim({ recoveryKind: "verify_result", payload: null }, { documentId: "doc-5", status: "requires_attention" }),
      );
    });

    it("explains the unknown outcome and offers no resend", async () => {
      renderDialog();

      expect(await screen.findByText("전자문서 결과 확인 필요")).toBeInTheDocument();
      expect(
        screen.getByText(
          "자동 처리 중 응답이 끊겨 eformsign에 전송됐는지 확인하지 못했어요. 중복 전송을 막기 위해 다시 보내지 않아요.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it("opens the contract when the job knows its document", async () => {
      const { onViewDocument, onClose } = renderDialog();

      fireEvent.click(await button("계약서 보기"));

      expect(onViewDocument).toHaveBeenCalledWith("doc-5");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("hides 계약서 보기 when the job has no document", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim({ recoveryKind: "verify_result", payload: null }, { documentId: null }),
      );
      renderDialog();

      await screen.findByText("전자문서 결과 확인 필요");
      expect(screen.queryByRole("button", { name: "계약서 보기" })).not.toBeInTheDocument();
    });

    it("resolves only after a confirm", async () => {
      const { onClose } = renderDialog();

      fireEvent.click(await button("처리됨으로 표시"));
      expect(resolveSpy).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole("button", { name: "처리됨으로 표시" }));

      await waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("asks whether the contract was verified as unsent, then resolves before starting fresh", async () => {
      const { onStartFresh, onClose } = renderDialog();
      const order = trackOrder(onStartFresh);
      const confirmText =
        "eformsign에서 이 계약서가 전송되지 않은 것을 확인했나요? 확인하면 이 작업은 처리됨으로 닫히고 새 작성 화면이 열려요.";

      fireEvent.click(await button("새로 작성"));
      expect(await screen.findByText(confirmText)).toBeInTheDocument();
      expect(onStartFresh).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "취소" }));
      await waitFor(() => expect(screen.queryByText(confirmText)).not.toBeInTheDocument());
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(resolveSpy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
      await clickButton(await screen.findByRole("button", { name: "확인했어요" }));

      await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
      expect(order).toEqual(["resolve", "startFresh"]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps the dialog open and never opens a form when the verify-fresh resolve fails", async () => {
      resolveSpy.mockReset().mockRejectedValue(httpError(404, { code: "RESOURCE_NOT_FOUND" }));
      const { onStartFresh, onClose } = renderDialog();

      fireEvent.click(await button("새로 작성"));
      await clickButton(await screen.findByRole("button", { name: "확인했어요" }));

      expect(await screen.findByText("이미 처리됐거나 찾을 수 없는 작업이에요.")).toBeInTheDocument();
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("offers 계약서 보기 and 처리됨으로 표시 but no 새로 작성 for a finalize job", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim(
          { recoveryKind: "verify_result", payload: null },
          { jobType: "finalize_document", documentId: "doc-5", status: "requires_attention" },
        ),
      );
      renderDialog();

      await screen.findByText("전자문서 결과 확인 필요");
      expect(screen.getByRole("button", { name: "계약서 보기" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "처리됨으로 표시" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "새로 작성" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: OPEN_LABEL })).not.toBeInTheDocument();
      expect(resolveSpy).not.toHaveBeenCalled();
    });
  });

  describe("새로 작성", () => {
    it("resolves the old job before starting a fresh form", async () => {
      const { onStartFresh, onClose } = renderDialog();
      const order = trackOrder(onStartFresh);

      await clickButton(await button("새로 작성"));

      await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
      expect(order).toEqual(["resolve", "startFresh"]);
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("confirms before discarding a creation in progress, resolves, then starts fresh", async () => {
      const { onStartFresh, onClose } = renderDialog({ hasCreationInProgress: true });
      const order = trackOrder(onStartFresh);

      fireEvent.click(await button("새로 작성"));
      expect(await screen.findByText("작성 중인 계약서를 버리고 새로 작성할까요?")).toBeInTheDocument();
      expect(onStartFresh).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "취소" }));
      await waitFor(() =>
        expect(screen.queryByText("작성 중인 계약서를 버리고 새로 작성할까요?")).not.toBeInTheDocument(),
      );
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(resolveSpy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
      await clickButton(await screen.findByRole("button", { name: "버리고 새로 작성" }));

      await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
      expect(order).toEqual(["resolve", "startFresh"]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps a creation in progress when the resolve behind the discard confirm fails", async () => {
      resolveSpy.mockReset().mockRejectedValue(httpError(409, { code: "JOB_NOT_RECOVERABLE", status: "completed" }));
      const { onStartFresh, onClose } = renderDialog({ hasCreationInProgress: true });

      fireEvent.click(await button("새로 작성"));
      await clickButton(await screen.findByRole("button", { name: "버리고 새로 작성" }));

      expect(await screen.findByText("이미 처리됐거나 찾을 수 없는 작업이에요.")).toBeInTheDocument();
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
