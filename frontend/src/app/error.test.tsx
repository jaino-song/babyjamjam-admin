import { fireEvent, render, screen } from "@testing-library/react";

import ErrorPage from "./error";

const mockRefresh = jest.fn();

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

describe("app error boundary", () => {
  beforeEach(() => {
    mockRefresh.mockClear();
  });

  it("shows a readable server-unavailable message without exposing the error details", () => {
    render(<ErrorPage error={new Error("secret backend detail")} reset={jest.fn()} />);

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-component",
      "desktop_error_recovery",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("서버에 연결할 수 없어요");
    expect(screen.queryByText("secret backend detail")).not.toBeInTheDocument();
  });

  it("retries by refetching the server components and then resetting the boundary", () => {
    const reset = jest.fn();

    render(<ErrorPage error={new Error("secret backend detail")} reset={reset} />);

    const retry = screen.getByRole("button", { name: "다시 시도" });
    expect(retry).toHaveAttribute("data-component", "desktop_error_recovery_retry");
    expect(reset).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();

    fireEvent.click(retry);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);

    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(2);
  });
});
