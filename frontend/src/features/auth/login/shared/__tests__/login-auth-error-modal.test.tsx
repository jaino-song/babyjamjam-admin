import { fireEvent, render, screen } from "@testing-library/react";

import { LoginAuthErrorModal } from "../login-auth-error-modal";

const mockReplace = jest.fn();
let authError: string | null = null;
let returnTo: string | null = null;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === "authError") return authError;
      if (key === "returnTo") return returnTo;
      return null;
    },
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  authError = null;
  returnTo = null;
});

describe("LoginAuthErrorModal", () => {
  it("shows the exact pending-match title and description", () => {
    authError = "LINK_PENDING_APPROVAL";
    render(<LoginAuthErrorModal />);
    const dialog = screen.getByRole("dialog", { name: "승인 대기중 입니다." });
    expect(dialog).toHaveAccessibleDescription("관계자에게 문의해 주세요.");
    expect(screen.getByText("관계자에게 문의해 주세요.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("shows the pending approval callback as a modal", () => {
    authError = "PENDING_APPROVAL";
    render(<LoginAuthErrorModal />);
    expect(screen.getByRole("dialog", { name: "관리자 승인 대기 중입니다." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("preserves a safe editor return path when dismissing an auth error", () => {
    authError = "PENDING_APPROVAL";
    returnTo = "/service-record-admin/client-1";
    render(<LoginAuthErrorModal />);
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(mockReplace).toHaveBeenCalledWith(
      "/login?returnTo=%2Fservice-record-admin%2Fclient-1",
    );
  });

  it.each([
    ["ACCOUNT_LINKED", "계정이 연결됐어요."],
    ["ONBOARDING_SESSION_EXPIRED", "로그인 세션이 만료됐어요."],
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
