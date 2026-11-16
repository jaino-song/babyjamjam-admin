import { render, screen } from "@testing-library/react";

import { LoadingState } from "./LoadingState";

const label = "고객 정보를 불러오는 중";
const dataComponent = "desktop_clients_panel_loading";

describe("LoadingState", () => {
  it("names the status and renders only a spinner and screen-reader text", () => {
    render(<LoadingState label={label} data-component={dataComponent} className="py-4" />);
    const status = screen.getByRole("status", { name: label });

    expect(status.tagName).toBe("DIV");
    expect(status).toHaveAttribute("data-component", dataComponent);
    expect(status).toHaveAttribute("data-slot", "loading-state");
    expect(status).toHaveAttribute("data-source-component", "LoadingState");
    expect(status).toHaveClass("flex", "items-center", "justify-center", "py-4");
    expect(status.children).toHaveLength(2);
    expect(status.childNodes).toHaveLength(2);
    expect(status.firstElementChild).toHaveAttribute("data-slot", "spinner");
    expect(status.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(status.firstElementChild).toHaveClass("h-6", "w-6");
    expect(status.lastElementChild?.tagName).toBe("SPAN");
    expect(status.lastElementChild).toHaveClass("sr-only");
    expect(status).toHaveTextContent(label);
  });

  it("renders an inline span without block padding", () => {
    render(<LoadingState inline label={label} data-component={dataComponent} />);
    const status = screen.getByRole("status", { name: label });
    expect(status.tagName).toBe("SPAN");
    expect(status.className).toBe("inline-flex items-center");
  });

  it.each([["sm", "h-4", "w-4"], ["default", "h-6", "w-6"], ["lg", "h-8", "w-8"]] as const)(
    "passes size %s to Spinner", (size, height, width) => {
      render(<LoadingState label={label} data-component={dataComponent} size={size} />);
      expect(screen.getByRole("status", { name: label }).firstElementChild).toHaveClass(height, width);
    },
  );
});
