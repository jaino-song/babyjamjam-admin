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
it("keeps blank date lines and enables every gap and the next session after a delete", () => {
    const p = props();
    p.openDays = () => [1, 4];
    const { container } = render(<OverviewStep {...p} />);
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-source-component="DayCard"]'));
    expect(cards[0]).toBeEnabled();
    expect(cards[0]).toHaveTextContent("입력 가능");
    expect(screen.getAllByText("입력 가능")).toHaveLength(2);
    expect(cards[3]).toBeEnabled();
    expect(cards[3]).toHaveTextContent("입력 가능");
    expect(cards[4]).toBeDisabled();
    expect(cards[4]).toHaveTextContent("대기");
    expect(cards[0].querySelector('[data-component$="_date"]')?.textContent?.trim()).toBe("");
    expect(cards[1]).toHaveTextContent("11.03");
    expect(cards[3].querySelector('[data-component$="_date"]')?.textContent?.trim()).toBe("");
    fireEvent.click(cards[3]);
    expect(p.onOpenDay).toHaveBeenLastCalledWith(4, false);
    fireEvent.click(cards[0]);
    expect(p.onOpenDay).toHaveBeenLastCalledWith(1, false);
    for (const index of [1, 2]) {
        expect(cards[index]).toBeEnabled();
        expect(cards[index]).toHaveTextContent("제출완료");
        fireEvent.click(cards[index]);
        expect(p.onOpenDay).toHaveBeenLastCalledWith(index + 1, true);
    }
    fireEvent.click(screen.getByRole("button", { name: "다음 회차 입력" }));
    expect(p.onOpenDay).toHaveBeenLastCalledWith(1);
});

it("enables session 4 and opens it from the footer when sessions 1 through 3 are submitted", () => {
    const p = props();
    p.context.sessions.unshift({ sessionIndex: 1, serviceDate: "2026-11-02", locked: true });
    p.lockedDays = new Set([1, 2, 3]);
    p.nextOpenDay = () => 4;
    const { container } = render(<OverviewStep {...p} />);
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-source-component="DayCard"]'));
    expect(screen.getAllByText("입력 가능")).toHaveLength(1);
    expect(cards[3]).toBeEnabled();
    expect(cards[3]).toHaveTextContent("입력 가능");
    expect(cards[4]).toBeDisabled();
    expect(cards[4]).toHaveTextContent("대기");
    fireEvent.click(cards[3]);
    expect(p.onOpenDay).toHaveBeenLastCalledWith(4, false);
    fireEvent.click(screen.getByRole("button", { name: "다음 회차 입력" }));
    expect(p.onOpenDay).toHaveBeenLastCalledWith(4);
});

it("enlarges the overview title, help and action text one step", () => {
    render(<OverviewStep {...props()} onOpenGuide={jest.fn()} />);
    expect(document.querySelector('[data-component$="_body_overview-title"]')).toHaveClass("text-xl");
    expect(document.querySelector('[data-component$="_body_overview-help"]')).toHaveClass("text-base");
    expect(screen.getByRole("button", { name: "사용방법" })).toHaveClass("text-base");
    expect(screen.getByRole("button", { name: "다음 회차 입력" })).toHaveClass("text-base", "leading-tight");
});

it("opens gap session 2 even when session 1 is also unsubmitted", () => {
    const p = props();
    p.lockedDays = new Set([3]);
    p.openDays = () => [1, 2, 4];
    const { container } = render(<OverviewStep {...p} />);
    const cards = container.querySelectorAll<HTMLButtonElement>('[data-source-component="DayCard"]');
    expect(cards[1]).toBeEnabled();
    expect(cards[1]).toHaveTextContent("입력 가능");
    fireEvent.click(cards[1]);
    expect(p.onOpenDay).toHaveBeenCalledWith(2, false);
});
