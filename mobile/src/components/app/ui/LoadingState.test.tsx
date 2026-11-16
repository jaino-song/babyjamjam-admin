import { render, screen } from "@testing-library/react";

import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("names its status and hides its only text in the live region", () => {
    render(<LoadingState label="고객 정보를 불러오는 중" data-component="mobile_clients_detail_loading" className="min-h-40" />);
    const status = screen.getByRole("status", { name: "고객 정보를 불러오는 중" });
    expect(status.tagName).toBe("DIV");
    expect(status).toHaveAttribute("data-component", "mobile_clients_detail_loading");
    expect(status).toHaveAttribute("data-slot", "loading-state");
    expect(status).toHaveAttribute("data-source-component", "LoadingState");
    expect(status).toHaveClass("flex", "items-center", "justify-center", "py-12", "min-h-40");
    expect(status.children).toHaveLength(2);
    expect(status.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(status.lastElementChild).toHaveClass("sr-only");
    expect(status.lastElementChild).toHaveTextContent(status.textContent ?? "");
    expect(status.firstElementChild).toHaveClass("h-6", "w-6");
  });

  it.each([["sm", "h-4", "w-4"], ["lg", "h-8", "w-8"]] as const)("renders an inline span with Spinner size %s", (size, height, width) => {
    render(<LoadingState label="불러오는 중" data-component="mobile_clients_row_loading" inline size={size} />);
    const status = screen.getByRole("status", { name: "불러오는 중" });
    expect(status.tagName).toBe("SPAN");
    expect(status).toHaveClass("inline-flex", "items-center");
    expect(status).not.toHaveClass("py-12");
    expect(status.querySelector('[data-slot="spinner"]')).toHaveClass(height, width);
  });
});
