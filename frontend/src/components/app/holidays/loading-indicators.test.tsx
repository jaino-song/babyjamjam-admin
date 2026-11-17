import { render, screen, within } from "@testing-library/react";
import { CalendarLoadNotice } from "./CalendarLoadNotice";
import { HolidayAddForm } from "./HolidayAddForm";
import { HolidaySyncStrip } from "./HolidaySyncStrip";

describe("holiday loading indicators", () => {
  it("preserves the default calendar notice and opts into a named, text-free Spinner", () => {
    const props = { loading: true, error: null, dataComponent: "desktop_contracts_creation_calendar-notice" };
    const { rerender } = render(<CalendarLoadNotice {...props} />);
    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).not.toHaveClass("sr-only");

    rerender(<CalendarLoadNotice {...props} indicator="spinner" />);
    const status = screen.getByRole("status", { name: "공휴일 정보를 불러오는 중이에요" });
    expect(status).toHaveAttribute("data-component", props.dataComponent);
    expect(status).toHaveAttribute("data-source-component", "LoadingState");
    expect(within(status).getByText("공휴일 정보를 불러오는 중이에요")).toHaveClass("sr-only");
    expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");

    rerender(<CalendarLoadNotice {...props} loading={false} indicator="spinner" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps calendar failures and their retry action in Spinner mode", () => {
    render(<CalendarLoadNotice error="load-failed" loading indicator="spinner" onRetry={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("공휴일 정보를 불러오지 못했어요.");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["add", "sync"])("hides the %s action label and prevents duplicate submits while pending", (action) => {
    const label = action === "add" ? "추가 중" : "동기화 중";
    const idle = action === "add" ? "공휴일 추가" : "지금 동기화";
    if (action === "add") {
      render(<HolidayAddForm today="2026-11-17" years={[2026]} pending onAdd={jest.fn()} />);
    } else {
      render(<HolidaySyncStrip lastSyncedAt={null} pending results={null} errorMessage={null} onSync={jest.fn()} />);
    }
    const button = screen.getByRole("button", { name: label });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    expect(within(button).getByText(idle)).toHaveAttribute("aria-hidden", "true");
    expect(within(button).getByText(idle)).toHaveClass("contents", "invisible");
    expect(within(button).getByText(label)).toHaveClass("sr-only");
    expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  });
});
