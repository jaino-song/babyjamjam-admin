import { fireEvent, render, screen } from "@testing-library/react";

import { HolidayAddForm } from "../HolidayAddForm";
import { HolidayReviewEventCard } from "../review/HolidayReviewEventCard";

function expectBusy(label: string, idleLabel: string) {
  const button = screen.getByRole("button", { name: label });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  const idle = button.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  expect(idle).toHaveTextContent(idleLabel);
  expect(button.querySelector('[data-slot="button-spinner"]')).not.toBeNull();
  expect(screen.getByText(label)).toHaveClass("sr-only");
  return button;
}

it("uses a spinner during holiday creation and blocks another submission", () => {
  const onAdd = jest.fn();
  render(<HolidayAddForm today="2026-11-17" years={[2026]} pending onAdd={onAdd} />);
  fireEvent.click(expectBusy("추가 중", "공휴일 추가"));
  expect(onAdd).not.toHaveBeenCalled();
});

it("blocks repeated holiday fixes even when only fixing is set", () => {
  const onFixSafe = jest.fn();
  render(<HolidayReviewEventCard event={{ id: "qa-event", date: "2026-11-18", name: "QA-공휴일", change: "added", source: "kasi", safeOpen: 2, riskOpen: 0, createdAt: "2026-11-17T00:00:00Z" }} fixing disabled={false} onOpenList={jest.fn()} onFixSafe={onFixSafe} dataComponent="mobile_holidays_review_event" />);
  fireEvent.click(expectBusy("수정 중", "2명 한 번에 수정"));
  expect(onFixSafe).not.toHaveBeenCalled();
});

it("uses the approved 16px add-form surface", () => {
  const { container } = render(<HolidayAddForm today="2026-11-17" years={[2026]} onAdd={jest.fn()} />);
  expect(container.querySelector("form")).toHaveClass("rounded-[16px]", "bg-transparent", "border");
  expect(container.querySelector("form")).not.toHaveClass("rounded-2xl");
});
