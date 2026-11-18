import * as Sentry from "@sentry/nextjs";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

import GlobalError from "./global-error";

describe("mobile global error boundary", () => {
  it("keeps the existing ErrorFallback recovery action safe and user-facing", () => {
    const reset = jest.fn();

    render(
      <GlobalError error={new Error("secret mobile detail")} reset={reset} />,
    );

    expect(
      document.querySelector('[data-component="mobile_error_fallback_container"]'),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "다시 시도" });
    expect(retry).toHaveAttribute(
      "data-component",
      "mobile_error_fallback_container_card_retry",
    );
    expect(retry).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.queryByText("secret mobile detail")).not.toBeInTheDocument();

    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(reset).toHaveBeenCalledTimes(2);
  });
});


describe("Sentry error reporting", () => {
  beforeEach(() => jest.clearAllMocks());

  it("captures once for each error and keeps the same-error rerender quiet", () => {
    const error = new Error("render failed");
    const reset = jest.fn();
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rerender } = render(<GlobalError error={error} reset={reset} />);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(error);
      rerender(<GlobalError error={error} reset={reset} />);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      const nextError = new Error("next render failed");
      rerender(<GlobalError error={nextError} reset={reset} />);
      expect(Sentry.captureException).toHaveBeenCalledTimes(2);
      expect(Sentry.captureException).toHaveBeenLastCalledWith(nextError);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
