import * as React from "react";
import { render } from "@testing-library/react";
import { Input } from "./input";

describe("Input Component", () => {
  it("renders default variant correctly", () => {
    const { container } = render(<Input />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("rounded-md");
    expect(input).toHaveClass("border-input");
  });

  it("renders v3 variant correctly", () => {
    const { container } = render(<Input variant="v3" />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("h-[calc(38px*var(--glint-ui-scale,1))]");
    expect(input).toHaveClass("min-h-[calc(38px*var(--glint-ui-scale,1))]");
    expect(input).toHaveClass("rounded-[13px]");
    expect(input).toHaveClass("border-[1.35px]");
    expect(input).toHaveClass("px-[calc(14px*var(--glint-ui-scale,1))]");
    expect(input).toHaveClass("py-[calc(8px*var(--glint-ui-scale,1))]");
    expect(input).toHaveClass("text-[calc(12px*var(--glint-ui-scale,1))]");
    expect(input).toHaveClass("focus-visible:border-v3-primary");
    expect(input).toHaveClass("focus-visible:ring-[3px]");
  });

  it("renders v3-pill variant correctly", () => {
    const { container } = render(<Input variant="v3-pill" />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("rounded-pill");
  });
});
