import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Dialog } from "radix-ui";

import { ContractDocumentJobsModal } from "./ContractDocumentJobsModal";
import type { ContractDocumentJobsData } from "./ContractDocumentJobsPopover";

const BASE = "desktop_contracts_jobs-modal";
const A = { jobId: "a", jobType: "create_document", clientName: "예시 A", status: "processing", documentKind: "service_contract", displayOperation: "generate" } as const;
const JOBS: ContractDocumentJobsData = { active: [A], requiresAttention: [], recent: [] };
const close = jest.fn(), measuredContent = jest.fn(() => 600), measuredHeader = jest.fn(() => 72);
type Props = Partial<React.ComponentProps<typeof ContractDocumentJobsModal>>;
function Harness({ open: externalOpen, ...props }: Props) {
  const anchorRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(true);
  return <><button ref={anchorRef} onClick={() => setOpen(true)}>작업 열기</button>
    <ContractDocumentJobsModal open={externalOpen ?? open} onClose={() => { close(); setOpen(false); }} anchorRef={anchorRef}
      jobs={JOBS} isLoading={false} data-component={BASE} {...props} /></>;
}
function slot(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  expect(element).not.toBeNull();
  return element!;
}
const card = () => screen.getByRole("button", { name: "예시 A · 서비스 계약서 생성 · 처리중 상세 보기" });
const back = () => screen.getByRole("button", { name: "목록으로 돌아가기" });
const closeButton = () => screen.getByRole("button", { name: "전자문서 작업 닫기" });

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { left: 20, top: 40, bottom: 72, height: this.dataset.slot === "pane-header" ? measuredHeader() : 32 } as DOMRect;
  });
  jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.dataset.slot === "document-jobs-natural-content" ? measuredContent() : 0;
  });
  jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
});
afterEach(() => jest.restoreAllMocks());

// The public owner accepts a caller that omits metadata entirely.
void (<ContractDocumentJobsModal open={false} onClose={() => {}} anchorRef={React.createRef<HTMLButtonElement>()} isLoading={false} />);

it.each([undefined, ""])("keeps selection, cached height and keyboard navigation without a namespace (%s)", async (namespace) => {
  render(<Harness data-component={namespace} />);
  const dialog = screen.getByRole("dialog", { name: "전자문서 작업" });
  expect(dialog).toHaveAttribute("data-source-component", "AnchoredNotificationModalShell");
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-motion", "page");
  expect(document.querySelectorAll("[data-slot]").length).toBeGreaterThan(10);
  expect(document.querySelectorAll("[data-component]")).toHaveLength(0);
  expect(dialog).toHaveStyle({ height: "672px" });
  const clicked = card(); clicked.focus(); fireEvent.click(clicked);
  expect(back()).toHaveFocus();
  expect(slot("job-detail-summary")).toBeInTheDocument();
  expect(slot("job-detail-body")).toBeInTheDocument();
  expect(document.querySelectorAll("[data-component]")).toHaveLength(0);
  fireEvent.keyDown(back(), { key: "Escape" });
  expect(clicked).toHaveFocus();
  expect(dialog).toHaveStyle({ height: "672px" });
  expect(measuredContent).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(closeButton(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(close).toHaveBeenCalledTimes(1);
});

it("composes the real shell and page slider with whole moving headers and full metadata", () => {
  render(<Harness />);
  const dialog = screen.getByRole("dialog", { name: "전자문서 작업" });
  expect(dialog).toHaveAttribute("data-source-component", "AnchoredNotificationModalShell");
  expect(dialog).toHaveAttribute("data-component", BASE);
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-motion", "page");
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-source-component", "SlidingDetailPanel");
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide");
  expect(slot("pane-header")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_list-pane_header");
  expect(slot("pane-header").querySelector('[data-source-component="PanelTitleGroup"]')).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_list-pane_header_title-group");
  expect(slot("pane-header").closest('[data-slot="sliding-detail-list"]')).toBe(slot("sliding-detail-list"));
  expect(within(slot("pane-header")).getByRole("heading", { name: "전자문서 작업" })).toBeInTheDocument();
  expect(closeButton()).toHaveAttribute("data-variant", "ghost");
  expect(closeButton()).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_list-pane_header_actions_close");
  expect(slot("document-jobs-list-scroller")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_list-pane_body");
  expect(slot("document-jobs-natural-content")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_list-pane_body_content");
  expect(slot("contract-document-jobs-list")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_list-pane_body_content_list");
  expect(document.querySelector('[data-slot="panel-subtitle"]')).toBeNull();
  expect(slot("sliding-detail-content")).toHaveAttribute("inert");
  expect(slot("sliding-detail-content")).toHaveAttribute("aria-hidden", "true");
  fireEvent.click(card());
  expect(back()).toHaveFocus();
  expect(slot("sliding-detail-list")).toHaveAttribute("inert");
  expect(slot("sliding-detail-list")).toHaveAttribute("aria-hidden", "true");
  expect(slot("sliding-detail-content")).not.toHaveAttribute("inert");
  expect(slot("job-detail-summary")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_detail-pane_body_scroll_summary_job");
  expect(closeButton()).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_detail-pane_header_row_actions_close");
  expect(closeButton().closest('[data-slot="pane-header-actions"]')).not.toBeNull();
  expect(slot("job-detail-body")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_detail-pane_body_scroll_job");
  expect(slot("document-jobs-detail-scroller")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_panes_slide_detail-pane_body_scroll");
  expect(slot("document-jobs-detail-scroller")).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
  expect(screen.queryByText("연결된 문서가 없습니다")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "문서 보기" })).not.toBeInTheDocument();
});

it.each([
  ["active", "processing", "처리중"], ["requiresAttention", "requires_attention", "처리 실패"], ["recent", "completed", "완료"],
] as const)("selects jobs from %s without requiring a document ID", (field, status, label) => {
  render(<Harness jobs={{ active: [], requiresAttention: [], recent: [], [field]: [{ ...A, status }] }} />);
  if (field === "recent") fireEvent.click(screen.getByRole("button", { name: "최근 처리 1건" }));
  fireEvent.click(screen.getByRole("button", { name: `예시 A · 서비스 계약서 생성 · ${label} 상세 보기` }));
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "true");
  expect(within(slot("job-detail-summary")).getByText(label)).toBeInTheDocument();
});

it("resolves the selected ID from current jobs and never revives a deleted selection", () => {
  const { rerender } = render(<Harness />);
  fireEvent.click(card());
  rerender(<Harness jobs={{ ...JOBS, active: [{ ...A, clientName: "최신 고객", status: "completed" }] }} />);
  expect(within(slot("job-detail-summary")).getByRole("heading", { name: "최신 고객" })).toBeInTheDocument();
  expect(within(slot("job-detail-summary")).getByText("완료")).toBeInTheDocument();
  rerender(<Harness jobs={{ active: [], requiresAttention: [], recent: [] }} />);
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "false");
  expect(closeButton()).toHaveFocus();
  rerender(<Harness />);
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "false");
  expect(card()).toBeInTheDocument();
});

it("restores clicked-card focus and the list scroll snapshot on back", () => {
  render(<Harness />);
  const clicked = card(), scroller = slot("document-jobs-list-scroller");
  scroller.scrollTop = 127;
  fireEvent.click(clicked);
  scroller.scrollTop = 0;
  const focus = jest.spyOn(clicked, "focus");
  fireEvent.click(back());
  expect(scroller.scrollTop).toBe(127);
  expect(clicked).toHaveFocus();
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});

it("preserves collapse through rapid back/close/reopen but always reopens the list", async () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "확인 필요 0건" }));
  expect(slot("contract-document-jobs-list").querySelector('[data-expanded="false"]')).toHaveAttribute("inert");
  fireEvent.click(card()); fireEvent.click(back()); fireEvent.click(card());
  const clicked = document.querySelector<HTMLButtonElement>('[data-slot="contract-document-jobs-card"]')!;
  const staleFocus = jest.spyOn(clicked, "focus");
  fireEvent.click(closeButton());
  await waitFor(() => expect(screen.getByText("작업 열기")).toHaveFocus());
  expect(staleFocus).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("작업 열기"));
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "false");
  expect(screen.getByRole("button", { name: "확인 필요 0건" })).toHaveAttribute("aria-expanded", "false");
  expect(close).toHaveBeenCalledTimes(1);
});

it("resets an external close before reopening without calling onClose or focusing a stale card", () => {
  const { rerender } = render(<Harness open />);
  fireEvent.click(card());
  rerender(<Harness open={false} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<Harness open />);
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "false");
  expect(close).not.toHaveBeenCalled();
});

it("backs once on detail Escape, respects prevented Escape, then closes once on list Escape", async () => {
  render(<Harness />); fireEvent.click(card());
  const prevented = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  prevented.preventDefault(); fireEvent(back(), prevented);
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "true");
  fireEvent.keyDown(back(), { key: "Escape" });
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "false");
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(closeButton(), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(close).toHaveBeenCalledTimes(1);
});

it("lets a real higher Radix dialog own Escape without backing or closing jobs", async () => {
  const { rerender } = render(<Harness />); fireEvent.click(card());
  rerender(<><Harness /><Dialog.Root defaultOpen><Dialog.Portal><Dialog.Overlay /><Dialog.Content aria-describedby={undefined}>
    <Dialog.Title>중첩 확인</Dialog.Title><button>중첩 동작</button>
  </Dialog.Content></Dialog.Portal></Dialog.Root></>);
  fireEvent.keyDown(screen.getByText("중첩 동작"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("중첩 동작")).not.toBeInTheDocument());
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "true");
  expect(close).not.toHaveBeenCalled();
});

it("waits for successful Portal content then caches natural header plus unclamped inner height exactly once", () => {
  const { rerender } = render(<Harness isLoading jobs={null} />);
  expect(screen.getByRole("dialog")).toHaveStyle({ height: "744px" });
  expect(measuredContent).not.toHaveBeenCalled();
  rerender(<Harness error={new Error("safe failure")} jobs={null} />);
  expect(measuredContent).not.toHaveBeenCalled();
  rerender(<Harness />);
  expect(measuredContent).toHaveBeenCalledTimes(1);
  expect(measuredHeader).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toHaveStyle({ height: "672px" });
  expect(slot("document-jobs-natural-content")).toHaveClass("shrink-0");
  fireEvent.click(screen.getByRole("button", { name: "확인 필요 0건" }));
  fireEvent.click(card()); fireEvent.click(back());
  rerender(<Harness jobs={{ ...JOBS, recent: [{ ...A, jobId: "new", status: "completed" }] }} />);
  act(() => { Object.defineProperty(window, "innerHeight", { value: 300 }); fireEvent(window, new Event("resize")); });
  expect(screen.getByRole("dialog")).toHaveStyle({ height: "276px" });
  act(() => { Object.defineProperty(window, "innerHeight", { value: 1000 }); fireEvent(window, new Event("resize")); });
  expect(screen.getByRole("dialog")).toHaveStyle({ height: "672px" });
  fireEvent.click(closeButton()); fireEvent.click(screen.getByText("작업 열기"));
  expect(screen.getByRole("dialog")).toHaveStyle({ height: "672px" });
  expect(measuredContent).toHaveBeenCalledTimes(1);
  expect(measuredHeader).toHaveBeenCalledTimes(1);
});

it("forwards loading, safe error and retry without caching a failure", () => {
  const retry = jest.fn();
  const { rerender } = render(<Harness isLoading />);
  expect(screen.getByRole("status", { name: "전자문서 작업 불러오는 중" })).toBeInTheDocument();
  rerender(<Harness error={new Error("private error")} onRetry={retry} />);
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("private error")).not.toBeInTheDocument();
  expect(measuredContent).not.toHaveBeenCalled();
});

it("caches a successful empty list once even with StrictMode and delayed Portal refs", () => {
  render(<React.StrictMode><Harness jobs={{ active: [], requiresAttention: [], recent: [] }} /></React.StrictMode>);
  expect(screen.getByText("처리중인 전자문서가 없습니다.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toHaveStyle({ height: "672px" });
  expect(measuredContent).toHaveBeenCalledTimes(1);
  expect(measuredHeader).toHaveBeenCalledTimes(1);
});

it.each(["pointer", "Enter"])("closes once on %s close-button activation, restores the anchor and reopens at the list", async (activation) => {
  render(<Harness jobs={{ ...JOBS, active: [{ ...A, documentId: "doc /1" }] }} />);
  fireEvent.click(card());
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(back());
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(card());
  expect(screen.queryByRole("link", { name: "문서 보기" })).not.toBeInTheDocument();
  const link = closeButton();
  if (activation === "Enter") fireEvent.keyDown(link, { key: "Enter" });
  fireEvent.click(link);
  if (activation === "Enter") fireEvent.keyUp(link, { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.getByText("작업 열기")).toHaveFocus();
  fireEvent.click(screen.getByText("작업 열기"));
  expect(slot("sliding-detail-panel")).toHaveAttribute("data-open", "false");
});
