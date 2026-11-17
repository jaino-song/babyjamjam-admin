import { fireEvent, render, screen } from "@testing-library/react";

import { HolidaySyncStrip } from "../HolidaySyncStrip";

const NOT_SYNCED = "아직 동기화되지 않았어요 (기본 공휴일 목록 사용 중)";

function renderStrip(props: Partial<Parameters<typeof HolidaySyncStrip>[0]> = {}) {
  return render(
    <HolidaySyncStrip
      synced={false}
      lastSyncedAt={null}
      pending={false}
      results={null}
      errorMessage={null}
      onSync={jest.fn()}
      {...props}
    />,
  );
}

describe("HolidaySyncStrip status line", () => {
  it("uses the approved 16px outlined surface", () => {
    const { container } = renderStrip();
    expect(container.firstElementChild).toHaveClass("rounded-[16px]", "bg-transparent", "border");
    expect(container.firstElementChild).not.toHaveClass("rounded-2xl");
  });

  it("says it is not synced when the year loaded and was never synced (default)", () => {
    renderStrip();

    expect(document.querySelector("[data-slot='holiday-sync-status']")).toHaveTextContent(NOT_SYNCED);
  });

  it("shows a dash instead of the not-synced notice while the status is unknown, and keeps the button usable", () => {
    renderStrip({ statusUnknown: true });

    expect(screen.queryByText(NOT_SYNCED)).not.toBeInTheDocument();
    expect(document.querySelector("[data-slot='holiday-sync-status']")).toHaveTextContent(/^—$/);
    expect(screen.getByRole("button", { name: "지금 동기화" })).toBeEnabled();
  });

  it("keeps the last-synced label for a synced year", () => {
    renderStrip({ synced: true, lastSyncedAt: "2026-09-30T19:00:00.000Z" });

    expect(document.querySelector("[data-slot='holiday-sync-status']")).toHaveTextContent("마지막 동기화 10월 1일 04:00");
    expect(screen.queryByText(NOT_SYNCED)).not.toBeInTheDocument();
  });

  it("centers a separate title and status line and uses a full-width primary action", () => {
    const onSync = jest.fn();
    renderStrip({ onSync });
    const title = screen.getByText("대한민국 공휴일");
    const status = document.querySelector("[data-slot='holiday-sync-status']");
    expect(title).toHaveAttribute("data-slot", "holiday-sync-title");
    expect(title.nextElementSibling).toBe(status);
    expect(title.parentElement).toHaveClass("text-center", "justify-items-center");
    expect(screen.queryByText(/매일 새벽 4시에/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "지금 동기화" });
    expect(button).toHaveClass("w-full", "bg-primary");
    fireEvent.click(button);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("uses a spinner and screen-reader label while syncing", () => {
    const onSync = jest.fn();
    const { container } = renderStrip({ pending: true, onSync });
    const button = screen.getByRole("button", { name: "동기화 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(screen.getByText("동기화 중")).toHaveClass("sr-only");
    expect(container).not.toHaveTextContent("동기화 중...");
    fireEvent.click(button);
    expect(onSync).not.toHaveBeenCalled();
  });

});
