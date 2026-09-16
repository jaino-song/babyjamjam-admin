import { fireEvent, render, screen } from "@testing-library/react";

import StatsError from "./error";

it("shows unavailable statistics and invokes the segment refetch action", () => {
  const retry = jest.fn();
  render(<StatsError retry={retry} />);

  expect(screen.getByRole("alert")).toHaveTextContent("통계를 불러오지 못했어요");
  expect(screen.queryByText("미해결 이슈가 없어요")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
