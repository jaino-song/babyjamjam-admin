import { fireEvent, render, screen } from "@testing-library/react";

import { QueryErrorState } from "./QueryErrorState";

const DC = "test_page_section_error";

describe("QueryErrorState", () => {
  it("renders the exact default title, an alert root and the given data-component", () => {
    render(<QueryErrorState dataComponent={DC} onRetry={jest.fn()} />);

    const root = screen.getByRole("alert");
    expect(root).toHaveAttribute("data-component", DC);
    expect(screen.getByText("불러오지 못했습니다")).toBeInTheDocument();
    expect(root.querySelector('[data-slot="title"]')).toHaveTextContent(/^불러오지 못했습니다$/);
    expect(root.querySelector('[data-slot="description"]')).toBeNull();
  });

  it("tags the inner parts with data-component and data-slot", () => {
    render(<QueryErrorState dataComponent={DC} onRetry={jest.fn()} description="잠시 후 다시 시도해 주세요." />);

    const root = screen.getByRole("alert");
    expect(root.querySelector(`[data-component="${DC}_title"][data-slot="title"]`)).not.toBeNull();
    expect(root.querySelector(`[data-component="${DC}_description"][data-slot="description"]`)).not.toBeNull();
    expect(root.querySelector(`[data-component="${DC}_retry"][data-slot="retry"]`)).not.toBeNull();
  });

  it("renders title and description overrides", () => {
    render(
      <QueryErrorState
        dataComponent={DC}
        onRetry={jest.fn()}
        title="고객 목록을 불러오지 못했습니다"
        description="네트워크 상태를 확인해 주세요."
      />,
    );

    expect(screen.getByText("고객 목록을 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("네트워크 상태를 확인해 주세요.")).toBeInTheDocument();
    expect(screen.queryByText("불러오지 못했습니다")).not.toBeInTheDocument();
  });

  it("calls onRetry exactly once per click", () => {
    const onRetry = jest.fn();
    render(<QueryErrorState dataComponent={DC} onRetry={onRetry} />);

    const button = screen.getByRole("button", { name: "다시 시도" });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("disables the retry button and shows a spinner while retrying", () => {
    const onRetry = jest.fn();
    const { rerender } = render(<QueryErrorState dataComponent={DC} onRetry={onRetry} />);

    const idle = screen.getByRole("button", { name: "다시 시도" });
    expect(idle).toBeEnabled();
    expect(idle.querySelector('[data-slot="spinner"]')).toBeNull();

    rerender(<QueryErrorState dataComponent={DC} onRetry={onRetry} isRetrying />);

    const busy = screen.getByRole("button", { name: "다시 시도" });
    expect(busy).toBeDisabled();
    expect(busy.querySelector('[data-slot="spinner"]')).not.toBeNull();
    fireEvent.click(busy);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("keeps the alert role and retry button in both sizes", () => {
    const { rerender } = render(<QueryErrorState dataComponent={DC} onRetry={jest.fn()} size="panel" />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "panel");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();

    rerender(<QueryErrorState dataComponent={DC} onRetry={jest.fn()} size="inline" />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
