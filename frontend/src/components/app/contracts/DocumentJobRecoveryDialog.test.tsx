import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";

import { resendUncertainStorageKey } from "@/features/document-jobs/resend-uncertain-storage";
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
    window.localStorage.clear();
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
    window.localStorage.clear();
  });

  describe("claim", () => {
    it("claims the job once even under StrictMode", async () => {
      renderDialog({}, (node) => <StrictMode>{node}</StrictMode>);

      expect(await button("저장된 내용으로 다시 보내기")).toBeInTheDocument();
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
      expect(screen.queryByRole("button", { name: "저장된 내용으로 다시 보내기" })).not.toBeInTheDocument();
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
      expect(screen.queryByRole("button", { name: "저장된 내용으로 다시 보내기" })).not.toBeInTheDocument();
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
      expect(screen.queryByRole("button", { name: "저장된 내용으로 다시 보내기" })).not.toBeInTheDocument();
    });

    it("lets staff retry when the claim itself could not be loaded", async () => {
      claimSpy.mockReset().mockRejectedValueOnce(networkError()).mockResolvedValue(createClaim());
      renderDialog();

      fireEvent.click(await button("다시 시도"));

      expect(await button("저장된 내용으로 다시 보내기")).toBeInTheDocument();
      expect(claimSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("manual_send create", () => {
    it("shows the saved input read-only", async () => {
      renderDialog();

      expect(
        await screen.findByText("자동 처리에 실패했어요. 저장된 내용으로 다시 보낼 수 있어요."),
      ).toBeInTheDocument();
      const summary = getSummary();
      expect(summary).toHaveTextContent("김하늘");
      expect(summary).toHaveTextContent("2026-11-01 ~ 2026-11-14");
      expect(summary).toHaveTextContent("1,500,000원");
      expect(summary).toHaveTextContent("500,000원");
      expect(summary).toHaveTextContent("기존 계약서를 대체해요");
      expect(summary.querySelector("input, textarea, select")).toBeNull();
    });

    it("re-claims, enqueues once with the deterministic key and the exact saved input, then resolves", async () => {
      const { onClose } = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(claimSpy).toHaveBeenCalledTimes(2);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledWith({
        requestKey: "resend:job-1",
        clientId: 7,
        contractData: CONTRACT_DATA,
        supersedeDocumentId: "old-doc",
      });
      expect(finalizeSpy).not.toHaveBeenCalled();
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(resolveSpy).toHaveBeenCalledWith("job-1");
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ description: "다시 보내기를 시작했어요" }));
      expect(mockRefetchSummary).toHaveBeenCalled();
    });

    it("asks before resending and sends nothing when the confirm is cancelled", async () => {
      renderDialog();

      fireEvent.click(await button("저장된 내용으로 다시 보내기"));
      expect(
        await screen.findByText("저장된 내용으로 계약서를 다시 보낼까요? 결과는 처리중 목록에서 확인할 수 있어요."),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "취소" }));

      await waitFor(() =>
        expect(
          screen.queryByText("저장된 내용으로 계약서를 다시 보낼까요? 결과는 처리중 목록에서 확인할 수 있어요."),
        ).not.toBeInTheDocument(),
      );
      expect(createSpy).not.toHaveBeenCalled();
      expect(claimSpy).toHaveBeenCalledTimes(1);
    });

    it("omits supersedeDocumentId when the saved input had none", async () => {
      claimSpy.mockReset().mockResolvedValue(createClaim({ payload: { clientId: 7, contractData: CONTRACT_DATA } }));
      renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
      expect(createSpy.mock.calls[0][0]).not.toHaveProperty("supersedeDocumentId");
    });

    it("keeps the same request key across a failed attempt, a repeated click and a remounted dialog", async () => {
      createSpy.mockReset().mockRejectedValue(networkError());
      const first = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
      await screen.findByText(/전송 여부를 확인하지 못했어요/);
      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2));
      first.unmount();

      renderDialog();
      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(3));

      const keys = createSpy.mock.calls.map((call) => call[0].requestKey);
      expect(keys).toEqual(["resend:job-1", "resend:job-1", "resend:job-1"]);
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["an uppercase url id with a lowercase claim id", "5F2B6C1E-8A4D-4E0B-9C3A-1D7E2F4A6B80", "5f2b6c1e-8a4d-4e0b-9c3a-1d7e2f4a6b80"],
      ["a lowercase url id", "5f2b6c1e-8a4d-4e0b-9c3a-1d7e2f4a6b80", "5f2b6c1e-8a4d-4e0b-9c3a-1d7e2f4a6b80"],
      ["an uppercase url id and an uppercase claim id", "5F2B6C1E-8A4D-4E0B-9C3A-1D7E2F4A6B80", "5F2B6C1E-8A4D-4E0B-9C3A-1D7E2F4A6B80"],
    ])("builds the same lowercase request key for %s", async (_label, urlId, claimId) => {
      claimSpy.mockReset().mockResolvedValue(createClaim({}, { jobId: claimId }));
      renderDialog({ jobId: urlId });

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
      expect(createSpy.mock.calls[0][0].requestKey).toBe("resend:5f2b6c1e-8a4d-4e0b-9c3a-1d7e2f4a6b80");
    });

    it("does not send twice when the confirm is clicked twice before the first send returns", async () => {
      let accept!: (value: { jobId: string; status: "queued"; existing: boolean }) => void;
      createSpy.mockReset().mockImplementation(() => new Promise((resolve) => { accept = resolve; }));
      renderDialog();

      fireEvent.click(await button("저장된 내용으로 다시 보내기"));
      const approve = await screen.findByRole("button", { name: "다시 보내기" });
      fireEvent.click(approve);
      fireEvent.click(approve);

      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
      await act(async () => accept({ jobId: "job-2", status: "queued", existing: false }));
      await waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(1));
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it("sends nothing and shows the claimed copy when the second claim fails with 409", async () => {
      claimSpy
        .mockReset()
        .mockResolvedValueOnce(createClaim())
        .mockRejectedValueOnce(httpError(409, { code: "MANUAL_RECOVERY_CLAIMED", expiresAt: "2026-11-01T01:10:00.000Z" }));
      const { onClose } = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(await screen.findByText(/다른 곳에서 처리 중이에요\./)).toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it.each([
      ["410", httpError(410), "보관 기간(7일)이 지나 저장된 내용이 없어요. 새로 작성해 주세요."],
      ["404", httpError(404), "이미 처리됐거나 찾을 수 없는 작업이에요."],
    ])("sends nothing when the second claim fails with %s", async (_label, error, copy) => {
      claimSpy.mockReset().mockResolvedValueOnce(createClaim()).mockRejectedValueOnce(error);
      renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("keeps the dialog open and resolves nothing when the second claim has no answer", async () => {
      claimSpy.mockReset().mockResolvedValueOnce(createClaim()).mockRejectedValueOnce(networkError());
      const { onClose } = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(await screen.findByText("다시 보내지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
      expect(createSpy).not.toHaveBeenCalled();
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("does not resolve when the server already had a job, and leaves resolving to staff", async () => {
      createSpy.mockReset().mockResolvedValue({ jobId: "job-x", status: "processing", existing: true });
      const { onClose } = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(
        await screen.findByText("같은 고객/계약서의 작업이 이미 처리중 목록에 있어요. 확인한 뒤 처리됨으로 표시해 주세요."),
      ).toBeInTheDocument();
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "저장된 내용으로 다시 보내기" })).not.toBeInTheDocument();

      await openConfirmAndApprove("처리됨으로 표시", "처리됨으로 표시");
      await waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      [400, "다시 보내지 못했어요. 잠시 후 다시 시도해 주세요."],
      [503, "다시 보내지 못했어요. 잠시 후 다시 시도해 주세요."],
      [403, "이 작업은 관리자 권한이 필요해요. 지점 관리자에게 요청해 주세요."],
    ])("keeps the dialog open and resolves nothing when the enqueue is rejected with %s", async (status, copy) => {
      createSpy.mockReset().mockRejectedValue(httpError(status));
      const { onClose } = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "저장된 내용으로 다시 보내기" })).toBeEnabled();
    });

    it("warns that the outcome is unknown when the enqueue response is lost", async () => {
      createSpy.mockReset().mockRejectedValue(httpError(502));
      renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(
        await screen.findByText("전송 여부를 확인하지 못했어요. 처리중 목록에서 이 고객의 작업을 확인한 뒤 다시 시도해 주세요."),
      ).toBeInTheDocument();
      expect(resolveSpy).not.toHaveBeenCalled();
    });

    describe("uncertain enqueue outcome", () => {
      const VERIFY_COPY = "eformsign에서 이 계약서가 전송되지 않은 것을 확인했나요?";

      it.each([
        ["502", () => httpError(502)],
        ["a network error", () => networkError()],
      ])("asks for the non-delivery confirmation before 새로 작성 after %s", async (_label, makeError) => {
        createSpy.mockReset().mockRejectedValue(makeError());
        const { onStartFresh, onClose } = renderDialog();

        await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
        await screen.findByText(/전송 여부를 확인하지 못했어요/);

        fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
        expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
        expect(onStartFresh).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "취소" }));
        await waitFor(() => expect(screen.queryByText(VERIFY_COPY)).not.toBeInTheDocument());
        expect(onStartFresh).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
        fireEvent.click(await screen.findByRole("button", { name: "확인했어요" }));

        await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(resolveSpy).not.toHaveBeenCalled();
      });

      it("keeps requiring the confirmation when a retry is later rejected with a definite 400", async () => {
        createSpy.mockReset().mockRejectedValueOnce(networkError()).mockRejectedValueOnce(httpError(400));
        const { onStartFresh } = renderDialog();

        await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
        await screen.findByText(/전송 여부를 확인하지 못했어요/);
        await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
        await screen.findByText("다시 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
        expect(createSpy).toHaveBeenCalledTimes(2);

        fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
        expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
        expect(onStartFresh).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "확인했어요" }));
        await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
      });

      it("still asks about a form in progress after the non-delivery confirmation", async () => {
        createSpy.mockReset().mockRejectedValue(httpError(502));
        const { onStartFresh } = renderDialog({ hasCreationInProgress: true });

        await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
        await screen.findByText(/전송 여부를 확인하지 못했어요/);

        fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
        fireEvent.click(await screen.findByRole("button", { name: "확인했어요" }));
        expect(await screen.findByText("작성 중인 계약서를 버리고 새로 작성할까요?")).toBeInTheDocument();
        expect(onStartFresh).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "버리고 새로 작성" }));
        await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
      });

      describe("across closing and reopening the dialog", () => {
        const MARKER_KEY = resendUncertainStorageKey("job-1");

        async function resendIntoUncertainty() {
          createSpy.mockReset().mockRejectedValue(networkError());
          const first = renderDialog();
          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await screen.findByText(/전송 여부를 확인하지 못했어요/);
          first.unmount();
        }

        it.each([
          ["the same spelling", "job-1"],
          ["another casing", "JOB-1"],
        ])("still asks for the confirmation after reopening with %s", async (_label, reopenedId) => {
          await resendIntoUncertainty();
          expect(window.localStorage.getItem(MARKER_KEY)).not.toBeNull();

          const { onStartFresh, onClose } = renderDialog({ jobId: reopenedId });
          fireEvent.click(await button("새로 작성"));

          expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
          expect(onStartFresh).not.toHaveBeenCalled();
          expect(onClose).not.toHaveBeenCalled();

          fireEvent.click(screen.getByRole("button", { name: "확인했어요" }));
          await waitFor(() => expect(onStartFresh).toHaveBeenCalledTimes(1));
        });

        it("keeps the saved-input resend available after reopening", async () => {
          await resendIntoUncertainty();

          renderDialog();

          expect(await button("저장된 내용으로 다시 보내기")).toBeEnabled();
        });

        it("applies a marker stored under the server's canonical id when the URL spells it differently", async () => {
          window.localStorage.setItem(MARKER_KEY, String(Date.now()));
          const { onStartFresh } = renderDialog({ jobId: "legacy-url-spelling" });

          fireEvent.click(await button("새로 작성"));

          expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
          expect(onStartFresh).not.toHaveBeenCalled();
        });

        it("clears the marker once the old job is resolved, so a later reopen starts fresh at once", async () => {
          createSpy.mockReset().mockRejectedValueOnce(networkError()).mockResolvedValue({ jobId: "job-2", status: "queued", existing: false });
          const first = renderDialog();

          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await screen.findByText(/전송 여부를 확인하지 못했어요/);
          expect(window.localStorage.getItem(MARKER_KEY)).not.toBeNull();

          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await waitFor(() => expect(resolveSpy).toHaveBeenCalledTimes(1));
          await waitFor(() => expect(first.onClose).toHaveBeenCalledTimes(1));
          expect(window.localStorage.getItem(MARKER_KEY)).toBeNull();
          first.unmount();

          const { onStartFresh } = renderDialog();
          fireEvent.click(await button("새로 작성"));

          expect(screen.queryByText(VERIFY_COPY)).not.toBeInTheDocument();
          expect(onStartFresh).toHaveBeenCalledTimes(1);
        });

        it("keeps the marker through a definite 400 on a retry", async () => {
          createSpy.mockReset().mockRejectedValueOnce(networkError()).mockRejectedValueOnce(httpError(400));
          const first = renderDialog();

          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await screen.findByText(/전송 여부를 확인하지 못했어요/);
          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await screen.findByText("다시 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
          first.unmount();

          expect(window.localStorage.getItem(MARKER_KEY)).not.toBeNull();
          const { onStartFresh } = renderDialog();
          fireEvent.click(await button("새로 작성"));
          expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
          expect(onStartFresh).not.toHaveBeenCalled();
        });

        it("writes the marker before the request resolves, so unmounting mid-flight still requires the confirmation", async () => {
          createSpy.mockReset().mockReturnValue(new Promise(() => {}));
          const first = renderDialog();

          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
          expect(window.localStorage.getItem(MARKER_KEY)).not.toBeNull();
          expect(screen.getByRole("button", { name: "새로 작성" })).toBeDisabled();
          first.unmount();

          const { onStartFresh } = renderDialog();
          fireEvent.click(await button("새로 작성"));

          expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
          expect(onStartFresh).not.toHaveBeenCalled();
        });

        it("takes back the marker after a definite 400 with no prior uncertainty", async () => {
          createSpy.mockReset().mockRejectedValue(httpError(400));
          const first = renderDialog();

          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await screen.findByText("다시 보내지 못했어요. 잠시 후 다시 시도해 주세요.");
          expect(window.localStorage.getItem(MARKER_KEY)).toBeNull();
          first.unmount();

          const { onStartFresh } = renderDialog();
          fireEvent.click(await button("새로 작성"));

          expect(screen.queryByText(VERIFY_COPY)).not.toBeInTheDocument();
          expect(onStartFresh).toHaveBeenCalledTimes(1);
        });

        it.each([
          ["400", httpError(400)],
          ["403", httpError(403)],
        ])("keeps a marker that was already there when the attempt is rejected with %s", async (_label, error) => {
          window.localStorage.setItem(MARKER_KEY, String(Date.now()));
          createSpy.mockReset().mockRejectedValue(error);
          const first = renderDialog();

          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
          await waitFor(() => expect(screen.getByRole("button", { name: "저장된 내용으로 다시 보내기" })).toBeEnabled());
          expect(window.localStorage.getItem(MARKER_KEY)).not.toBeNull();
          first.unmount();

          const { onStartFresh } = renderDialog();
          fireEvent.click(await button("새로 작성"));
          expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
          expect(onStartFresh).not.toHaveBeenCalled();
        });

        it("keeps the marker when the server already had a job under the key", async () => {
          createSpy.mockReset().mockResolvedValue({ jobId: "job-2", status: "queued", existing: true });
          const first = renderDialog();

          await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
          await screen.findByText(/이미 처리중 목록에 있어요/);
          expect(window.localStorage.getItem(MARKER_KEY)).not.toBeNull();
          first.unmount();

          const { onStartFresh } = renderDialog();
          fireEvent.click(await button("새로 작성"));
          expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
          expect(onStartFresh).not.toHaveBeenCalled();
        });

        it("requires the confirmation when storage cannot be read", async () => {
          jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("storage blocked");
          });
          const { onStartFresh } = renderDialog();

          fireEvent.click(await button("새로 작성"));

          expect(await screen.findByText(VERIFY_COPY)).toBeInTheDocument();
          expect(onStartFresh).not.toHaveBeenCalled();
        });

        it("ignores and removes a marker older than eight days", async () => {
          window.localStorage.setItem(MARKER_KEY, String(Date.now() - 8 * 24 * 60 * 60 * 1000 - 60_000));
          const { onStartFresh } = renderDialog();

          fireEvent.click(await button("새로 작성"));

          expect(screen.queryByText(VERIFY_COPY)).not.toBeInTheDocument();
          expect(onStartFresh).toHaveBeenCalledTimes(1);
          expect(window.localStorage.getItem(MARKER_KEY)).toBeNull();
        });

        it("is not affected by a marker for a different job", async () => {
          window.localStorage.setItem(resendUncertainStorageKey("job-other"), String(Date.now()));
          const { onStartFresh } = renderDialog();

          fireEvent.click(await button("새로 작성"));

          expect(screen.queryByText(VERIFY_COPY)).not.toBeInTheDocument();
          expect(onStartFresh).toHaveBeenCalledTimes(1);
        });
      });

      it("keeps the existing behaviour after a definite 400 with no prior uncertainty", async () => {
        createSpy.mockReset().mockRejectedValue(httpError(400));
        const { onStartFresh, onClose } = renderDialog();

        await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");
        await screen.findByText("다시 보내지 못했어요. 잠시 후 다시 시도해 주세요.");

        fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));

        expect(screen.queryByText(VERIFY_COPY)).not.toBeInTheDocument();
        expect(onStartFresh).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("manual_send finalize", () => {
    beforeEach(() => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim(
          { payload: { documentId: "doc-9", prefillEndDate: "2026-11-30" } },
          { jobType: "finalize_document" },
        ),
      );
    });

    it("shows the document and end date, then enqueues the finalization from the payload", async () => {
      const { onClose } = renderDialog();

      await screen.findByText("자동 처리에 실패했어요. 저장된 내용으로 다시 보낼 수 있어요.");
      const summary = getSummary();
      expect(summary).toHaveTextContent("doc-9");
      expect(summary).toHaveTextContent("2026-11-30");

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      expect(finalizeSpy).toHaveBeenCalledWith({
        requestKey: "resend:job-1",
        documentId: "doc-9",
        prefillEndDate: "2026-11-30",
      });
      expect(createSpy).not.toHaveBeenCalled();
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it("omits prefillEndDate when none was saved and never sends prefillAmounts", async () => {
      claimSpy.mockReset().mockResolvedValue(
        createClaim({ payload: { documentId: "doc-9" } }, { jobType: "finalize_document" }),
      );
      renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      await waitFor(() => expect(finalizeSpy).toHaveBeenCalledTimes(1));
      expect(finalizeSpy.mock.calls[0][0]).toEqual({ requestKey: "resend:job-1", documentId: "doc-9" });
    });

    it("shows the 403 copy and resolves nothing when finalization is not permitted", async () => {
      finalizeSpy.mockReset().mockRejectedValue(httpError(403));
      renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(
        await screen.findByText("이 작업은 관리자 권한이 필요해요. 지점 관리자에게 요청해 주세요."),
      ).toBeInTheDocument();
      expect(resolveSpy).not.toHaveBeenCalled();
    });
  });

  describe("resolve", () => {
    it("retries network errors without ever enqueuing again", async () => {
      resolveSpy
        .mockReset()
        .mockRejectedValueOnce(networkError())
        .mockRejectedValueOnce(httpError(502))
        .mockResolvedValue({ job: makeJob(), alreadyResolved: false });
      const { onClose } = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(resolveSpy).toHaveBeenCalledTimes(3);
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it("offers 처리됨 표시 다시 시도 after four failures, and retrying only resolves", async () => {
      resolveSpy.mockReset().mockRejectedValue(networkError());
      const { onClose } = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(await screen.findByText("처리됨으로 표시하지 못했어요. 다시 시도해 주세요.")).toBeInTheDocument();
      expect(resolveSpy).toHaveBeenCalledTimes(4);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "저장된 내용으로 다시 보내기" })).not.toBeInTheDocument();

      resolveSpy.mockReset().mockResolvedValue({ job: makeJob(), alreadyResolved: false });
      fireEvent.click(screen.getByRole("button", { name: "처리됨 표시 다시 시도" }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      [409, { code: "JOB_NOT_RECOVERABLE", status: "completed" }, "이미 처리됐거나 찾을 수 없는 작업이에요."],
      [404, { code: "RESOURCE_NOT_FOUND" }, "이미 처리됐거나 찾을 수 없는 작업이에요."],
      [409, { code: "MANUAL_RECOVERY_CLAIMED", expiresAt: "2026-11-01T01:10:00.000Z" }, /다른 곳에서 처리 중이에요\./],
    ])("stops on %s without retrying and shows the matching copy", async (status, body, copy) => {
      resolveSpy.mockReset().mockRejectedValue(httpError(status, body));
      const { onClose } = renderDialog();

      await openConfirmAndApprove("저장된 내용으로 다시 보내기", "다시 보내기");

      expect(await screen.findByText(copy)).toBeInTheDocument();
      expect(resolveSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(mockRefetchSummary).toHaveBeenCalled();
    });

    it("marks a job handled without resending after a confirm", async () => {
      const { onClose } = renderDialog();

      await openConfirmAndApprove("처리됨으로 표시", "처리됨으로 표시");

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
