import { render, screen, waitFor } from "@testing-library/react";

import AuthCallbackPage from "./page";
import { exchangeToken } from "./actions";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("./actions", () => ({
  exchangeToken: jest.fn(),
}));

const mockExchangeToken = jest.mocked(exchangeToken);

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockExchangeToken.mockReset();
    mockSearchParams = new URLSearchParams();
  });

  it("shows the backend OAuth error instead of reporting a missing authorization code", async () => {
    mockSearchParams = new URLSearchParams({
      error: "접근 가능한 지점이 없습니다. 관리자에게 문의해 주세요.",
    });

    render(<AuthCallbackPage />);

    expect(
      await screen.findByText("접근 가능한 지점이 없습니다. 관리자에게 문의해 주세요."),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockExchangeToken).not.toHaveBeenCalled());
  });

  it("exchanges a valid authorization code and continues to the dashboard", async () => {
    mockSearchParams = new URLSearchParams({ code: "one-time-code" });
    mockExchangeToken.mockResolvedValue({ success: true });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockExchangeToken).toHaveBeenCalledWith("one-time-code"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dashboard"));
  });
});
