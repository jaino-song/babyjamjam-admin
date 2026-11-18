import * as Sentry from "@sentry/nextjs";
import { fireEvent, render, screen } from "@testing-library/react";

import StatsError from "./error";

jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

beforeEach(() => { jest.clearAllMocks(); });

it("shows unavailable statistics and invokes the segment refetch action", () => {
  const retry = jest.fn();
  render(<StatsError error={new Error("private detail")} retry={retry} />);

  expect(screen.getByRole("alert")).toHaveTextContent("통계를 불러오지 못했어요");
  expect(screen.queryByText("미해결 이슈가 없어요")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledTimes(1);
});


it("reports each new boundary error without reporting ordinary rerenders", () => {
  const error = new Error("stats render failed");
  const retry = jest.fn();
  const { rerender } = render(<StatsError error={error} retry={retry} />);
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  expect(Sentry.captureException).toHaveBeenCalledWith(error);
  rerender(<StatsError error={error} retry={retry} />);
  expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  const nextError = new Error("next stats failure");
  rerender(<StatsError error={nextError} retry={retry} />);
  expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  expect(Sentry.captureException).toHaveBeenLastCalledWith(nextError);
  expect(screen.queryByText(error.message)).not.toBeInTheDocument();
});
