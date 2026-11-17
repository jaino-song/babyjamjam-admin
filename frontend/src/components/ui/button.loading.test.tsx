import { render, screen } from "@testing-library/react";

import { Button, ButtonLoadingContent, buttonVariants } from "./button";
import { cn } from "@/lib/utils";

describe("Button loading", () => {
  it.each([undefined, false, true])("disables a loading button with disabled=%s", (disabled) => {
    const onClick = jest.fn();
    render(<Button loading disabled={disabled} onClick={onClick}>저장</Button>);

    const button = screen.getByRole("button", { name: "처리 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
    expect(button.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);
    expect(button.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector('[data-slot="button-spinner"]')).toHaveClass("absolute", "inset-0", "flex", "items-center", "justify-center");
  });

  it("names the busy button with its custom label and preserves caller positioning", () => {
    render(<Button loading loadingLabel={<strong>저장 중</strong>} className="absolute">저장</Button>);

    const button = screen.getByRole("button", { name: "저장 중" });
    expect(button).toHaveClass("absolute");
    expect(button).not.toHaveClass("relative");
    expect(screen.getByText("저장 중").parentElement).toHaveClass("sr-only");
  });

  it.each([undefined, false])("keeps the original idle markup for loading=%s", (loading) => {
    const { container, rerender } = render(
      <button data-size="default" data-slot="button" data-variant="positive" className={cn(buttonVariants())} type="submit">저장</button>,
    );
    const original = container.innerHTML;

    rerender(<Button type="submit" loading={loading} loadingLabel="저장 중">저장</Button>);
    expect(container.innerHTML).toBe(original);
  });

  it.each([undefined, false, true])("ignores loading for asChild and forwards disabled=%s unchanged", (disabled) => {
    const { container, rerender } = render(
      <Button asChild disabled={disabled}><button type="button">열기</button></Button>,
    );
    expect(screen.getByRole("button", { name: "열기" })).toHaveProperty("disabled", disabled === true);
    const original = container.innerHTML;

    rerender(<Button asChild loading loadingLabel="열기 중" disabled={disabled}><button type="button">열기</button></Button>);
    expect(container.innerHTML).toBe(original);
    const child = screen.getByRole("button", { name: "열기" });
    expect(child).toHaveProperty("disabled", disabled === true);
    expect(child).not.toHaveAttribute("loading");
    expect(child).not.toHaveAttribute("loadingLabel");
    expect(child).not.toHaveAttribute("aria-busy");
    expect(child).not.toHaveAttribute("data-loading");
    expect(child.querySelector('[data-slot="spinner"]')).toBeNull();
  });

  it("renders ButtonLoadingContent children unchanged until loading", () => {
    const { container, rerender } = render(<ButtonLoadingContent><b>삭제</b></ButtonLoadingContent>);
    expect(container.innerHTML).toBe("<b>삭제</b>");

    rerender(<button><ButtonLoadingContent loading loadingLabel="삭제 중"><b>삭제</b></ButtonLoadingContent></button>);
    const button = screen.getByRole("button", { name: "삭제 중" });
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
    expect(button.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);

    rerender(<button><ButtonLoadingContent loading>삭제</ButtonLoadingContent></button>);
    expect(screen.getByRole("button", { name: "처리 중" })).toBeInTheDocument();
  });
});
