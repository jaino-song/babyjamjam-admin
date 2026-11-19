import { render, screen } from "@testing-library/react";

import { LoginPageMobile } from "./login/mobile/login-page-mobile";
import { ForgotPasswordPageContent } from "./forgot-password/shared/forgot-password-page-content";
import { VerifyEmailPageContent } from "./verify-email/shared/verify-email-page-content";
import { RegisterPageContent } from "./register/shared/register-page-content";
import { ResetPasswordPageContent } from "./reset-password/shared/reset-password-page-content";

const mockBusy = true;
const mockResend = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("./login/shared/use-login-page-controller", () => ({
  useLoginPageController: () => ({
    formData: { email: "", password: "" }, errors: {},
    isLoading: mockBusy, isResendingVerification: mockBusy,
    serverError: "이메일 인증이 필요합니다.", emailVerificationRequired: true,
    autoLogin: false, rememberId: false, kakaoLoginUrl: "/oauth",
    setAutoLogin: jest.fn(), setRememberId: jest.fn(),
    handleChange: () => jest.fn(), handleSubmit: jest.fn(),
    handleResendVerification: mockResend, clearServerError: jest.fn(),
  }),
}));

jest.mock("./forgot-password/shared/use-forgot-password-page-controller", () => ({
  useForgotPasswordPageController: () => ({
    email: "qa@example.test", isLoading: mockBusy, isSuccess: false,
    handleEmailChange: jest.fn(), handleSubmit: jest.fn(),
  }),
}));

jest.mock("./verify-email/shared/use-verify-email-page-controller", () => ({
  useVerifyEmailPageController: () => ({
    status: "no-token", message: "", resendEmail: "qa@example.test", resendLoading: mockBusy,
    handleResendChange: jest.fn(), handleResendSubmit: jest.fn(), goToLogin: jest.fn(),
  }),
}));

jest.mock("./register/shared/use-register-page-controller", () => {
  const actual = jest.requireActual<typeof import("./register/shared/use-register-page-controller")>("./register/shared/use-register-page-controller");
  return {
    ...actual,
    useRegisterPageController: () => ({ ...actual.useRegisterPageController(), currentStep: 1, isLoading: mockBusy }),
  };
});

jest.mock("./reset-password/shared/use-reset-password-page-controller", () => {
  const actual = jest.requireActual<typeof import("./reset-password/shared/use-reset-password-page-controller")>("./reset-password/shared/use-reset-password-page-controller");
  return {
    useResetPasswordPageController: () => ({ ...actual.useResetPasswordPageController(), status: "ready", isLoading: mockBusy }),
  };
});

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

it.each([
  ["login", () => <LoginPageMobile />, "로그인 중"],
  ["forgot password", () => <ForgotPasswordPageContent variant="mobile" />, "메일 보내는 중"],
  ["verify email", () => <VerifyEmailPageContent variant="mobile" />, "인증 메일 보내는 중"],
  ["register", () => <RegisterPageContent variant="mobile" />, "회원가입 중"],
  ["reset password", () => <ResetPasswordPageContent variant="mobile" />, "변경 중"],
] as const)("keeps the narrow %s primary action at 40px with pill corners", (_page, content, name) => {
  render(content());
  const button = screen.getByRole("button", { name });
  expect(button).toHaveClass("rounded-full");
  expect(button).not.toHaveClass("rounded-2xl");
  if (_page === "register") expect(button).toHaveClass("h-10");
  else expect(button).toHaveClass("h-[calc(40px*var(--glint-ui-scale,1))]");
});

it("keeps the narrow login OAuth action pill shaped at 40px", () => {
  render(<LoginPageMobile />);
  const button = screen.getByRole("button", { name: /카카오/ });
  expect(button).toHaveClass("rounded-full", "h-[calc(40px*var(--glint-ui-scale,1))]");
  expect(button).not.toHaveClass("rounded-2xl");
});
