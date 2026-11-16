import { fireEvent, render, screen } from "@testing-library/react";

import { Alert } from "./alert";

it("renders a scaled 32px alert close button with a 44px hit area and 16px icon", () => {
  const onClose = jest.fn();
  render(<Alert onClose={onClose}>안내</Alert>);
  const close = screen.getByRole("button", { name: "Close alert" });

  expect(close).toHaveClass(
    "h-[calc(32px*var(--glint-ui-scale,1))]",
    "w-[calc(32px*var(--glint-ui-scale,1))]",
    "after:absolute", "after:left-1/2", "after:top-1/2",
    "after:h-[calc(44px*var(--glint-ui-scale,1))]",
    "after:w-[calc(44px*var(--glint-ui-scale,1))]",
    "after:-translate-x-1/2", "after:-translate-y-1/2", "after:content-['']",
    "absolute", "right-1", "top-1", "p-0",
  );
  expect(close.querySelector("svg")).toHaveClass("h-4", "w-4");
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(1);
});
