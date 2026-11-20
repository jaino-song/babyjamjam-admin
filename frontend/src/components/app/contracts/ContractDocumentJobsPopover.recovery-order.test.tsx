import { act, fireEvent, render, screen } from "@testing-library/react";

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

test.each(["pending", "late"] as const)("scope reset discards a %s recovery focus return", async timing => {
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
