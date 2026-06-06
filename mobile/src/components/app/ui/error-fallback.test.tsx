import { fireEvent, render, screen } from "@testing-library/react";

import { ErrorFallback } from "./error-fallback";

describe("ErrorFallback", () => {
  it("renders Korean copy and retries when the button is clicked", () => {
    const handleReset = jest.fn();

    render(
      <ErrorFallback
        description="잠시 후 다시 시도해주세요."
        onReset={handleReset}
        title="페이지를 불러오는 중 문제가 발생했어요."
      />,
    );

    expect(
      screen.getByText("페이지를 불러오는 중 문제가 발생했어요."),
    ).toBeInTheDocument();
    expect(screen.getByText("잠시 후 다시 시도해주세요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(handleReset).toHaveBeenCalledTimes(1);
  });
});
