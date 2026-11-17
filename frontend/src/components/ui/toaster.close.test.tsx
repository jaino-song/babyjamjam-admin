import { fireEvent, render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

import { Toaster } from "./toaster";

jest.mock("next/navigation", () => ({ usePathname: jest.fn() }));
jest.mock("@/hooks/use-toast", () => ({ useToast: jest.fn() }));

const mockPathname = usePathname as jest.MockedFunction<() => string | null>;
const dismiss = jest.fn();
const compactClasses = "absolute right-2 top-2 rounded-md p-1 opacity-0 transition-opacity focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100";

beforeEach(() => {
  jest.clearAllMocks();
  mockPathname.mockReturnValue(null);
  jest.mocked(useToast).mockReturnValue({
    toasts: [{ id: "test-toast", title: "완료", description: "저장했습니다" }],
    dismiss,
    toast: jest.fn(),
  });
});

function expectTouch(close: HTMLElement) {
  expect(close).toHaveClass(
    "h-[calc(32px*var(--glint-ui-scale,1))]",
    "w-[calc(32px*var(--glint-ui-scale,1))]",
    "after:absolute", "after:left-1/2", "after:top-1/2",
    "after:h-[calc(44px*var(--glint-ui-scale,1))]",
    "after:w-[calc(44px*var(--glint-ui-scale,1))]",
    "after:-translate-x-1/2", "after:-translate-y-1/2", "after:content-['']",
    "absolute", "right-1", "top-1", "p-0",
    "opacity-0", "focus:opacity-100", "group-hover:opacity-100",
  );
  expect(close.parentElement).toHaveClass("pr-12");
  expect(close.querySelector("svg")).toHaveClass("h-4", "w-4");
}

function expectCompact(close: HTMLElement) {
  expect(close.className.split(" ").sort()).toEqual(compactClasses.split(" ").sort());
  expect(close.parentElement).toHaveClass("pr-8");
  expect(close.parentElement).not.toHaveClass("pr-12");
  expect(close.querySelector("svg")).toHaveClass("h-4", "w-4");
}

describe("Toaster close sizes", () => {
  it("defaults to touch without app-router context and dismisses the toast", () => {
    render(<Toaster />);
    const close = screen.getByRole("button", { name: "알림 닫기" });
    expectTouch(close);
    fireEvent.click(close);
    expect(dismiss).toHaveBeenCalledWith("test-toast");
  });

  it("supports explicit compact and touch sizes", () => {
    const { rerender } = render(<Toaster closeSize="compact" />);
    expectCompact(screen.getByRole("button", { name: "알림 닫기" }));

    rerender(<Toaster closeSize="touch" />);
    expectTouch(screen.getByRole("button", { name: "알림 닫기" }));
  });

  it.each(["/service-record-admin", "/service-record-admin/189", "/service-record-admin/189/history"])(
    "keeps the legacy close button on %s even when touch is requested", (pathname) => {
      mockPathname.mockReturnValue(pathname);
      render(<Toaster closeSize="touch" />);
      expectCompact(screen.getByRole("button", { name: "알림 닫기" }));
    },
  );

  it.each(["/clients", "/service-record-admin-tools", "/service-record/189", "/receipt/189"])(
    "uses touch on %s", (pathname) => {
      mockPathname.mockReturnValue(pathname);
      render(<Toaster />);
      expectTouch(screen.getByRole("button", { name: "알림 닫기" }));
    },
  );

  it("switches sizes when navigation changes the pathname", () => {
    mockPathname.mockReturnValue("/clients");
    const { rerender } = render(<Toaster />);
    expectTouch(screen.getByRole("button", { name: "알림 닫기" }));

    mockPathname.mockReturnValue("/service-record-admin/189");
    rerender(<Toaster />);
    expectCompact(screen.getByRole("button", { name: "알림 닫기" }));

    mockPathname.mockReturnValue("/clients");
    rerender(<Toaster />);
    expectTouch(screen.getByRole("button", { name: "알림 닫기" }));
  });
});
