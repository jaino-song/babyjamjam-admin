import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";

import { MessageSenderApprovalModal } from "../MessageSenderApprovalModal";

let globalFocusStyle: HTMLStyleElement;

beforeEach(() => {
  globalFocusStyle = document.createElement("style");
  const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const focusRule = globals.match(/^\*:focus-visible[^{]*\{[^}]*\}/m);
  expect(focusRule).not.toBeNull();
  globalFocusStyle.textContent = focusRule?.[0] ?? "";
  document.head.append(globalFocusStyle);
});

afterEach(() => globalFocusStyle.remove());

it("puts outline cancel before request with one-third and two-thirds widths", () => {
  const onCancel = jest.fn();
  const onRequest = jest.fn();
  render(<MessageSenderApprovalModal open needsRequestPermission={false} onOpenChange={jest.fn()} onCancel={onCancel} onRequest={onRequest} />);
  const cancel = screen.getByRole("button", { name: "취소" });
  const request = screen.getByRole("button", { name: "신청하기" });
  expect(screen.getAllByRole("button")).toEqual([cancel, request]);
  expect(cancel).toHaveClass("flex-1", "border");
  expect(request).toHaveClass("flex-[2]");
  expect(cancel.parentElement).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]", "[&>*]:min-w-0");
  expect(screen.getByRole("dialog")).toHaveFocus();
  expect(screen.getByRole("dialog")).toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("dialog")).toHaveClass("outline-none");
  expect(screen.getByRole("dialog").matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(screen.getByRole("dialog")).outline).toBe("none");
  expect(getComputedStyle(screen.getByRole("dialog")).borderRadius).toBe("16px");
  fireEvent.click(cancel);
  fireEvent.click(request);
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onRequest).toHaveBeenCalledTimes(1);
});

it.each([{ isApprovalPending: true, needsRequestPermission: false }, { needsRequestPermission: true }])("keeps the single confirmation action full width (%o)", (props) => {
  render(<MessageSenderApprovalModal open {...props} onOpenChange={jest.fn()} onCancel={jest.fn()} onRequest={jest.fn()} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "확인" })).toHaveClass("flex-1");
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveFocus();
  expect(dialog.matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(dialog).outline).toBe("none");
  expect(getComputedStyle(dialog).borderRadius).toBe("16px");
});

it("keeps keyboard navigation inside the modal and restores its opener", async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><button type="button" onClick={() => setOpen(true)}>메시지 열기</button><MessageSenderApprovalModal open={open} needsRequestPermission={false} onOpenChange={setOpen} onCancel={() => setOpen(false)} onRequest={jest.fn()} /></>;
  }
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "메시지 열기" });
  await user.click(opener);
  expect(screen.getByRole("dialog")).toHaveFocus();
  await user.tab();
  const cancel = screen.getByRole("button", { name: "취소" });
  expect(cancel).toHaveFocus();
  expect(cancel).toHaveClass("focus-visible:ring-2");
  expect(getComputedStyle(cancel).outline).not.toBe("none");
  expect(getComputedStyle(cancel).outline).not.toBe("");
  await user.tab();
  expect(screen.getByRole("button", { name: "신청하기" })).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  await user.click(cancel);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
