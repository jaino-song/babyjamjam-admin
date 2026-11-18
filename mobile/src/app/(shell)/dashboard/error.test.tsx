import * as Sentry from "@sentry/nextjs";
import { fireEvent, render, screen } from "@testing-library/react";

import DashboardError from "./error";

jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

describe("dashboard error boundary", () => {
  beforeEach(() => jest.clearAllMocks());

  it("captures once per error while preserving recovery UI", () => {
    const error = new Error("secret render detail");
    const reset = jest.fn();
    const { rerender } = render(<DashboardError error={error} reset={reset} />);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(screen.getByRole("alert")).toHaveTextContent("대시보드를 불러오는 중 문제가 발생했어요.");
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(reset).toHaveBeenCalledTimes(1);
    rerender(<DashboardError error={error} reset={reset} />);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const nextError = new Error("next render failed");
    rerender(<DashboardError error={nextError} reset={reset} />);
    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
    expect(Sentry.captureException).toHaveBeenLastCalledWith(nextError);
  });
});
