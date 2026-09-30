import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OnboardingForm } from "./OnboardingForm";

const mockReplace = jest.fn();
const mockCompleteKakaoOnboarding = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("./actions", () => ({
  completeKakaoOnboarding: (...args: unknown[]) => mockCompleteKakaoOnboarding(...args),
}));

function renderForm(props: Partial<React.ComponentProps<typeof OnboardingForm>> = {}) {
  return render(<OnboardingForm email="kakao@example.com" name="홍길동" {...props} />);
}

const slotOf = (container: HTMLElement, id: string) => container.querySelector(`#${id}-error`);

describe("OnboardingForm field messages", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockCompleteKakaoOnboarding.mockReset();
  });

  it("shows no message and example placeholders on first render", () => {
    const { container } = renderForm();

    expect(container.querySelector('[data-slot="field-error-message"]')).toBeNull();
    expect(container.querySelector('[data-slot="field-message"]')).toBeNull();
    expect(screen.getByLabelText("전화번호")).toHaveAttribute("placeholder", "010-1234-5678");
    expect(screen.getByLabelText("생년월일")).toHaveAttribute("placeholder", "1958-03-03");
    expect(screen.getByLabelText("전화번호")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows a phone hint while typing and the format error after leaving the field", () => {
    const { container } = renderForm();
    const phoneInput = screen.getByLabelText("전화번호");

    fireEvent.focus(phoneInput);
    fireEvent.change(phoneInput, { target: { value: "010123" } });
    expect(slotOf(container, "전화번호")).toHaveTextContent("010-1234-5678 형식");
    expect(slotOf(container, "전화번호")).not.toHaveTextContent("입력해 주세요");

    fireEvent.blur(phoneInput);
    const slot = slotOf(container, "전화번호");
    expect(slot).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
    expect(slot).toHaveAttribute("data-slot", "field-error-message");
    expect(slot).toHaveAttribute("aria-live", "polite");
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");
    expect(phoneInput).toHaveAttribute("aria-describedby", "전화번호-error");
    // The message shares the label row; nothing renders below the input.
    expect(slot?.closest('[data-component="desktop_auth_form-field_label-row"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /가입 완료/ })).toBeEnabled();
  });

  it("keeps the submit button enabled for field problems and shows them all on press", () => {
    const { container } = renderForm();
    const submit = screen.getByRole("button", { name: /가입 완료/ });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    expect(mockCompleteKakaoOnboarding).not.toHaveBeenCalled();
    expect(slotOf(container, "전화번호")).toHaveTextContent("전화번호를 입력해 주세요");
    expect(slotOf(container, "생년월일")).toHaveTextContent("생년월일을 입력해 주세요");
    expect(screen.getByLabelText("전화번호")).toHaveFocus();
  });

  it("types a birth date as digits and shows the date format error for a partial date after blur", () => {
    const { container } = renderForm();
    const birthDateInput = screen.getByLabelText("생년월일");

    fireEvent.focus(birthDateInput);
    fireEvent.change(birthDateInput, { target: { value: "195803" } });
    expect(birthDateInput).toHaveValue("1958-03");
    expect(slotOf(container, "생년월일")).toHaveTextContent("YYYY-MM-DD 형식");

    fireEvent.blur(birthDateInput);
    expect(slotOf(container, "생년월일")).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
    expect(birthDateInput).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(birthDateInput, { target: { value: "19580303" } });
    expect(birthDateInput).toHaveValue("1958-03-03");
    expect(slotOf(container, "생년월일")).toBeNull();
  });

  it("reports a cleared prefilled field as required and rejects a future birth date", () => {
    const { container } = renderForm({ phone: "010-1234-5678", birthDate: "1990-01-01" });

    expect(slotOf(container, "전화번호")).toBeNull();
    fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "" } });
    expect(slotOf(container, "전화번호")).toHaveTextContent("전화번호를 입력해 주세요");

    fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "29990101" } });
    expect(slotOf(container, "생년월일")).toHaveTextContent("미래 날짜는 입력할 수 없어요");
  });

  it("submits a complete form without any message", async () => {
    mockCompleteKakaoOnboarding.mockResolvedValue({ success: true });
    const { container } = renderForm({ phone: "010-1234-5678", birthDate: "1990-01-01", role: "user" });

    expect(container.querySelector('[data-slot="field-error-message"]')).toBeNull();
    const submit = screen.getByRole("button", { name: /가입 완료/ });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockCompleteKakaoOnboarding).toHaveBeenCalledWith({
        phone: "010-1234-5678",
        birthDate: "1990-01-01",
        role: "user",
      });
    });
  });
});
