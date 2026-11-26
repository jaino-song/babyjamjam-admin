import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient, makeJob, makeJobList, setBranchCookie } from "@/features/document-jobs/testing/jobs-test-utils";
import { api } from "@/lib/api/client";

import { ContractDocumentJobDetail } from "./ContractDocumentJobDetail";
import { ContractDocumentJobsPopover } from "./ContractDocumentJobsPopover";

jest.mock("next/navigation", () => ({ usePathname: () => "/contracts", useRouter: () => ({ push: jest.fn() }) }));

const BASE = "desktop_contracts_tests_jobs";
const WARNING = "이폼사인에 제공기록지가 이미 생성되었을 수 있어요. 이폼사인에서 문서 상태를 확인해 주세요.";
const JOB = makeJob({ documentKind: "service_record", displayOperation: "generate", source: "auto_finalize", status: "requires_attention", recoveryKind: null, recoveryPresentation: null, retryable: true, cancellable: true, lastErrorCode: null });

beforeEach(() => setBranchCookie("branch-a"));
afterEach(() => { setBranchCookie(null); jest.restoreAllMocks(); });

describe.each([390, 1280])("service-record jobs at %spx", width => {
  let originalWidth: number;
  beforeEach(() => { originalWidth = window.innerWidth; Object.defineProperty(window, "innerWidth", { configurable: true, value: width }); });
  afterEach(() => Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth }));

  it.each([[true, true], [true, false], [false, true], [false, false]])("offers actions only by retryable=%s/cancellable=%s in requiresAttention", (retryable, cancellable) => {
    render(<QueryClientProvider client={createTestQueryClient()}><ContractDocumentJobsPopover defaultOpen documentJobs={makeJobList({ requiresAttention: [{ ...JOB, retryable, cancellable }] })} data-component={BASE} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    expect(Boolean(screen.queryByRole("button", { name: "재시도" }))).toBe(retryable);
    expect(Boolean(screen.queryByRole("button", { name: "취소" }))).toBe(cancellable);
    expect(screen.queryByText("수동 전송")).not.toBeInTheDocument();
  });

  it("passes service-record metadata to retry and keeps conflict copy free of contract/manual-send advice", async () => {
    jest.spyOn(api, "post").mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { code: "JOB_NOT_RETRYABLE", message: "private detail" } } });
    render(<QueryClientProvider client={createTestQueryClient()}><ContractDocumentJobsPopover defaultOpen documentJobs={makeJobList({ requiresAttention: [JOB] })} data-component={BASE} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));
    const dialog = screen.getByRole("dialog", { name: "제공기록지 생성을 재시도할까요?" });
    expect(dialog).toHaveTextContent("재시도하면 서버에서 제공기록지를 다시 생성합니다.");
    fireEvent.click(within(dialog).getByRole("button", { name: "재시도" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("이 제공기록지 작업은 지금 재시도할 수 없어요. 전자문서 작업 목록에서 상태를 다시 확인해 주세요.");
    expect(dialog).not.toHaveTextContent(/계약서|수동|private detail/);
  });

  it.each(["queued", "client-started", "dispatch_authorized", "creating", "sent", "reconciling"])("passes %s to retry and warns only with dispatch evidence", progressStep => {
    render(<QueryClientProvider client={createTestQueryClient()}><ContractDocumentJobsPopover defaultOpen documentJobs={makeJobList({ requiresAttention: [{ ...JOB, progressStep }] })} data-component={BASE} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));
    const dialog = screen.getByRole("dialog", { name: "제공기록지 생성을 재시도할까요?" });
    const description = within(dialog).getByText(/재시도하면 서버에서 제공기록지를 다시 생성합니다\./);
    const afterDispatch = ["dispatch_authorized", "creating", "sent", "reconciling"].includes(progressStep);
    expect(description.textContent).toBe(`재시도하면 서버에서 제공기록지를 다시 생성합니다.${afterDispatch ? `\n${WARNING.replace(". ", ".\n")}` : ""}`);
    expect(description).toBeVisible();
    expect(description).toHaveAttribute("data-component", `${BASE}_retry_header_description`);
    expect(dialog).not.toHaveTextContent(/계약서|수동 전송/);
  });

  it.each(["retry", "cancel"])("passes preparing+creating evidence from detail to the %s dialog", action => {
    const evidenceJob = { ...JOB, progressStep: "preparing", progressDetail: "creating", retryable: action === "retry" };
    const client = createTestQueryClient();
    const view = (offered: boolean) => <QueryClientProvider client={client}><ContractDocumentJobsPopover defaultOpen documentJobs={makeJobList({ requiresAttention: offered ? [evidenceJob] : [] })} data-component={BASE} /></QueryClientProvider>;
    const { rerender } = render(view(true));
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    expect(screen.getByText(WARNING)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: action === "retry" ? "재시도" : "취소" }));
    const title = action === "retry" ? "제공기록지 생성을 재시도할까요?" : "제공기록지 작업을 취소할까요?";
    const dialog = screen.getByRole("dialog", { name: title });
    expect(dialog).toHaveTextContent(WARNING);
    expect(dialog).not.toHaveTextContent("아직 보낸 문서는 없어요.");
    rerender(view(false));
    expect(screen.getByRole("dialog", { name: title })).toHaveTextContent(WARNING);
  });

  it.each(["retry", "cancel"])("retains service-record %s copy when polling removes the offered job", action => {
    const client = createTestQueryClient();
    const view = (offered: boolean) => <QueryClientProvider client={client}><ContractDocumentJobsPopover defaultOpen documentJobs={makeJobList({ requiresAttention: offered ? [JOB] : [] })} data-component={BASE} /></QueryClientProvider>;
    const { rerender } = render(view(true));
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    fireEvent.click(screen.getByRole("button", { name: action === "retry" ? "재시도" : "취소" }));
    rerender(view(false));
    const dialog = screen.getByRole("dialog", { name: action === "retry" ? "제공기록지 생성을 재시도할까요?" : "제공기록지 작업을 취소할까요?" });
    expect(within(dialog).getByRole("button", { name: action === "retry" ? "재시도" : "작업 취소" })).toBeDisabled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(`이 제공기록지 작업은 지금 ${action === "retry" ? "재시도" : "취소"}할 수 없어요. 전자문서 작업 목록에서 상태를 다시 확인해 주세요.`);
    expect(dialog).not.toHaveTextContent(/계약서|수동/);
  });

  it.each(["queued", "dispatch_authorized", "creating", "sent", "reconciling"])("passes %s to cancellation and distinguishes send evidence", async progressStep => {
    jest.spyOn(api, "post").mockRejectedValue(new Error("private detail"));
    render(<QueryClientProvider client={createTestQueryClient()}><ContractDocumentJobsPopover defaultOpen documentJobs={makeJobList({ requiresAttention: [{ ...JOB, progressStep }] })} data-component={BASE} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    const dialog = screen.getByRole("dialog", { name: "제공기록지 작업을 취소할까요?" });
    expect(dialog).toHaveTextContent(progressStep === "queued" ? "아직 보낸 문서는 없어요." : WARNING);
    if (progressStep !== "queued") expect(dialog).not.toHaveTextContent("아직 보낸 문서는 없어요.");
    fireEvent.click(within(dialog).getByRole("button", { name: "작업 취소" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("제공기록지 작업을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.");
    expect(dialog).not.toHaveTextContent(/계약서|수동|private detail/);
  });
});

it.each(["dispatch_authorized", "creating", "sent", "reconciling"])("warns by progressStep %s regardless of retryable", progressStep => {
  const { rerender } = render(<ContractDocumentJobDetail job={{ ...JOB, progressStep, retryable: true }} data-component={`${BASE}_detail`} />);
  expect(screen.getByText(WARNING)).toHaveAttribute("data-component", `${BASE}_detail_dispatch-warning`);
  rerender(<ContractDocumentJobDetail job={{ ...JOB, progressStep, retryable: false }} data-component={`${BASE}_detail`} />);
  expect(screen.getByText(WARNING)).toBeInTheDocument();
});

it.each([undefined, "queued", "failed", "client-started"])("does not infer dispatch from retryable=false at %s", progressStep => {
  render(<ContractDocumentJobDetail job={{ ...JOB, progressStep, retryable: false }} data-component={`${BASE}_detail`} />);
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
});

it("leaves contract detail warnings unchanged even with dispatch evidence", () => {
  render(<ContractDocumentJobDetail job={{ ...JOB, documentKind: "service_contract", progressStep: "sent", retryable: false }} data-component={`${BASE}_detail`} />);
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
});

it.each(["client-started", "info-inserted", "creating", "sent"])("warns for progressDetail %s while preparing regardless of retryable", progressDetail => {
  const { rerender } = render(<ContractDocumentJobDetail job={{ ...JOB, progressStep: "preparing", progressDetail }} data-component={`${BASE}_detail`} />);
  expect(screen.getByText(WARNING)).toHaveAttribute("data-component", `${BASE}_detail_dispatch-warning`);
  rerender(<ContractDocumentJobDetail job={{ ...JOB, progressStep: "preparing", progressDetail, retryable: false }} data-component={`${BASE}_detail`} />);
  expect(screen.getByText(WARNING)).toBeVisible();
});

it.each([null, "preparing", "unknown"])("does not infer dispatch from unrelated progressDetail %s", progressDetail => {
  render(<ContractDocumentJobDetail job={{ ...JOB, progressStep: "preparing", progressDetail, retryable: false }} data-component={`${BASE}_detail`} />);
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
});
