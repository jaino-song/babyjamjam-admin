import { fireEvent, render, screen } from "@testing-library/react";

import { CalendarLoadNotice } from "../calendar-load-notice";

describe("CalendarLoadNotice", () => {
  it("renders nothing when there is no error and nothing is loading", () => {
    const { container } = render(<CalendarLoadNotice error={null} onRetry={jest.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("asks for a branch when none is selected, with no retry action", () => {
    render(<CalendarLoadNotice error="no-branch" onRetry={jest.fn()} />);

    expect(screen.getByText("지점을 선택한 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reports a load failure and retries on click", () => {
    const onRetry = jest.fn();
    render(<CalendarLoadNotice error="load-failed" onRetry={onRetry} />);

    expect(screen.getByText("공휴일 정보를 불러오지 못했어요.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a muted loading line while loading without an error", () => {
    const { container } = render(<CalendarLoadNotice error={null} loading />);

    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).toBeInTheDocument();
    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).not.toHaveClass("sr-only");
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the shared spinner only when opted in, with a screen-reader label", () => {
    const { container } = render(<CalendarLoadNotice error={null} loading indicator="spinner" />);

    expect(container.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).toHaveClass("sr-only");
    expect(screen.getByRole("status")).toHaveTextContent("공휴일 정보를 불러오는 중이에요…");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps save-time messages and errors ahead of the opt-in loading spinner", () => {
    const { container, rerender } = render(
      <CalendarLoadNotice error={null} loading indicator="spinner" message="공휴일 정보가 변경됐어요." />,
    );
    expect(screen.getByText("공휴일 정보가 변경됐어요.")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();

    rerender(<CalendarLoadNotice error="load-failed" loading indicator="spinner" onRetry={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("공휴일 정보를 불러오지 못했어요.");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
  });

  it("lets an error take precedence over the loading line", () => {
    render(<CalendarLoadNotice error="load-failed" loading onRetry={jest.fn()} />);

    expect(screen.queryByText("공휴일 정보를 불러오는 중이에요…")).not.toBeInTheDocument();
    expect(screen.getByText("공휴일 정보를 불러오지 못했어요.")).toBeInTheDocument();
  });

  it("accepts a caller-context data-component", () => {
    const { container } = render(
      <CalendarLoadNotice error="no-branch" dataComponent="mobile_contracts_form_calendar-load-notice" />,
    );

    expect(container.querySelector('[data-component="mobile_contracts_form_calendar-load-notice"]')).not.toBeNull();
    expect(container.querySelector('[data-source-component="CalendarLoadNotice"]')).not.toBeNull();
  });

  it("explains an unsupported year without a retry action", () => {
    render(<CalendarLoadNotice error="unsupported-year" onRetry={jest.fn()} />);

    expect(
      screen.getByText("이 기간의 공휴일 정보가 아직 없어요. 종료일을 계산할 수 없어요."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
