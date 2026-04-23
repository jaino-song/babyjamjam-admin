import { act, render, screen } from "@testing-library/react";

import { toast, useToast } from "./use-toast";

function ToastCounter() {
  const { toasts } = useToast();

  return <div data-testid="toast-count">{toasts.length}</div>;
}

describe("toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("auto-dismisses toasts after the configured duration", () => {
    render(<ToastCounter />);

    act(() => {
      toast({ title: "문서 삭제 완료", duration: 50 });
    });

    expect(screen.getByTestId("toast-count")).toHaveTextContent("1");

    act(() => {
      jest.advanceTimersByTime(49);
    });

    expect(screen.getByTestId("toast-count")).toHaveTextContent("1");

    act(() => {
      jest.advanceTimersByTime(301);
    });

    expect(screen.getByTestId("toast-count")).toHaveTextContent("0");
  });
});
