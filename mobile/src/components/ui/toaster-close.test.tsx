import { act, render, screen } from "@testing-library/react";

import { useToast } from "@/hooks/use-toast";

import { Toaster } from "./toaster";

jest.mock("@/hooks/use-toast", () => ({ useToast: jest.fn() }));
const mockUseToast = jest.mocked(useToast);

it("defaults to a 32px close button with a 44px touch area and preserves the compact opt-in", () => {
  const dismiss = jest.fn();
  mockUseToast.mockReturnValue({ toasts: [{ id: "test", title: "알림" }], dismiss, toast: jest.fn() });
  const { rerender } = render(<Toaster />);
  const button = screen.getByRole("button", { name: "알림 닫기" });
  expect(button).toHaveAttribute("data-slot", "toast-close");
  expect(button).toHaveClass("absolute", "-right-3", "-top-3", "h-8", "w-8", "after:absolute", "after:-inset-1.5", "after:content-['']", "opacity-0", "group-hover:opacity-100", "bg-v3-dark", "text-white");
  act(() => button.click());
  expect(dismiss).toHaveBeenCalledWith("test");
  rerender(<Toaster closeSize="compact" />);
  expect(button.className).toBe("absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-v3-dark text-white opacity-0 transition-opacity focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#9cc3ff] group-hover:opacity-100");
});
