import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as React from "react";
import ts from "typescript";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoreVertical, X } from "lucide-react";

import { Button, ButtonLoadingContent } from "@/components/ui/button";
import { MobileDetailActions, type DetailAction } from "@/components/app/mobile-redesign/detail-sheet";

const source = ts.createSourceFile("page.tsx", readFileSync(require.resolve("./page"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error("Route markup not found");
  return found;
}

// Execute the route's authored JSX, not a duplicate fixture. The finalize dialog
// normally unmounts on submit; isolate its markup to cover both busy and idle
// states without changing the route's async flow or adding test-only exports.
function evaluate<T>(node: ts.Node, scope: Record<string, unknown>): T {
  const script = ts.transpileModule(`(${node.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
  return vm.runInNewContext(script, { React, Button, ButtonLoadingContent, MoreVertical, X, ...scope }) as T;
}

const finalize = findNode((node) => ts.isJsxElement(node)
  && node.openingElement.attributes.properties.some((prop) => ts.isJsxAttribute(prop)
    && prop.name.getText(source) === "onClick" && prop.getText(source).includes("handleFinalizeSubmit")));

it.each([false, true])("preserves the raw finalize button's idle recipe and uses only a Spinner while busy=%s", (busy) => {
  const handleFinalizeSubmit = jest.fn();
  render(evaluate<React.ReactElement>(finalize, { isFinalizeSubmitting: busy, handleFinalizeSubmit }));
  const button = screen.getByRole("button", { name: busy ? "처리 중" : "완료" });
  expect(button.tagName).toBe("BUTTON");
  expect(button).toHaveClass("flex-[2]", "rounded-xl", "bg-v3-primary", "py-3", "text-[0.88rem]", "font-bold", "text-white", "shadow-[0_4px_14px_rgba(20,50,100,0.18)]", "disabled:opacity-45");
  expect(button).not.toHaveClass("h-10", "hover:bg-primary/90", "btn-press");
  if (busy) {
    expect(button).toBeDisabled();
    expect(button).toHaveClass("relative");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    expect(button.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).not.toBeNull();
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("완료");
    fireEvent.click(button);
    expect(handleFinalizeSubmit).not.toHaveBeenCalled();
  } else {
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("data-loading");
    fireEvent.click(button);
    expect(handleFinalizeSubmit).toHaveBeenCalledTimes(1);
  }
});

it.each([false, true])("passes the idle re-request label and accessible busyLabel to detail actions (busy=%s)", (busy) => {
  const action = findNode((node) => ts.isObjectLiteralExpression(node)
    && node.properties.some((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(source) === "busyLabel"
      && prop.initializer.getText(source) === '"재알림 보내는 중"'));
  const handleDocumentReRequest = jest.fn();
  const props = evaluate<DetailAction>(action, {
    shouldReRequest: true, isReRequesting: busy, handleDocumentReRequest, handleReceiptShare: jest.fn(),
  });
  expect(props.label).toBe("재알림 보내기");
  expect(props.busyLabel).toBe("재알림 보내는 중");
  render(<MobileDetailActions data-component="mobile_contracts_detail-sheet_stack_detail-page_actions" name="contracts" actions={[props]} />);
  const button = screen.getByRole("button", { name: busy ? "재알림 보내는 중" : "재알림 보내기" });
  if (busy) {
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  } else {
    fireEvent.click(button);
    expect(handleDocumentReRequest).toHaveBeenCalledTimes(1);
  }
});

it.each(["계약 옵션", "닫기"])("renders %s as a 32px icon control with a 44px touch area", (label) => {
  const node = findNode((node) => ts.isJsxElement(node)
    && node.openingElement.attributes.properties.some((prop) => ts.isJsxAttribute(prop)
      && prop.name.getText(source) === "aria-label" && prop.initializer?.getText(source) === JSON.stringify(label)));
  render(evaluate<React.ReactElement>(node, { closeStaffIframe: jest.fn() }));
  const button = screen.getByRole("button", { name: label });
  expect(button).toHaveClass("relative", "h-8", "w-8", "after:absolute", "after:-inset-1.5", "after:content-['']");
  expect(button).not.toHaveClass("h-[44px]", "w-[44px]");
  expect(button).toHaveClass("[&_svg]:size-5");
});
