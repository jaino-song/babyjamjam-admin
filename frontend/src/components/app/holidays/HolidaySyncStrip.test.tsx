import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { HolidaySyncStrip } from "./HolidaySyncStrip";

const NOT_SYNCED = "아직 동기화되지 않았어요 (기본 공휴일 목록 사용 중)";

function renderStrip(props: Partial<ComponentProps<typeof HolidaySyncStrip>> = {}) {
  const onSync = jest.fn();
  render(
    <HolidaySyncStrip
      lastSyncedAt={null}
      pending={false}
      results={null}
      errorMessage={null}
      onSync={onSync}
      {...props}
    />,
  );
  return { onSync };
}

describe("HolidaySyncStrip", () => {
  it("prints the not-synced sentence when the year is loaded and not synced", () => {
    renderStrip({ synced: false });

    expect(screen.getByText(NOT_SYNCED)).toBeInTheDocument();
  });

  it("prints the last sync time when the year is loaded and synced", () => {
    renderStrip({ synced: true, lastSyncedAt: "2026-09-30T19:00:00.000Z" });

    expect(screen.getByText("마지막 동기화 10월 1일 04:00")).toBeInTheDocument();
    expect(screen.queryByText(NOT_SYNCED)).not.toBeInTheDocument();
  });

  it("prints no status sentence while the sync state is unknown, but keeps the sync button and results", () => {
    const { onSync } = renderStrip({
      synced: undefined,
      results: [{ year: 2026, status: "unchanged", added: 0, removed: 0 }],
    });

    expect(screen.queryByText(NOT_SYNCED)).not.toBeInTheDocument();
    expect(screen.queryByText(/마지막 동기화/)).not.toBeInTheDocument();
    expect(document.querySelector("[data-slot='holiday-sync-status']")).toBeNull();
    expect(screen.getByText("2026년 변경 없음")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});
