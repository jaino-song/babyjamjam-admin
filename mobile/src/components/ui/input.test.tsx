import * as React from "react";
import { render } from "@testing-library/react";
import { Input } from "./input";

describe("Input Component", () => {
  it("renders default variant correctly", () => {
    const { container } = render(<Input />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("rounded-2xl");
    expect(input).toHaveClass("border-input");
    expect(input).toHaveClass("border-input");
  });

  it("renders v3 variant correctly", () => {
    const { container } = render(<Input variant="v3" />);
    const input = container.querySelector("input");
    expect(input).toHaveAttribute("data-source-component", "Input");
    expect(input).toHaveClass(
      "h-[44px]",
      "rounded-[12px]",
      "border-[1.5px]",
      "border-input",
      "px-[14px]",
      "py-0",
      "text-[0.9rem]",
      "leading-normal",
    );
  });

  it("renders v3-pill variant correctly", () => {
    const { container } = render(<Input variant="v3-pill" />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("rounded-pill");
    expect(input).toHaveClass("border-input");
  });
});
