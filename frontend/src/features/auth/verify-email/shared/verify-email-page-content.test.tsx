import { render, screen } from "@testing-library/react";

import { VerifyEmailPageContent } from "./verify-email-page-content";
import type { useVerifyEmailPageController } from "./use-verify-email-page-controller";

let mockStatus: ReturnType<typeof useVerifyEmailPageController>["status"] = "no-token";

jest.mock("./use-verify-email-page-controller", () => ({
  useVerifyEmailPageController: () => ({
    status: mockStatus,
    message: "",
    resendEmail: "",
    resendLoading: false,
    resendMessage: null,
    handleResendChange: jest.fn(),
    handleResendSubmit: jest.fn(),
    goToLogin: jest.fn(),
  }),
}));

describe("VerifyEmailPageContent", () => {
  it("asks the user to check email when no verification token is present", () => {
    mockStatus = "no-token";
    render(<VerifyEmailPageContent variant="desktop" />);

    expect(screen.getByRole("heading", { name: "이메일 확인 필요" })).toBeInTheDocument();
    expect(screen.getByText("이메일에서 인증 링크를 클릭해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "인증 이메일 재발송" })).toBeDisabled();
  });

  it("renders the shared spinner with a screen-reader-only loading label", () => {
    mockStatus = "loading";
    render(<VerifyEmailPageContent variant="desktop" />);

    const status = screen.getByRole("status");
    expect(status.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
    expect(screen.getByText("이메일 인증 중...")).toHaveClass("sr-only");
  });
});
