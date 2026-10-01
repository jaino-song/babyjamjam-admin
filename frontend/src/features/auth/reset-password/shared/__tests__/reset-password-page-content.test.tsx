import { fireEvent, render, screen } from "@testing-library/react";

import { expectNoFieldMessageBelowControl } from "@/test-utils/field-message-slot";

import { ResetPasswordPageContent } from "../reset-password-page-content";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams("token=valid-token"),
}));

jest.mock("@/services/api", () => ({
  authApi: {
    resetPassword: jest.fn(),
  },
}));

const GUIDANCE = "대·소문자·숫자·특수문자 8자+";

const messagesOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-slot="field-message"], [data-slot="field-error-message"]'))
    .map((message) => message.textContent);

describe.each(["desktop", "mobile"] as const)("ResetPasswordPageContent (%s) password messages", (variant) => {
  const passwordInput = () => screen.getByLabelText("새 비밀번호", { selector: "input" });
  // The desktop FormField renders its slot with data-slot; the mobile field uses a plain span.
  const slotText = (container: HTMLElement) =>
    variant === "desktop"
      ? messagesOf(container)
      : Array.from(container.querySelectorAll("[id^='reset-password-'][id$='-message']")).map((node) => node.textContent);

  it("shows the guidance in the slot, then live progress, then guidance again once cleared", () => {
    const { container } = render(<ResetPasswordPageContent variant={variant} />);
    expect(slotText(container)).toEqual([GUIDANCE]);

    fireEvent.change(passwordInput(), { target: { value: "abcdefg1!" } });
    expect(slotText(container)).toEqual(["대문자 필요"]);
    expect(container).not.toHaveTextContent("사용할 수 있는 비밀번호예요");

    fireEvent.change(passwordInput(), { target: { value: "Abcdefg1!" } });
    expect(slotText(container)).toEqual(["사용할 수 있는 비밀번호예요"]);

    fireEvent.change(passwordInput(), { target: { value: "" } });
    expect(slotText(container)).toEqual([GUIDANCE]);
    if (variant === "desktop") expectNoFieldMessageBelowControl(container);
  });

  it("no longer renders the requirement checklist below the input", () => {
    const { container } = render(<ResetPasswordPageContent variant={variant} />);
    fireEvent.change(passwordInput(), { target: { value: "abc" } });

    expect(container.querySelector("ul")).toBeNull();
    expect(screen.queryByText("최소 8자 이상")).not.toBeInTheDocument();
  });

  it("reports what is missing as a short error in the slot after a failed submit, and clears it on edit", () => {
    const { container } = render(<ResetPasswordPageContent variant={variant} />);
    fireEvent.change(passwordInput(), { target: { value: "abcdefgh" } });
    fireEvent.change(screen.getByLabelText("비밀번호 확인"), { target: { value: "abcdefgh" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

    expect(slotText(container)).toContain("대문자·숫자·특수문자 필요");
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(passwordInput(), { target: { value: "Abcdefg1!" } });
    expect(passwordInput()).not.toHaveAttribute("aria-invalid", "true");
    expect(slotText(container)).toEqual(["사용할 수 있는 비밀번호예요"]);
  });

  it("shows the empty confirmation as a short slot error", () => {
    const { container } = render(<ResetPasswordPageContent variant={variant} />);
    fireEvent.change(passwordInput(), { target: { value: "Abcdefg1!" } });
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

    expect(slotText(container)).toContain("비밀번호를 다시 입력해 주세요.");
  });
});
