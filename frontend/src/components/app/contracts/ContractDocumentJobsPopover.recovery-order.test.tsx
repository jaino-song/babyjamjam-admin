import { useLayoutEffect } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { makeJob, makeJobList } from "@/features/document-jobs/testing/jobs-test-utils";

import { ContractDocumentJobsPopover } from "./ContractDocumentJobsPopover";
import type { DocumentJobRecoveryDialogProps } from "./DocumentJobRecoveryDialog";

type RecoveryProps = Extract<DocumentJobRecoveryDialogProps, { presentation: "iframe" }>;
const mockRecoveryDialog = jest.fn<null, [RecoveryProps]>(() => null);
jest.mock("./DocumentJobRecoveryDialog", () => ({
  DocumentJobRecoveryDialog: (props: RecoveryProps) => mockRecoveryDialog(props),
}));
const mockPush = jest.fn();
let mockPathname = "/contracts";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush }),
}));
const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

const JOB = makeJob({ recoveryPresentation: "iframe" });
const JOBS = makeJobList({ requiresAttention: [JOB] });
const BASE = "desktop_contracts_tests_jobs-popover";

beforeEach(() => {
  mockPathname = "/contracts";
  mockRecoveryDialog.mockClear();
});

test.each(["pending", "late"] as const)("scope reset discards a %s recovery focus return before the next recovery closes", async timing => {
  const view = render(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
  fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
  const cta = screen.getByRole("button", { name: "수동 전송" });
  fireEvent.click(cta);
  const props = mockRecoveryDialog.mock.calls.at(-1)![0];
  const ctaFocus = jest.spyOn(cta, "focus");
  const event = new Event("closeAutoFocus", { cancelable: true });
  act(() => {
    if (timing === "pending") props.onCloseAutoFocus?.(event);
    mockPathname = "/clients";
    view.rerender(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
  });
  expect(document.querySelector('[data-slot="document-jobs-interaction"]')).not.toHaveAttribute("inert");
  expect(ctaFocus).not.toHaveBeenCalled();
  const nativeFocus = HTMLElement.prototype.focus;
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  act(() => {
    if (timing === "late") props.onCloseAutoFocus?.(event);
    props.onClose();
  });
  view.rerender(<ContractDocumentJobsPopover open documentJobs={makeJobList()} data-component={BASE} />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(event.defaultPrevented).toBe(true);
  expect(focus).not.toHaveBeenCalled();
  expect(ctaFocus).not.toHaveBeenCalled();

  mockPathname = "/contracts";
  view.rerender(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
  fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
  const nextCta = screen.getByRole("button", { name: "수동 전송" });
  fireEvent.click(nextCta);
  const nextProps = mockRecoveryDialog.mock.calls.at(-1)![0];
  expect(document.querySelector('[data-slot="document-jobs-interaction"]')).toHaveAttribute("inert");

  const focusedWhileInert: boolean[] = [];
  focus.mockClear();
  focus.mockImplementation(function (this: HTMLElement, options) {
    focusedWhileInert.push(Boolean(this.closest("[inert]")));
    nativeFocus.call(this, options);
  });
  // Closing first exposes a leaked pending return in the commit, before the new handler runs.
  const nextEvent = new Event("closeAutoFocus", { cancelable: true });
  act(() => { nextProps.onClose(); });
  act(() => { nextProps.onCloseAutoFocus?.(nextEvent); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

  expect(nextEvent.defaultPrevented).toBe(true);
  expect(document.querySelector('[data-slot="document-jobs-interaction"]')).not.toHaveAttribute("inert");
  expect(nextCta).toHaveFocus();
  expect(focus.mock.contexts.filter(element => element === nextCta)).toHaveLength(1);
  expect(focus).toHaveBeenCalledTimes(1);
  expect(focusedWhileInert).toEqual([false]);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(["handler first", "close first"] as const)("recovery focus: %s", order => {
  test.each([false, true])("restores focus once with manual send removed=%s", async removeCta => {
    const view = render(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    const cta = screen.getByRole("button", { name: "수동 전송" });
    fireEvent.click(cta);
    expect(mockRecoveryDialog).toHaveBeenCalled();
    expect(document.querySelector('[data-slot="document-jobs-interaction"]')).toHaveAttribute("inert");
    const props = mockRecoveryDialog.mock.calls.at(-1)![0];

    if (removeCta) {
      view.rerender(<ContractDocumentJobsPopover open data-component={BASE} documentJobs={makeJobList({
        recent: [{ ...JOB, status: "completed", recoveryKind: null }],
      })} />);
      expect(cta.isConnected).toBe(false);
      expect(document.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "true");
    }
    const jobsWindow = screen.getByRole("dialog", { name: "전자문서 작업", hidden: true });
    const target = removeCta ? jobsWindow.querySelector<HTMLElement>('[data-slot="pane-header-back"]')! : cta;
    const focusedWhileInert: boolean[] = [];
    const nativeFocus = HTMLElement.prototype.focus;
    const focus = jest.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
      focusedWhileInert.push(Boolean(this.closest("[inert]")));
      nativeFocus.call(this, options);
    });
    const event = new Event("closeAutoFocus", { cancelable: true });
    if (order === "handler first") {
      act(() => { props.onCloseAutoFocus?.(event); props.onClose(); });
    } else {
      act(() => { props.onClose(); });
      act(() => { props.onCloseAutoFocus?.(event); });
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-slot="document-jobs-interaction"]')).not.toHaveAttribute("inert");
    expect(target).toHaveFocus();
    expect(focus.mock.contexts.filter(element => element === target)).toHaveLength(1);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focusedWhileInert).toEqual([false]);
    expect(document.querySelector('[data-slot="document-jobs-trigger"]')).not.toHaveFocus();
  });
});


describe.each([390, 1280])("recovery list focus at %spx", width => {
  let originalWidth: number;
  beforeEach(() => {
    originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  });
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  });

  test("discards a stale recovery callback after the jobs window closes and reopens", async () => {
    const view = render(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    fireEvent.click(screen.getByRole("button", { name: "수동 전송" }));
    const a = mockRecoveryDialog.mock.calls.at(-1)![0];
    act(() => { a.onClose(); });

    view.rerender(<ContractDocumentJobsPopover open={false} documentJobs={JOBS} data-component={BASE} />);
    view.rerender(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    const card = screen.getByRole("button", { name: /김하늘.*상세 보기/ });
    card.focus();
    expect(card).toHaveFocus();
    const focus = jest.spyOn(HTMLElement.prototype, "focus");
    const event = new Event("closeAutoFocus", { cancelable: true });
    const before = focus.mock.calls.length;
    act(() => { a.onCloseAutoFocus?.(event); });
    expect(focus.mock.calls.length).toBe(before);
    expect(card).toHaveFocus();
  });

  test("discards a stale recovery callback after the user closes and reopens the jobs window", async () => {
    const onOpenChange = jest.fn();
    render(<ContractDocumentJobsPopover defaultOpen documentJobs={JOBS} data-component={BASE} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    fireEvent.click(screen.getByRole("button", { name: "수동 전송" }));
    const a = mockRecoveryDialog.mock.calls.at(-1)![0];
    act(() => { a.onClose(); });

    fireEvent.click(screen.getByRole("button", { name: "전자문서 작업 닫기" }));
    expect(screen.queryByRole("dialog", { name: "전자문서 작업" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "전자문서 처리중" }));
    expect(onOpenChange.mock.calls).toEqual([[false], [true]]);
    expect(screen.getByRole("dialog", { name: "전자문서 작업" })).toBeInTheDocument();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    const card = screen.getByRole("button", { name: /김하늘.*상세 보기/ });
    card.focus();
    expect(card).toHaveFocus();
    const focus = jest.spyOn(HTMLElement.prototype, "focus");
    const event = new Event("closeAutoFocus", { cancelable: true });
    const before = focus.mock.calls.length;
    act(() => { a.onCloseAutoFocus?.(event); });
    expect(focus.mock.calls.length).toBe(before);
    expect(card).toHaveFocus();
  });

  test("returns focus from the latest recovery callback when the jobs window closes with recovery still open", async () => {
    const view = render(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    fireEvent.click(screen.getByRole("button", { name: "수동 전송" }));

    view.rerender(<ContractDocumentJobsPopover open={false} documentJobs={JOBS} data-component={BASE} />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    const latest = mockRecoveryDialog.mock.calls.at(-1)![0];
    const focus = jest.spyOn(HTMLElement.prototype, "focus");
    const event = new Event("closeAutoFocus", { cancelable: true });
    act(() => { latest.onClose(); latest.onCloseAutoFocus?.(event); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    expect(document.querySelector('[data-slot="document-jobs-trigger"]')).toHaveFocus();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test.each(["handler first", "close first"] as const)("returns focus to the list exactly once with the job removed: %s", async order => {
    const view = render(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
    const scroller = document.querySelector('[data-slot="document-jobs-list-scroller"]')!;
    scroller.scrollTop = 67;
    fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
    fireEvent.click(screen.getByRole("button", { name: "수동 전송" }));
    const props = mockRecoveryDialog.mock.calls.at(-1)![0];
    scroller.scrollTop = 0;
    view.rerender(<ContractDocumentJobsPopover open documentJobs={makeJobList()} data-component={BASE} />);
    const target = within(document.querySelector<HTMLElement>('[data-slot="sliding-detail-list"]')!).getByRole("button", { name: "전자문서 작업 닫기", hidden: true });
    const focusedWhileInert: boolean[] = [];
    const nativeFocus = HTMLElement.prototype.focus;
    const focus = jest.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
      focusedWhileInert.push(Boolean(this.closest("[inert]")));
      nativeFocus.call(this, options);
    });
    const event = new Event("closeAutoFocus", { cancelable: true });
    if (order === "handler first") {
      act(() => { props.onCloseAutoFocus?.(event); props.onClose(); });
    } else {
      act(() => { props.onClose(); });
      act(() => { props.onCloseAutoFocus?.(event); });
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

    expect(event.defaultPrevented).toBe(true);
    expect(target).toHaveFocus();
    expect(focus.mock.contexts.filter(element => element === target)).toHaveLength(1);
    expect(focusedWhileInert).not.toContain(true);
    expect(scroller.scrollTop).toBe(67);
  });
});

test("discards a stale recovery callback from an earlier opening in the same scope", async () => {
  render(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
  fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
  fireEvent.click(screen.getByRole("button", { name: "수동 전송" }));
  const a = mockRecoveryDialog.mock.calls.at(-1)![0];
  act(() => { a.onClose(); });
  const cta = screen.getByRole("button", { name: "수동 전송" });
  fireEvent.click(cta);
  const b = mockRecoveryDialog.mock.calls.at(-1)![0];
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  const staleEvent = new Event("closeAutoFocus", { cancelable: true });
  act(() => { a.onCloseAutoFocus?.(staleEvent); });
  expect(staleEvent.defaultPrevented).toBe(true);
  expect(focus).not.toHaveBeenCalled();
  act(() => { b.onClose(); });
  act(() => { b.onCloseAutoFocus?.(new Event("closeAutoFocus", { cancelable: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

  expect(cta).toHaveFocus();
  expect(focus.mock.contexts.filter(element => element === cta)).toHaveLength(1);
  expect(focus).toHaveBeenCalledTimes(1);
});

test("discards a stale recovery callback after a route scope round trip", async () => {
  const view = render(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
  fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
  fireEvent.click(screen.getByRole("button", { name: "수동 전송" }));
  const a = mockRecoveryDialog.mock.calls.at(-1)![0];
  act(() => { a.onClose(); });

  mockPathname = "/clients";
  view.rerender(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
  mockPathname = "/contracts";
  view.rerender(<ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });

  const card = screen.getByRole("button", { name: /김하늘.*상세 보기/ });
  card.focus();
  expect(card).toHaveFocus();
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  const event = new Event("closeAutoFocus", { cancelable: true });
  const before = focus.mock.calls.length;
  act(() => { a.onCloseAutoFocus?.(event); });
  expect(focus.mock.calls.length).toBe(before);
  expect(card).toHaveFocus();
});

test("guards a stale recovery callback during the layout commit of a new route", async () => {
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  const event = new Event("closeAutoFocus", { cancelable: true });
  function RouteCommit({ invoke }: { invoke: boolean }) {
    useLayoutEffect(() => {
      if (!invoke) return;
      const before = focus.mock.calls.length;
      staleRecovery.onCloseAutoFocus?.(event);
      expect(focus.mock.calls.length).toBe(before);
    }, [invoke]);
    return null;
  }
  const view = render(<>
    <ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />
    <RouteCommit invoke={false} />
  </>);
  fireEvent.click(screen.getByRole("button", { name: /김하늘.*상세 보기/ }));
  fireEvent.click(screen.getByRole("button", { name: "수동 전송" }));
  const staleRecovery = mockRecoveryDialog.mock.calls.at(-1)![0];
  act(() => { staleRecovery.onClose(); });

  mockPathname = "/clients";
  view.rerender(<>
    <ContractDocumentJobsPopover open documentJobs={JOBS} data-component={BASE} />
    <RouteCommit invoke />
  </>);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(event.defaultPrevented).toBe(true);
});
