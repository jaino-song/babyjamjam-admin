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
    render(<CalendarLoadNotice error={null} loading />);

    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
});
