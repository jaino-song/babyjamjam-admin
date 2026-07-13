import * as React from "react";
import { render } from "@testing-library/react";
import { Input } from "./input";

describe("Input Component", () => {
  it("renders default variant correctly", () => {
    const { container } = render(<Input />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("rounded-2xl");
    expect(input).toHaveClass("border-input");
  });

  it("renders v3 variant correctly", () => {
    const { container } = render(<Input variant="v3" />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("rounded-2xl");
    expect(input).toHaveClass("focus:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]");
  });

  it("renders v3-pill variant correctly", () => {
    const { container } = render(<Input variant="v3-pill" />);
    const input = container.querySelector("input");
    expect(input).toHaveClass("rounded-pill");
  });
});
