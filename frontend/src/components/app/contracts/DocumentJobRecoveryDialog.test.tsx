import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";

import { makeJob } from "@/features/document-jobs/testing/jobs-test-utils";
import { eformsignApi, type ClaimEformsignDocumentJobRecoveryResponse } from "@/services/api";

import {
  DocumentJobRecoveryDialog,
  type DocumentJobRecoveryDialogProps,
} from "./DocumentJobRecoveryDialog";

const mockRefetchSummary = jest.fn();
const mockRefetchJobs = jest.fn();
const mockToast = jest.fn();

jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
  useDocumentJobs: () => ({ refetchSummary: mockRefetchSummary, refetchJobs: mockRefetchJobs }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

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
      ["410 expired", httpError(410, { code: "RECOVERY_PAYLOAD_EXPIRED" }), "보관 기간(7일)이 지나 저장된 내용이 없어요. 새로 작성해 주세요."],
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

    it("offers 새로 작성 and 목록에서 닫기 for an expired payload, and closing resolves the job", async () => {
      claimSpy.mockReset().mockRejectedValue(httpError(410, { code: "RECOVERY_PAYLOAD_EXPIRED" }));
      const { onClose, onStartFresh } = renderDialog();

      fireEvent.click(await button("목록에서 닫기"));

      await waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(createSpy).not.toHaveBeenCalled();
      expect(onStartFresh).not.toHaveBeenCalled();
    });

    it("starts a fresh form from an expired payload", async () => {
      claimSpy.mockReset().mockRejectedValue(httpError(410));
      const { onClose, onStartFresh } = renderDialog();

      fireEvent.click(await button("새로 작성"));

      expect(onStartFresh).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it("fails closed on a payload it cannot trust", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim({ payload: { clientId: "7", contractData: CONTRACT_DATA } }),
      );
      renderDialog();

      expect(
        await screen.findByText("보관 기간(7일)이 지나 저장된 내용이 없어요. 새로 작성해 주세요."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
    });

    it("treats a finalization payload with prefillAmounts as malformed", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim(
          { payload: { documentId: "doc-9", prefillEndDate: "2026-11-30", prefillAmounts: { fullPrice: "1" } } },
          { jobType: "finalize_document" },
        ),
      );
      renderDialog();

      expect(
        await screen.findByText("보관 기간(7일)이 지나 저장된 내용이 없어요. 새로 작성해 주세요."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
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
      expect(footerButtons).toEqual(["새로 작성", "처리됨으로 표시"]);
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
      expect(claimSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it("shows the saved finalization input read-only with the same two actions", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim(
          { payload: { documentId: "doc-9", prefillEndDate: "2026-11-30" } },
          { jobType: "finalize_document" },
        ),
      );
      renderDialog();

      await screen.findByText("자동 전송이 끝내 실패했어요. 아무것도 전송되지 않았어요.");
      const summary = getSummary();
      expect(summary).toHaveTextContent("doc-9");
      expect(summary).toHaveTextContent("2026-11-30");
      expect(screen.getByRole("button", { name: "새로 작성" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "처리됨으로 표시" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /다시 보내기/ })).not.toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
      expect(finalizeSpy).not.toHaveBeenCalled();
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
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "처리됨으로 표시" }));
      });

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

    it("asks whether the contract was verified as unsent before starting fresh", async () => {
      const { onStartFresh } = renderDialog();

      fireEvent.click(await button("새로 작성"));
      expect(await screen.findByText("eformsign에서 이 계약서가 전송되지 않은 것을 확인했나요?")).toBeInTheDocument();
      expect(onStartFresh).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "취소" }));
      await waitFor(() =>
        expect(screen.queryByText("eformsign에서 이 계약서가 전송되지 않은 것을 확인했나요?")).not.toBeInTheDocument(),
      );
      expect(onStartFresh).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
      fireEvent.click(await screen.findByRole("button", { name: "확인했어요" }));

      await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
      expect(resolveSpy).not.toHaveBeenCalled();
    });
  });

  describe("새로 작성", () => {
    it("starts a fresh form without resolving the old job", async () => {
      const { onStartFresh, onClose } = renderDialog();

      fireEvent.click(await button("새로 작성"));

      expect(onStartFresh).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("confirms before discarding a creation in progress, and cancel keeps it", async () => {
      const { onStartFresh, onClose } = renderDialog({ hasCreationInProgress: true });

      fireEvent.click(await button("새로 작성"));
      expect(await screen.findByText("작성 중인 계약서를 버리고 새로 작성할까요?")).toBeInTheDocument();
      expect(onStartFresh).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "취소" }));
      await waitFor(() =>
        expect(screen.queryByText("작성 중인 계약서를 버리고 새로 작성할까요?")).not.toBeInTheDocument(),
      );
      expect(onStartFresh).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
      fireEvent.click(await screen.findByRole("button", { name: "버리고 새로 작성" }));

      await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(resolveSpy).not.toHaveBeenCalled();
    });
  });
});
