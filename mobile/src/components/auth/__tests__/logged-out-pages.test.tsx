import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

import AuthLayout from "@/app/(shell)/(auth)/layout";
import LoginPage from "@/app/(shell)/(auth)/login/page";
import RegisterPage from "@/app/(shell)/(auth)/register/page";
import ForgotPasswordPage from "@/app/(shell)/(auth)/forgot-password/page";
import ResetPasswordPage from "@/app/(shell)/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(shell)/(auth)/verify-email/page";
import PrivacyPage from "@/app/(shell)/privacy/page";
import TermsPage from "@/app/(shell)/terms/page";
import { authApi } from "@/services/api";

const mockPush = jest.fn();
let mockQuery = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockQuery,
}));
jest.mock("@/services/api", () => ({
  authApi: {
    checkEmailExists: jest.fn(),
    forgotPassword: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
  },
}));
jest.mock("@/app/(shell)/(auth)/login/actions", () => ({ loginWithEmail: jest.fn() }));
jest.mock("@/lib/auth/authority-state", () => ({ resetAuthorityState: jest.fn() }));
jest.mock("@/hooks/use-navigation-pending", () => ({
  useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }),
}));
jest.mock("@/components/auth/login-auth-error-modal", () => ({ LoginAuthErrorModal: () => null }));

function expectCardlessScreen(container: HTMLElement) {
  expect(container.querySelector(".auth-layout > [data-slot='auth-page-content'] .auth-screen")).not.toBeNull();
  expect(container.querySelector(".list-card, .list-card-scroll, [class~='bg-card'], [class~='shadow-lg'], [class~='shadow-v3']")).toBeNull();
  expect(container.querySelector(".auth-screen > [class~='bg-white']")).toBeNull();
  for (const surface of container.querySelectorAll(".auth-screen > [class~='bg-transparent']")) {
    expect(surface).toHaveClass("border-0", "shadow-none");
    expect(surface).not.toHaveClass("bg-white");
  }
}

describe("logged-out page presentation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = new URLSearchParams();
    localStorage.clear();
    jest.mocked(authApi.checkEmailExists).mockResolvedValue({ exists: false });
  });

  it("preserves the base onboarding auth-page CSS byte for byte", () => {
    const css = readFileSync(path.join(process.cwd(), "src/components/app/mobile-redesign/redesign.css"), "utf8");
    const baseAuthPage = `.auth-page {
  min-height: 100dvh;
  background: linear-gradient(180deg, #fff 0%, hsl(var(--v3-dim-white)) 60%);
  padding: 36px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  font-family: "NanumSquare Neo", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", -apple-system, sans-serif;
  line-height: normal;
}`;
    expect(css.match(/^\.auth-page \{[^}]*\}/m)?.[0]).toBe(baseAuthPage);
    expect(css).toContain(".auth-layout:has(.auth-screen) {");
    expect(css).not.toContain(".auth-page:has(.auth-screen)");
  });

  it("keeps the group wrapper out of callback/onboarding styling and names its elements", () => {
    const { container } = render(<AuthLayout><div data-slot="callback-placeholder" /></AuthLayout>);
    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveClass("auth-layout");
    expect(wrapper).not.toHaveClass("auth-page", "auth-screen");
    expect(wrapper?.firstElementChild).not.toHaveClass("auth-page", "auth-screen");
    const base = wrapper?.getAttribute("data-component");
    expect(base).toMatch(/^mobile_[a-z0-9-]+_[a-z0-9-]+$/);
    expect(wrapper?.firstElementChild).toHaveAttribute("data-component", `${base}_content`);
  });

  it.each([
    ["login", LoginPage],
    ["register", RegisterPage],
    ["forgot-password", ForgotPasswordPage],
    ["reset-password", ResetPasswordPage],
    ["verify-email", VerifyEmailPage],
  ] as const)("renders %s in the shared frame with no white card", (_route, Page) => {
    const { container } = render(<AuthLayout><Page /></AuthLayout>);
    expectCardlessScreen(container);
  });

  it.each([["privacy", PrivacyPage], ["terms", TermsPage]] as const)("renders %s with content-height legal copy and an inline login link", (route, Page) => {
    const { container } = render(<Page />);
    expectCardlessScreen(container);
    const header = container.querySelector(`[data-component="mobile_${route}_page_header"]`);
    expect(header).toHaveAttribute("data-source-component", "ListCardHeader");
    expect(header).toHaveClass("list-title");
    expect(header?.querySelector(".list-title-text")).toHaveTextContent(route === "privacy" ? "개인정보처리방침" : "이용약관");
    expect(header?.querySelector(".list-count")).toHaveTextContent("아가잼잼 어드민");
    expect(screen.queryByText(/데스크톱/)).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "로그인으로 돌아가기" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link.parentElement?.tagName).toBe("P");
    expect(container.querySelector(".auth-screen")).toContainElement(link);
    expect(container.querySelector(".auth-screen")).not.toHaveClass("min-h-screen", "h-full", "overflow-y-auto");
  });

  it.each([false, true])("keeps the resend action primary and disabled for an empty email (error state: %s)", async (errorState) => {
    if (errorState) {
      mockQuery = new URLSearchParams("token=expired");
      jest.mocked(authApi.verifyEmail).mockResolvedValue({ success: false });
    }
    const { container } = render(<AuthLayout><VerifyEmailPage /></AuthLayout>);
    const resend = await screen.findByRole("button", { name: "인증 이메일 재발송" });
    expect(resend).toHaveAttribute("data-variant", "default");
    expect(resend).toBeDisabled();
    fireEvent.change(screen.getByLabelText("이메일 주소"), { target: { value: "qa@example.test" } });
    expect(resend).toBeEnabled();
    fireEvent.change(screen.getByLabelText("이메일 주소"), { target: { value: "" } });
    expect(resend).toBeDisabled();
    expect(screen.getByRole("link", { name: "로그인 페이지로 돌아가기" })).toHaveAttribute("href", "/login");
    expectCardlessScreen(container);
  });

  it("renders verification loading with Spinner and a screen-reader-only label", () => {
    mockQuery = new URLSearchParams("token=pending");
    jest.mocked(authApi.verifyEmail).mockReturnValue(new Promise(() => {}));
    const { container } = render(<AuthLayout><VerifyEmailPage /></AuthLayout>);
    expect(container.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(screen.getByText("이메일 인증 중...")).toHaveClass("sr-only");
    expectCardlessScreen(container);
  });

  it("keeps the forgot-password success page cardless and uses an inline back link", async () => {
    jest.mocked(authApi.forgotPassword).mockResolvedValue({ success: true });
    const { container } = render(<AuthLayout><ForgotPasswordPage /></AuthLayout>);
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "qa@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 재설정 링크 전송" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "로그인 페이지로 돌아가기" })).toHaveAttribute("href", "/login"));
    expectCardlessScreen(container);
  });
});
