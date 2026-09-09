import { fireEvent, render, screen } from "@testing-library/react";

import { LoginAuthErrorModal } from "../login-auth-error-modal";

const mockReplace = jest.fn();
let authError: string | null = null;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({
    get: (key: string) => (key === "authError" ? authError : null),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  authError = null;
});

describe("LoginAuthErrorModal", () => {
  it("shows the pending approval callback as a modal", () => {
    authError = "PENDING_APPROVAL";
    render(<LoginAuthErrorModal />);
    expect(screen.getByRole("dialog", { name: "관리자 승인 대기 중입니다." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it.each([
    ["ACCOUNT_REJECTED", "가입이 거부됐어요."],
    ["ACCOUNT_PROFILE_INCOMPLETE", "가입 정보가 누락됐어요."],
    ["OAUTH_CANCELLED", "카카오 로그인이 취소되었습니다."],
    ["INVALID_OAUTH_STATE", "로그인 요청이 만료됐어요."],
  ])("shows the allowlisted %s error", (code, title) => {
    authError = code;
    render(<LoginAuthErrorModal />);
    expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
  });

  it("does not show unrecognized callback errors", () => {
    authError = "UNTRUSTED_ERROR";
    render(<LoginAuthErrorModal />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
