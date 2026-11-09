import { fireEvent, render, screen } from "@testing-library/react";
import type { OverviewStepProps } from "../OverviewStep";
import { OverviewStep } from "../OverviewStep";

const props = (): OverviewStepProps => ({
    "data-component": "mobile_service-record_wizard", day: 1, draft: {}, defaultDate: () => "2026-11-02",
    context: { totalSessions: 5, startDate: "2026-11-02", header: {}, sessions: [
        { sessionIndex: 2, serviceDate: "2026-11-03", locked: true },
        { sessionIndex: 3, serviceDate: "2026-11-04", locked: true },
    ] },
    lockedDays: new Set([2, 3]), nextOpenDay: () => 1, isRecordFinalized: false, onOpenDay: jest.fn(),
});
it("keeps blank date lines and enables multiple empty sessions after a delete", () => {
    const p = props();
    const { container } = render(<OverviewStep {...p} />);
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-source-component="DayCard"]'));
    expect(cards[0]).toBeEnabled();
    expect(cards[3]).toBeEnabled();
    expect(cards[4]).toBeDisabled();
    expect(cards[0].querySelector('[data-component$="_date"]')?.textContent?.trim()).toBe("");
    expect(cards[1]).toHaveTextContent("11.03");
    expect(cards[3].querySelector('[data-component$="_date"]')?.textContent?.trim()).toBe("");
    fireEvent.click(cards[3]);
    expect(p.onOpenDay).toHaveBeenCalledWith(4, false);
    expect(screen.getAllByRole("button").filter((button) => button.textContent === "다음 회차 입력")).toHaveLength(1);
});
