import { fireEvent, render, screen } from "@testing-library/react";

import { LoginPageDesktop } from "./login/desktop/login-page-desktop";
import { LoginPageMobile } from "./login/mobile/login-page-mobile";
import { ForgotPasswordPageContent } from "./forgot-password/shared/forgot-password-page-content";
import { ResetPasswordPageContent } from "./reset-password/shared/reset-password-page-content";
import { VerifyEmailPageContent } from "./verify-email/shared/verify-email-page-content";
import { CallbackPageContent } from "./callback/shared/callback-page-content";
import { RegisterPageContent } from "./register/shared/register-page-content";

let mockBusy = true;
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

jest.mock("./reset-password/shared/use-reset-password-page-controller", () => ({
  useResetPasswordPageController: () => ({
    status: "valid", isLoading: mockBusy, formData: { newPassword: "", confirmPassword: "" }, fieldErrors: {},
    passwordStrength: { requirements: {} }, handleChange: () => jest.fn(), handleSubmit: jest.fn(),
  }),
}));

jest.mock("./verify-email/shared/use-verify-email-page-controller", () => ({
  useVerifyEmailPageController: () => ({
    status: "no-token", message: "", resendEmail: "qa@example.test", resendLoading: mockBusy,
    handleResendChange: jest.fn(), handleResendSubmit: jest.fn(), goToLogin: jest.fn(),
  }),
}));

jest.mock("./callback/shared/use-callback-page-controller", () => ({
  useCallbackPageController: () => ({ status: "loading" }),
}));

jest.mock("./register/shared/use-register-page-controller", () => {
  const actual = jest.requireActual<typeof import("./register/shared/use-register-page-controller")>("./register/shared/use-register-page-controller");
  return {
    ...actual,
    useRegisterPageController: () => ({ ...actual.useRegisterPageController(), currentStep: 1, isLoading: mockBusy }),
  };
});

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => {
  mockBusy = true;
  mockResend.mockClear();
});

it.each([
  ["desktop login", () => <LoginPageDesktop />, "로그인 중", "로그인"],
  ["mobile login", () => <LoginPageMobile />, "로그인 중", "로그인"],
  ["forgot password", () => <ForgotPasswordPageContent variant="desktop" />, "메일 보내는 중", "비밀번호 재설정 링크 전송"],
  ["reset password", () => <ResetPasswordPageContent variant="desktop" />, "변경 중", "비밀번호 변경"],
  ["verification email", () => <VerifyEmailPageContent variant="desktop" />, "인증 메일 보내는 중", "인증 이메일 재발송"],
  ["register", () => <RegisterPageContent variant="desktop" />, "회원가입 중", "회원가입"],
] as const)("%s preserves its idle label while announcing the busy action", (_name, content, busyLabel, idleLabel) => {
  const { rerender } = render(content());
  const busy = screen.getByRole("button", { name: busyLabel });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toHaveAttribute("data-loading", "");
  const idle = busy.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  expect(idle).toHaveTextContent(idleLabel);
  expect(busy.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).toBeInTheDocument();

  mockBusy = false;
  rerender(content());
  const restored = screen.getByRole("button", { name: idleLabel });
  expect(restored).not.toHaveAttribute("aria-busy");
  expect(restored.querySelector('[data-slot="button-idle"]')).toBeNull();
});

it.each([
  ["desktop", () => <LoginPageDesktop />, "재전송 중", "재전송"],
  ["mobile", () => <LoginPageMobile />, "재발송 중", "인증 이메일 재발송"],
] as const)("%s prevents duplicate resends and restores the idle action", (_name, content, busyLabel, idleLabel) => {
  const { rerender } = render(content());
  const button = screen.getByRole("button", { name: busyLabel });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(mockResend).not.toHaveBeenCalled();
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("invisible");
  if (_name === "desktop") {
    expect(button.parentElement?.textContent).toMatch(/^이메일이 오지 않았다면 [\s\S]*을 눌러주세요\.$/);
  }

  mockBusy = false;
  rerender(content());
  fireEvent.click(screen.getByRole("button", { name: idleLabel }));
  expect(mockResend).toHaveBeenCalledTimes(1);
});

it.each(["desktop", "mobile"] as const)("%s callback announces login through a spinner without visible wait copy", (variant) => {
  const { container } = render(<CallbackPageContent variant={variant} />);
  const status = screen.getByRole("status", { name: "로그인 중" });
  expect(status.querySelector(".sr-only")).toHaveTextContent("로그인 중");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector("h1, h2, p")).toBeNull();
});
