import { fireEvent, render, screen } from "@testing-library/react";

import { FooterNavigation } from "./footer-navigation";

it("opts into a named next-button spinner and restores the idle action", () => {
  const onNext = jest.fn();
  const props = { onPrev: jest.fn(), onNext, nextLabel: "등록", nextLoadingLabel: "등록 중" };
  const { rerender } = render(<FooterNavigation {...props} nextLoading />);
  const busy = screen.getByRole("button", { name: "등록 중" });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy.querySelectorAll('[data-slot="button-spinner"]')).toHaveLength(1);
  expect(busy.querySelector('[data-slot="button-idle"]')).toHaveTextContent("등록");
  expect(screen.getByRole("button", { name: "이전" })).toBeEnabled();
  fireEvent.click(busy);
  expect(onNext).not.toHaveBeenCalled();

  rerender(<FooterNavigation {...props} />);
  const idle = screen.getByRole("button", { name: "등록" });
  expect(idle).not.toHaveAttribute("aria-busy");
  expect(idle).not.toHaveAttribute("data-loading");
  fireEvent.click(idle);
  expect(onNext).toHaveBeenCalledTimes(1);
});
