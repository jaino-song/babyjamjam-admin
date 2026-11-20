import { render, screen } from "@testing-library/react";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";

import AllMenuPage from "./page";

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

describe("AllMenuPage agent entry", () => {
  it("names the /agent shortcut 에이전트", () => {
    jest.mocked(useGetAuthUser).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as ReturnType<typeof useGetAuthUser>);

    render(<AllMenuPage />);

    expect(screen.getByRole("link", { name: "에이전트" })).toHaveAttribute("href", "/agent");
    expect(screen.queryByRole("link", { name: /어시스턴트/ })).not.toBeInTheDocument();
  });
});
