import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient, setBranchCookie } from "@/features/document-jobs/testing/jobs-test-utils";
import { api } from "@/lib/api/client";

import { ContractDocumentJobRetryDialog } from "./ContractDocumentJobRetryDialog";

function setup() {
  const onClose = jest.fn(), onRetried = jest.fn();
  render(<QueryClientProvider client={createTestQueryClient()}>
    <ContractDocumentJobRetryDialog jobId="old-job" branchId="branch-a" open onClose={onClose}
      onRetried={onRetried} onCloseAutoFocus={event => event.preventDefault()} data-component="desktop_contracts_tests_retry" />
  </QueryClientProvider>);
  return { onClose, onRetried };
}

beforeEach(() => setBranchCookie("branch-a"));
afterEach(() => { setBranchCookie(null); jest.restoreAllMocks(); });

it("checks branch context again at confirmation and never posts stale tenant work", () => {
  const post = jest.spyOn(api, "post");
  const { onClose, onRetried } = setup();
  setBranchCookie("branch-b");
  fireEvent.click(screen.getByRole("button", { name: "재시도" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
  expect(onRetried).not.toHaveBeenCalled();
});

it("disables approval while pending and reports success once", async () => {
  let finish!: () => void;
  const post = jest.spyOn(api, "post").mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ data: { jobId: "new-job", status: "queued" } });
  }));
  const { onRetried } = setup();
  expect(screen.getByText("재시도하면 고객에게 계약서 서명 요청이 다시 발송됩니다.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "재시도" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "처리 중" })).toBeDisabled());
  expect(screen.getByRole("button", { name: "닫기" })).toBeDisabled();
  await act(async () => { finish(); });
  await waitFor(() => expect(onRetried).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith("/eformsign-docs/jobs/old-job/retry");
});

it.each([
  [409, "JOB_NOT_RETRYABLE", "이 작업은 지금 재시도할 수 없어요. 상태를 확인하거나 수동으로 전송해 주세요."],
  [409, "OTHER", "작업을 재시도하지 못했어요. 잠시 후 다시 시도해 주세요."],
  [500, "JOB_NOT_RETRYABLE", "작업을 재시도하지 못했어요. 잠시 후 다시 시도해 주세요."],
])("shows safe Korean copy for %s/%s", async (status, code, message) => {
  jest.spyOn(api, "post").mockRejectedValue({ isAxiosError: true, response: { status, data: { code, message: "private upstream detail" } } });
  const { onRetried } = setup();
  fireEvent.click(screen.getByRole("button", { name: "재시도" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(onRetried).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).not.toHaveTextContent("private upstream detail");
});
