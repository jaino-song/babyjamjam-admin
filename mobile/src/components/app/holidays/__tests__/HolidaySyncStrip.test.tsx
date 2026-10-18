import { render, screen } from "@testing-library/react";

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
  it("says it is not synced when the year loaded and was never synced (default)", () => {
    renderStrip();

    expect(screen.getByText(NOT_SYNCED)).toBeInTheDocument();
  });

  it("shows a dash instead of the not-synced notice while the status is unknown, and keeps the button usable", () => {
    renderStrip({ statusUnknown: true });

    expect(screen.queryByText(NOT_SYNCED)).not.toBeInTheDocument();
    expect(document.querySelector("[data-slot='holiday-sync-status']")).toHaveTextContent(/^—$/);
    expect(screen.getByRole("button", { name: "지금 동기화" })).toBeEnabled();
  });

  it("keeps the last-synced label for a synced year", () => {
    renderStrip({ synced: true, lastSyncedAt: "2026-09-30T19:00:00.000Z" });

    expect(screen.getByText(/^마지막 동기화/)).toBeInTheDocument();
    expect(screen.queryByText(NOT_SYNCED)).not.toBeInTheDocument();
  });
});
