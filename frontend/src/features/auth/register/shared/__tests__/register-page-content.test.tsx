import { createProblemDetails } from "@babyjamjam/shared";
import { AxiosError } from "axios";
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
    verifyRegisterLink: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;
const mockCheckEmailExists = authApi.checkEmailExists as jest.MockedFunction<typeof authApi.checkEmailExists>;

const slotOf = (container: HTMLElement, fieldId: string) => container.querySelector(`#${fieldId}-error`);

function renderRegister() {
  return render(<RegisterPageContent variant="desktop" />);
}

async function goToPersonalStep(container: HTMLElement) {
  mockCheckEmailExists.mockResolvedValue({ exists: false });
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
    expect(messages.map((message) => message.textContent)).toEqual(["대·소문자·숫자·특수문자 8자+"]);
    expect(slotOf(container, "비밀번호")).toBe(messages[0]);
    expect(screen.getByLabelText("이메일")).not.toHaveAttribute("aria-invalid", "true");
    expectNoFieldMessageBelowControl(container);
  });

  it("replaces the password guidance with the live requirement hint and, once cleared, the required error", () => {
    const { container } = renderRegister();
    const password = screen.getByLabelText("비밀번호", { selector: "input" });

    fireEvent.change(password, { target: { value: "abcdefgh" } });
    expect(slotOf(container, "비밀번호")).toHaveTextContent("대문자·숫자·특수문자 필요");

    // No uppercase letter: the form's schema would reject it, so it is not "ok".
    fireEvent.change(password, { target: { value: "abcdefg1!" } });
    expect(slotOf(container, "비밀번호")).toHaveTextContent("대문자 필요");
    expect(container).not.toHaveTextContent("사용할 수 있는 비밀번호예요");
    expect(container).not.toHaveTextContent("대·소문자·숫자·특수문자 8자+");

    fireEvent.change(password, { target: { value: "Passw0rd!x" } });
    expect(slotOf(container, "비밀번호")).toHaveTextContent("사용할 수 있는 비밀번호예요");

    fireEvent.change(password, { target: { value: "" } });
    expect(slotOf(container, "비밀번호")).toHaveTextContent("비밀번호를 입력해 주세요");
    expect(container).not.toHaveTextContent("대·소문자·숫자·특수문자 8자+");
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

  it("accepts phone input without a duplicate-check status", async () => {
    const { container } = renderRegister();
    await goToPersonalStep(container);
    fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01000006621" } });
    expect(slotOf(container, "전화번호")).toBeNull();
    expect(screen.getByLabelText("전화번호")).not.toHaveAttribute("aria-invalid", "true");
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

async function fillRegister(existingEmail = false) {
  mockCheckEmailExists.mockResolvedValue({ exists: existingEmail });
  renderRegister();
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "existing@example.com" } });
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "홍길동" } });
  fireEvent.change(screen.getByLabelText("비밀번호", { selector: "input" }), { target: { value: "Passw0rd!x" } });
  fireEvent.change(screen.getByLabelText("비밀번호 확인"), { target: { value: "Passw0rd!x" } });
  await waitFor(() => expect(mockCheckEmailExists).toHaveBeenCalledWith("existing@example.com"));
  if (existingEmail) expect(await screen.findByText("이미 등록된 이메일이에요. 카카오로 가입한 계정이라면 계속 진행해 비밀번호 로그인을 추가할 수 있어요.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.change(await screen.findByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "회원가입" })); });
}

it.each([true, false])("links an existing email with SMS (email verification %s)", async (emailVerificationRequired) => {
  jest.clearAllMocks();
  jest.mocked(authApi.register).mockResolvedValue({ success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" });
  jest.mocked(authApi.verifyRegisterLink).mockResolvedValue({ success: true, code: "ACCOUNTS_LINKED", emailVerificationRequired });
  await fillRegister(true);
  fireEvent.change(await screen.findByLabelText("인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  expect(await screen.findByText("계정이 연결되었습니다!")).toBeInTheDocument();
  expect(authApi.verifyRegisterLink).toHaveBeenCalledWith("challenge", "123456");
  expect(screen.getByText(emailVerificationRequired ? "이메일 인증 후 로그인을 진행해 주세요." : "이제 이메일로도 로그인할 수 있어요.")).toBeInTheDocument();
});

it("returns an existing email to the first step after plain success", async () => {
  jest.clearAllMocks();
  jest.mocked(authApi.register).mockResolvedValue({ success: true });
  await fillRegister(true);
  expect(await screen.findByText("이미 등록된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.")).toBeInTheDocument();
  expect(screen.queryByText("회원가입 완료!")).not.toBeInTheDocument();
});

it("shows a real /phone validation problem at the phone field", async () => {
  jest.clearAllMocks();
  const data = createProblemDetails({ code: "VALIDATION_FAILED", requestId: "test", status: 400, errors: [{ pointer: "/phone", code: "INVALID_VALUE", detail: "Invalid value" }] });
  jest.mocked(authApi.register).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 400, data } as never));
  await fillRegister();
  expect(await screen.findByText("이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요.")).toBeInTheDocument();
  expect(screen.getByLabelText("전화번호")).toHaveAttribute("aria-invalid", "true");
});
