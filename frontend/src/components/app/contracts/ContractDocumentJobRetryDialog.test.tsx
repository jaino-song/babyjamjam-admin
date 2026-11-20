import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient, setBranchCookie } from "@/features/document-jobs/testing/jobs-test-utils";
import { api } from "@/lib/api/client";

import { ContractDocumentJobRetryDialog } from "./ContractDocumentJobRetryDialog";

function setup(isJobOffered = true) {
  const onClose = jest.fn(), onRetried = jest.fn();
  const client = createTestQueryClient();
  const view = (offered: boolean, showDialog = true) => <QueryClientProvider client={client}>
    {showDialog ? <ContractDocumentJobRetryDialog jobId="old-job" branchId="branch-a" isJobOffered={offered} open onClose={onClose}
      onRetried={onRetried} onCloseAutoFocus={event => event.preventDefault()} data-component="desktop_contracts_tests_retry" /> : null}
  </QueryClientProvider>;
  const result = render(view(isJobOffered));
  return { onClose, onRetried, rerender: (offered: boolean, showDialog = true) => result.rerender(view(offered, showDialog)) };
}

beforeEach(() => setBranchCookie("branch-a"));
afterEach(() => { onlineManager.setOnline(true); setBranchCookie(null); jest.restoreAllMocks(); });

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

it("submits once for two approvals before React renders pending and keeps success locked", async () => {
  let finish!: () => void;
  const post = jest.spyOn(api, "post").mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ data: { jobId: "new-job", status: "queued" } });
  }));
  const { onRetried } = setup();
  const approve = screen.getByRole("button", { name: "재시도" });
  act(() => { fireEvent.click(approve); fireEvent.click(approve); });
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await act(async () => { finish(); });
  await waitFor(() => expect(onRetried).toHaveBeenCalledTimes(1));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "재시도" })); });
  expect(post).toHaveBeenCalledTimes(1);
});

it("allows another approval after a rejected request", async () => {
  const post = jest.spyOn(api, "post").mockRejectedValue(new Error("offline"));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "재시도" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("작업을 재시도하지 못했어요. 잠시 후 다시 시도해 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "재시도" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "닫기" })).toBeEnabled());
});

it("disables approval and explains when the list no longer offers the job", () => {
  const post = jest.spyOn(api, "post");
  setup(false);
  expect(screen.getByRole("alert")).toHaveTextContent("이 작업은 지금 재시도할 수 없어요. 상태를 확인하거나 수동으로 전송해 주세요.");
  const approve = screen.getByRole("button", { name: "재시도" });
  expect(approve).toBeDisabled();
  fireEvent.click(approve);
  expect(post).not.toHaveBeenCalled();
});

it("does not flash a list refusal while pending or after success", async () => {
  let finish!: () => void;
  jest.spyOn(api, "post").mockImplementation(() => new Promise(resolve => {
    finish = () => resolve({ data: { jobId: "new-job", status: "queued" } });
  }));
  const { onRetried, rerender } = setup();
  fireEvent.click(screen.getByRole("button", { name: "재시도" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "처리 중" })).toBeDisabled());
  rerender(false);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "처리 중" })).toBeDisabled();
  await act(async () => { finish(); });
  await waitFor(() => expect(onRetried).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("fails offline immediately and never resumes after the dialog is removed on the same client", async () => {
  const post = jest.spyOn(api, "post").mockRejectedValue(new Error("offline"));
  const { rerender } = setup();
  onlineManager.setOnline(false);
  fireEvent.click(screen.getByRole("button", { name: "재시도" }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("alert")).toHaveTextContent("작업을 재시도하지 못했어요. 잠시 후 다시 시도해 주세요.");
  expect(screen.getByRole("button", { name: "닫기" })).toBeEnabled();
  rerender(true, false);
  await act(async () => { onlineManager.setOnline(true); });
  expect(post).toHaveBeenCalledTimes(1);
});

it("names the title, description and buttons by their header and footer owners", () => {
  setup();
  const base = "desktop_contracts_tests_retry";
  expect(screen.getByRole("heading", { name: "이 작업을 재시도할까요?" })).toHaveAttribute("data-component", `${base}_header_title`);
  expect(screen.getByText("재시도하면 고객에게 계약서 서명 요청이 다시 발송됩니다.")).toHaveAttribute("data-component", `${base}_header_description`);
  expect(screen.getByRole("button", { name: "닫기" })).toHaveAttribute("data-component", `${base}_footer_cancel`);
  expect(screen.getByRole("button", { name: "재시도" })).toHaveAttribute("data-component", `${base}_footer_approve`);
});
