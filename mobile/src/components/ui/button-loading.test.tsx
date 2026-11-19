import { render, screen } from "@testing-library/react";

import { Button, ButtonLoadingContent } from "./button";

describe("Button loading", () => {
  it.each([undefined, false, true])("disables a loading button when disabled is %s", (disabled) => {
    render(<Button loading disabled={disabled}>저장</Button>);
    const button = screen.getByRole("button", { name: "처리 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
    expect(button.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    expect(button.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("announces the custom label and preserves the caller's positioning", () => {
    render(<Button loading loadingLabel="저장 중" className="absolute">저장</Button>);
    const button = screen.getByRole("button", { name: "저장 중" });
    expect(button).toHaveClass("absolute");
    expect(button).not.toHaveClass("relative");
    expect(button.querySelector(".sr-only")).toHaveTextContent("저장 중");
    expect(button.querySelector('[data-slot="button-spinner"]')).toHaveClass("absolute", "inset-0", "flex", "items-center", "justify-center");
  });

  it("keeps idle markup identical when loading is omitted or false", () => {
    const { container, rerender } = render(<Button disabled={false}>저장</Button>);
    const idle = container.innerHTML;
    rerender(<Button loading={false} loadingLabel="무시" disabled={false}>저장</Button>);
    expect(container.innerHTML).toBe(idle);
    expect(screen.getByRole("button", { name: "저장" })).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("button")).not.toHaveAttribute("data-loading");
  });

  it("ignores loading for asChild and does not leak loading props", () => {
    const { container, rerender } = render(<Button asChild disabled><button>링크</button></Button>);
    const idle = container.innerHTML;
    rerender(<Button asChild disabled loading loadingLabel="처리"><button>링크</button></Button>);
    expect(container.innerHTML).toBe(idle);
    const button = screen.getByRole("button", { name: "링크" });
    expect(button).toBeDisabled();
    for (const attribute of ["loading", "loadingLabel", "aria-busy", "data-loading"]) {
      expect(button).not.toHaveAttribute(attribute);
    }
  });
});

describe("ButtonLoadingContent", () => {
  it("renders the same three spans when busy and bare children otherwise", () => {
    const { container, rerender } = render(<ButtonLoadingContent loading loadingLabel="전송 중">전송</ButtonLoadingContent>);
    expect(container.children).toHaveLength(3);
    expect(container.children[0]).toHaveAttribute("data-slot", "button-idle");
    expect(container.children[0]).toHaveAttribute("aria-hidden", "true");
    expect(container.children[0]).toHaveClass("contents", "invisible");
    expect(container.children[1]).toHaveAttribute("data-slot", "button-spinner");
    expect(container.children[2]).toHaveClass("sr-only");
    expect(container.children[2]).toHaveTextContent("전송 중");
    rerender(<ButtonLoadingContent loading={false}><strong>전송</strong></ButtonLoadingContent>);
    expect(container.innerHTML).toBe("<strong>전송</strong>");
  });
});
