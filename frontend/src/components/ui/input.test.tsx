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
    expect(input).toHaveClass("h-10");
    expect(input).toHaveClass("rounded-2xl");
    expect(input).toHaveClass("focus-visible:border-v3-primary");
  });

  it("renders v3-pill variant correctly", () => {
    const { container } = render(<Input variant="v3-pill" />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("rounded-pill");
  });
});
