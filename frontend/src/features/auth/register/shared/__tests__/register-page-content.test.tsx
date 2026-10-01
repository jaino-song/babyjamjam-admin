import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { authApi } from "@/services/api";

import { expectNoFieldMessageBelowControl } from "@/test-utils/field-message-slot";

import { RegisterPageContent } from "../register-page-content";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

jest.mock("@/services/api", () => ({
  authApi: {
    getBranches: jest.fn(),
    checkEmailExists: jest.fn(),
    register: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;
const mockCheckEmailExists = authApi.checkEmailExists as jest.MockedFunction<typeof authApi.checkEmailExists>;

const slotOf = (container: HTMLElement, fieldId: string) => container.querySelector(`#${fieldId}-error`);

function renderRegister() {
  return render(<RegisterPageContent variant="desktop" />);
}

async function goToPersonalStep(container: HTMLElement) {
  mockCheckEmailExists.mockResolvedValue({ exists: false, linkable: false });
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "hong@example.com" } });
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
  fireEvent.change(screen.getByLabelText("비밀번호", { selector: "input" }), { target: { value: "Passw0rd!x" } });
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), { target: { value: "Passw0rd!x" } });
  const next = screen.getByRole("button", { name: "다음" });
  await waitFor(() => expect(next).not.toBeDisabled());
  fireEvent.click(next);
  await screen.findByLabelText("전화번호");
  expect(container.querySelector('[data-slot="field-error-message"]')).toBeNull();
}

describe("RegisterPageContent field messages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
  });

  it("shows only the password guidance on first render", () => {
    const { container } = renderRegister();

    expect(container.querySelector('[data-slot="field-error-message"]')).toBeNull();
    const messages = Array.from(container.querySelectorAll('[data-slot="field-message"]'));
    expect(messages.map((message) => message.textContent)).toEqual(["소문자·숫자·특수문자 8자 이상"]);
    expect(slotOf(container, "비밀번호")).toBe(messages[0]);
    expect(screen.getByLabelText("이메일")).not.toHaveAttribute("aria-invalid", "true");
    expectNoFieldMessageBelowControl(container);
  });

  it("replaces the password guidance with the live requirement hint and, once cleared, the required error", () => {
    const { container } = renderRegister();
    const password = screen.getByLabelText("비밀번호", { selector: "input" });

    fireEvent.change(password, { target: { value: "abcdefgh" } });
    expect(slotOf(container, "비밀번호")).toHaveTextContent("숫자·특수문자 필요");
    expect(container).not.toHaveTextContent("소문자·숫자·특수문자 8자 이상");

    fireEvent.change(password, { target: { value: "Passw0rd!x" } });
    expect(slotOf(container, "비밀번호")).toHaveTextContent("사용할 수 있는 비밀번호예요");

    fireEvent.change(password, { target: { value: "" } });
    expect(slotOf(container, "비밀번호")).toHaveTextContent("비밀번호를 입력해 주세요");
    expect(container).not.toHaveTextContent("소문자·숫자·특수문자 8자 이상");
    expectNoFieldMessageBelowControl(container);
  });

  it("shows a required message only after a field held a value and was cleared", () => {
    const { container } = renderRegister();
    const nameInput = screen.getByLabelText("이름");

    fireEvent.focus(nameInput);
    fireEvent.blur(nameInput);
    expect(slotOf(container, "이름")).toBeNull();

    fireEvent.change(nameInput, { target: { value: "홍" } });
    expect(slotOf(container, "이름")).toBeNull();
    fireEvent.change(nameInput, { target: { value: "" } });
    const slot = slotOf(container, "이름");
    expect(slot).toHaveTextContent("이름을 입력해 주세요");
    expect(slot).toHaveAttribute("data-slot", "field-error-message");
    expect(slot).toHaveAttribute("aria-live", "polite");
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveAttribute("aria-describedby", "이름-error");
  });

  it("keeps the email format error in the label-row slot", () => {
    const { container } = renderRegister();
    const emailInput = screen.getByLabelText("이메일");

    fireEvent.focus(emailInput);
    fireEvent.change(emailInput, { target: { value: "hong@domain" } });
    fireEvent.blur(emailInput);

    const slot = slotOf(container, "이메일");
    expect(slot).toHaveTextContent("이메일 주소를 확인해 주세요.");
    expect(slot?.closest('[data-component="desktop_auth_form-field_label-row"]')).not.toBeNull();
  });

  it("shows phone and birth date format messages on the personal step", async () => {
    const { container } = renderRegister();
    await goToPersonalStep(container);
    const phoneInput = screen.getByLabelText("전화번호");
    const birthDateInput = screen.getByLabelText("생년월일");

    expect(phoneInput).toHaveAttribute("placeholder", "010-1234-5678");
    expect(birthDateInput).toHaveAttribute("placeholder", "1958-03-03");

    fireEvent.focus(phoneInput);
    fireEvent.change(phoneInput, { target: { value: "010123" } });
    expect(slotOf(container, "전화번호")).toHaveTextContent("010-1234-5678 형식");
    expect(slotOf(container, "전화번호")).not.toHaveTextContent("입력해 주세요");
    fireEvent.blur(phoneInput);
    expect(slotOf(container, "전화번호")).toHaveTextContent("010-1234-5678로 입력해 주세요");
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");

    fireEvent.focus(birthDateInput);
    fireEvent.change(birthDateInput, { target: { value: "195803" } });
    expect(birthDateInput).toHaveValue("1958-03");
    expect(slotOf(container, "생년월일")).toHaveTextContent("YYYY-MM-DD 형식");
    fireEvent.blur(birthDateInput);
    expect(slotOf(container, "생년월일")).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
    expect(screen.getByRole("button", { name: "회원가입" })).toBeDisabled();
  });

  it("reports the phone duplicate-check status in the same slot", async () => {
    const { container } = renderRegister();
    await goToPersonalStep(container);

    mockApiGet.mockResolvedValue({ data: { exists: false } });
    fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
    await waitFor(() => {
      expect(slotOf(container, "전화번호")).toHaveTextContent("등록 가능한 번호입니다.");
    });
    expect(screen.getByLabelText("전화번호")).not.toHaveAttribute("aria-invalid", "true");

    mockApiGet.mockResolvedValue({ data: { exists: true } });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01066211878" } });
    });
    await waitFor(() => {
      expect(slotOf(container, "전화번호")).toHaveTextContent("이미 존재하는 사용자 입니다.");
    });
    expect(screen.getByLabelText("전화번호")).toHaveAttribute("aria-invalid", "true");
  });
});
