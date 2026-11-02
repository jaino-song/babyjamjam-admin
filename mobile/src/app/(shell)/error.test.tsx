import { fireEvent, render, screen } from "@testing-library/react";

import AppError from "./error";

const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

describe("mobile shell error boundary", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockRefresh.mockClear();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("shows a readable server-unavailable message instead of a blank page", () => {
    render(<AppError error={new Error("secret mobile detail")} reset={jest.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("서버에 연결할 수 없어요");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("retries by refetching the server components and then resetting the boundary", () => {
    const reset = jest.fn();

    render(<AppError error={new Error("secret mobile detail")} reset={reset} />);

    expect(mockRefresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
