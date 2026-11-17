import { fireEvent, render, screen } from "@testing-library/react";

import { Alert } from "./alert";

it("keeps the alert close icon in its corner with a 32px box and 44px hit area", () => {
  const onClose = jest.fn();
  render(<Alert data-component="mobile_tests_notice" onClose={onClose} closeButtonLabel="공지 닫기" closeButtonClassName="custom-close">공지</Alert>);
  const button = screen.getByRole("button", { name: "공지 닫기" });
  expect(button).toHaveAttribute("data-component", "mobile_tests_notice-close-button");
  expect(button).toHaveClass("absolute", "right-1", "top-1", "h-8", "w-8", "after:absolute", "after:-inset-1.5", "after:content-['']", "custom-close");
  expect(button.querySelector("svg")).toHaveClass("h-4", "w-4");
  fireEvent.click(button);
  expect(onClose).toHaveBeenCalledTimes(1);
});
