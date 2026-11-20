import { render, screen } from "@testing-library/react";
import { LoginAuthErrorModal } from "../login-auth-error-modal";
let code = "ACCOUNT_LINKED";
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn() }), useSearchParams: () => new URLSearchParams({ authError: code }) }));
it.each([["ACCOUNT_LINKED", "계정이 연결됐어요."], ["ONBOARDING_SESSION_EXPIRED", "로그인 세션이 만료됐어요."]])("renders %s notice", (value, title) => {
  code = value;
  render(<LoginAuthErrorModal />);
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
});
