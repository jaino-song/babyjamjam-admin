import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError } from "axios";
import { createProblemDetails } from "@babyjamjam/shared";
import { authApi } from "@/services/api";
import RegisterPage from "./page";
const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace }) }));
jest.mock("@/services/api", () => ({ authApi: { register: jest.fn(), checkEmailExists: jest.fn(), verifyRegisterLink: jest.fn() } }));
beforeEach(() => {
  jest.resetAllMocks();
  Element.prototype.scrollIntoView = jest.fn();
  jest.mocked(authApi.checkEmailExists).mockResolvedValue({ exists: true });
});
async function submit() {
  render(<RegisterPage />);
  for (const [label, value] of [["이메일", "qa@example.test"], ["이름", "테스트"], ["비밀번호", "Password1!"], ["비밀번호 확인", "Password1!"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  const note = await screen.findByRole("note");
  expect(note).toHaveAttribute("data-slot", "email-note");
  expect(note).toHaveAttribute("data-component", "mobile_auth_register_form_email-field_note");
  const emailWrap = screen.getByLabelText("이메일").closest(".auth-input-wrap");
  expect(emailWrap).not.toContainElement(note);
  expect(emailWrap?.nextElementSibling).toBe(note);
  expect(note.textContent).toBe("이미 등록된 이메일이에요. 카카오로 가입한 계정이라면 계속 진행해 비밀번호 로그인을 추가할 수 있어요.");
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.change(await screen.findByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  // Role remains required by the existing registration UI.
  fireEvent.change(await screen.findByLabelText("요청 권한"), { target: { value: "user" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
  });
}
it.each([
  ["problem document", createProblemDetails({ code: "PENDING_APPROVAL", requestId: "test-request" })],
  ["plain body", { code: "PENDING_APPROVAL" }],
] as const)("navigates to the pending-match notice without errors for a %s", async (_shape, data) => {
  jest.mocked(authApi.register).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 403, data } as never));
  await submit();

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?authError=LINK_PENDING_APPROVAL"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(screen.queryByLabelText("인증번호")).not.toBeInTheDocument();
  expect(screen.queryByText("회원가입 완료!")).not.toBeInTheDocument();
});
it.each([
  ["another code", 403, { code: "ACCOUNT_REJECTED" }, "네트워크 오류가 발생했어요. 다시 시도해 주세요."],
  ["verified other code", 403, createProblemDetails({ code: "ACCOUNT_REJECTED", requestId: "test-request" }), "가입이 거부되었어요. 자세한 내용은 관리자에게 문의해 주세요."],
  ["another status", 400, { code: "PENDING_APPROVAL" }, "네트워크 오류가 발생했어요. 다시 시도해 주세요."],
] as const)("preserves the register failure for %s", async (_case, status, data, error) => {
  jest.mocked(authApi.register).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status, data } as never));
  await submit();

  expect(await screen.findByRole("alert")).toHaveTextContent(error);
  expect(replace).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
});
it.each([true, false])("links through SMS with emailVerificationRequired=%s", async emailVerificationRequired => {
  jest.mocked(authApi.register).mockResolvedValue({ success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" });
  jest.mocked(authApi.verifyRegisterLink).mockResolvedValue({ success: true, linked: true, code: "ACCOUNTS_LINKED", emailVerificationRequired });
  await submit();
  fireEvent.change(await screen.findByLabelText("인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  expect(await screen.findByText("계정이 연결되었습니다!")).toBeInTheDocument();
  expect(authApi.verifyRegisterLink).toHaveBeenCalledWith("challenge", "123456");
  expect(screen.getByText(emailVerificationRequired ? /기존 카카오 계정에 비밀번호가 추가되었습니다/ : "이제 이메일로도 로그인할 수 있어요.")).toBeInTheDocument();
});
it("returns existing email plain success to the account form", async () => {
  jest.mocked(authApi.register).mockResolvedValue({ success: true });
  await submit();
  expect(await screen.findByLabelText("이메일")).toHaveValue("qa@example.test");
  const email = screen.getByLabelText("이메일");
  expect(document.getElementById(email.getAttribute("aria-describedby")!)?.textContent).toBe("이미 등록된 이메일입니다");
  expect(screen.getByRole("note").textContent).toBe("로그인하거나 비밀번호 찾기를 이용해 주세요.");
  expect(screen.queryByText(/계속 진행해/)).not.toBeInTheDocument();
  expect(screen.queryByText("회원가입 완료!")).toBeNull();
});

async function submitRetainedSteps() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
  });
}

it("registers a new email during the debounce window after an existing email", async () => {
  jest.mocked(authApi.checkEmailExists).mockImplementation(async email => ({ exists: email === "qa@example.test" }));
  jest.mocked(authApi.register).mockResolvedValue({ success: true });
  await submit();
  expect(screen.getByLabelText("이메일")).toHaveAccessibleDescription("이미 등록된 이메일입니다");

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "new@example.test" } });
  await submitRetainedSteps();

  expect(authApi.checkEmailExists).toHaveBeenCalledWith("new@example.test");
  expect(authApi.register).toHaveBeenLastCalledWith(expect.objectContaining({ email: "new@example.test" }));
  expect(await screen.findByText("회원가입 완료!")).toBeInTheDocument();
  expect(screen.queryByText("이미 등록된 이메일입니다")).not.toBeInTheDocument();
});

it("returns an existing email to the account form during the debounce window after a new email", async () => {
  jest.mocked(authApi.checkEmailExists).mockImplementation(async email => ({ exists: email === "existing@example.test" }));
  jest.mocked(authApi.register).mockResolvedValue({ success: true });
  render(<RegisterPage />);
  for (const [label, value] of [["이메일", "qa@example.test"], ["이름", "테스트"], ["비밀번호", "Password1!"], ["비밀번호 확인", "Password1!"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  await waitFor(() => expect(authApi.checkEmailExists).toHaveBeenCalledWith("qa@example.test"));
  expect(await screen.findByText("이메일 확인됨")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "existing@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.change(screen.getByLabelText("요청 권한"), { target: { value: "user" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
  });

  expect(authApi.checkEmailExists).toHaveBeenCalledWith("existing@example.test");
  expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({ email: "existing@example.test" }));
  expect(await screen.findByLabelText("이메일")).toHaveAccessibleDescription("이미 등록된 이메일입니다");
  expect(screen.getByRole("note").textContent).toBe("로그인하거나 비밀번호 찾기를 이용해 주세요.");
  expect(screen.queryByText("회원가입 완료!")).not.toBeInTheDocument();
});

it("continues registration when the direct email lookup rejects", async () => {
  jest.mocked(authApi.register).mockResolvedValue({ success: true });
  await submit();
  let rejectLookup: (error: Error) => void = () => { throw new Error("lookup has not started"); };
  jest.mocked(authApi.checkEmailExists).mockReturnValue(new Promise((_resolve, reject) => { rejectLookup = reject; }));

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "new@example.test" } });
  await submitRetainedSteps();

  expect(authApi.checkEmailExists).toHaveBeenCalledWith("new@example.test");
  expect(authApi.register).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "회원가입 처리 중" })).toBeDisabled();
  await act(async () => { rejectLookup(new Error("lookup unavailable")); });
  expect(authApi.register).toHaveBeenLastCalledWith(expect.objectContaining({ email: "new@example.test" }));
  expect(await screen.findByText("회원가입 완료!")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("removes the existing-email note as soon as the email is edited", async () => {
  render(<RegisterPage />);
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "qa@example.test" } });
  expect(await screen.findByRole("note")).toHaveTextContent("이미 등록된 이메일이에요.");

  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "new@example.test" } });

  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(authApi.checkEmailExists).toHaveBeenCalledTimes(1);
});
it("places the phone problem under the phone field", async () => {
  const problem = createProblemDetails({ code: "VALIDATION_FAILED", requestId: "test-request", errors: [{ pointer: "/phone", code: "INVALID_VALUE", detail: "Invalid value" }] });
  jest.mocked(authApi.register).mockRejectedValue({ response: { status: 400, data: problem } });
  await submit();
  const phone = await screen.findByLabelText("전화번호");
  await waitFor(() => expect(document.getElementById(phone.getAttribute("aria-describedby")!)).toHaveTextContent(/^이미 등록된 전화번호예요$/));
});
it.each([
  ["verified", createProblemDetails({ code: "REQUEST_RATE_LIMITED", requestId: "test-request" }), "잠시 기다린 뒤 요청 상태를 확인해 주세요."],
  ["unverified", { code: "REQUEST_RATE_LIMITED", detail: "Untrusted upstream detail", message: "Untrusted upstream message" }, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."],
] as const)("shows safe copy for a %s register 429 and permits retry", async (_shape, data, error) => {
  jest.mocked(authApi.register).mockRejectedValue({ response: { status: 429, data } });
  await submit();

  expect(await screen.findByRole("alert")).toHaveTextContent(error);
  expect(screen.queryByText(/Untrusted upstream/)).not.toBeInTheDocument();
  expect(screen.queryByText("회원가입 완료!")).not.toBeInTheDocument();
  expect(screen.queryByText("계정이 연결되었습니다!")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("인증번호")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "회원가입" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
  await waitFor(() => expect(authApi.register).toHaveBeenCalledTimes(2));
});
it.each([
  ["/code", "INVALID_VALUE", "인증번호가 맞지 않거나 만료됐어요. 다시 입력하거나 처음부터 진행해 주세요."],
  ["/code", "REQUIRED", "인증번호가 맞지 않거나 만료됐어요. 다시 입력하거나 처음부터 진행해 주세요."],
  ["/phone", "INVALID_VALUE", "회원가입에 실패했어요."],
] as const)("shows safe copy for link failure %s %s, keeps the challenge and permits retry", async (pointer, fieldCode, error) => {
  const problem = createProblemDetails({ code: "VALIDATION_FAILED", requestId: "test-request", errors: [{ pointer, code: fieldCode, detail: "Invalid value" }] });
  jest.mocked(authApi.register).mockResolvedValue({ success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" });
  jest.mocked(authApi.verifyRegisterLink)
    .mockRejectedValueOnce({ response: { status: 400, data: problem } })
    .mockResolvedValueOnce({ success: true, linked: true, code: "ACCOUNTS_LINKED", emailVerificationRequired: false });
  await submit();
  fireEvent.change(await screen.findByLabelText("인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));

  const codeInput = screen.getByLabelText("인증번호");
  await waitFor(() => expect(codeInput).toHaveAccessibleDescription(error));
  expect(screen.getByRole("alert").textContent).toBe(error);
  expect(codeInput).toHaveAttribute("aria-invalid", "true");
  expect(codeInput).toHaveValue("123456");
  expect(screen.queryByText("계정이 연결되었습니다!")).not.toBeInTheDocument();
  expect(authApi.verifyRegisterLink).toHaveBeenNthCalledWith(1, "challenge", "123456");
  fireEvent.change(screen.getByLabelText("인증번호"), { target: { value: "654321" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));

  expect(await screen.findByText("계정이 연결되었습니다!")).toBeInTheDocument();
  expect(authApi.verifyRegisterLink).toHaveBeenNthCalledWith(2, "challenge", "654321");
  expect(authApi.register).toHaveBeenCalledTimes(1);
});


it("keeps the register frame and brand around the embedded code step", async () => {
  jest.mocked(authApi.register).mockResolvedValue({ success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" });
  await submit();
  const code = await screen.findByLabelText("인증번호");
  const step = code.closest('[data-slot="link-verification-step"]');
  const frame = code.closest('[data-slot="auth-register-page"]');
  expect(frame).toHaveClass("auth-screen");
  expect(frame).toContainElement(step as HTMLElement);
  expect(step).not.toHaveClass("auth-page");
  expect(frame).toContainElement(screen.getByText("회원가입"));
  expect(screen.queryByText("필수 정보를 단계별로 입력해 주세요.")).not.toBeInTheDocument();
});

it("restarts at the phone and birth-date step with typed values retained", async () => {
  jest.mocked(authApi.register).mockResolvedValue({ success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" });
  await submit();
  await screen.findByLabelText("인증번호");
  fireEvent.click(screen.getByRole("button", { name: "정보 다시 입력" }));
  expect(screen.getByLabelText("전화번호")).toHaveValue("010-1234-5678");
  expect(screen.getByLabelText("생년월일")).toHaveValue("1990-01-01");
  expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
});

it.each([
  ["verified", 429, createProblemDetails({ code: "REQUEST_RATE_LIMITED", requestId: "test-request" }), "잠시 기다린 뒤 요청 상태를 확인해 주세요."],
  ["empty", 429, {}, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."],
] as const)("shows safe copy for a %s rate-limited code check", async (_shape, status, data, error) => {
  jest.mocked(authApi.register).mockResolvedValue({ success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" });
  jest.mocked(authApi.verifyRegisterLink).mockRejectedValue({ response: { status, data } });
  await submit();
  fireEvent.change(await screen.findByLabelText("인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  expect((await screen.findByRole("alert")).textContent).toBe(error);
  expect(screen.queryByText("회원가입에 실패했어요.")).not.toBeInTheDocument();
  expect(screen.getByLabelText("인증번호")).toHaveAccessibleDescription(error);
});


describe("email lookup arbitration", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    render(<RegisterPage />);
    for (const [label, value] of [["이메일", "qa@example.test"], ["이름", "테스트"], ["비밀번호", "Password1!"], ["비밀번호 확인", "Password1!"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
    fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.change(screen.getByLabelText("요청 권한"), { target: { value: "user" } });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("waits for an earlier outstanding lookup before sending register", async () => {
    const direct = deferred<{ exists: boolean }>();
    const debounced = deferred<{ exists: boolean }>();
    const registration = deferred<Awaited<ReturnType<typeof authApi.register>>>();
    jest.mocked(authApi.checkEmailExists).mockReturnValueOnce(direct.promise).mockReturnValueOnce(debounced.promise);
    jest.mocked(authApi.register).mockReturnValue(registration.promise);
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    expect(authApi.register).not.toHaveBeenCalled();

    await act(async () => { direct.resolve({ exists: false }); });
    expect(authApi.register).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "회원가입 처리 중" })).toBeDisabled();
    await act(async () => { debounced.resolve({ exists: false }); });
    expect(authApi.register).toHaveBeenCalledTimes(1);
    await act(async () => { registration.resolve({ success: true }); });

    expect(screen.getByText("회원가입 완료!")).toBeInTheDocument();
    expect(screen.queryByText("이미 등록된 이메일입니다")).not.toBeInTheDocument();
  });

  it("does not wait for a cancelled lookup for the submitted address", async () => {
    const cancelled = deferred<{ exists: boolean }>();
    const direct = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists).mockReturnValueOnce(cancelled.promise).mockReturnValueOnce(direct.promise);
    jest.mocked(authApi.register).mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "other@example.test" } });
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "qa@example.test" } });
    await submitRetainedSteps();
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    expect(authApi.checkEmailExists).toHaveBeenNthCalledWith(2, "qa@example.test");
    await act(async () => { direct.resolve({ exists: false }); });

    expect(authApi.register).toHaveBeenCalledTimes(1);
    expect(screen.getByText("회원가입 완료!")).toBeInTheDocument();
  });

  it("does not release a newer outstanding lookup when a cancelled one settles", async () => {
    const cancelled = deferred<{ exists: boolean }>();
    const direct = deferred<{ exists: boolean }>();
    const debounced = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists)
      .mockReturnValueOnce(cancelled.promise).mockReturnValueOnce(direct.promise).mockReturnValueOnce(debounced.promise);
    jest.mocked(authApi.register).mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await act(async () => { jest.advanceTimersByTime(250); });
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "other@example.test" } });
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "qa@example.test" } });
    await submitRetainedSteps();
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(3);
    await act(async () => { cancelled.resolve({ exists: false }); });
    await act(async () => { direct.resolve({ exists: false }); });
    expect(authApi.register).not.toHaveBeenCalled();
    await act(async () => { debounced.resolve({ exists: false }); });

    expect(authApi.register).toHaveBeenCalledTimes(1);
    expect(screen.getByText("회원가입 완료!")).toBeInTheDocument();
  });

  it("keeps a recorded false result after a rejected lookup and reuses it on resubmit", async () => {
    const debounced = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists).mockResolvedValueOnce({ exists: false }).mockReturnValueOnce(debounced.promise);
    jest.mocked(authApi.register).mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "회원가입" })); });
    expect(authApi.register).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(250); });
    await act(async () => { debounced.reject(new Error("lookup unavailable")); });
    expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    expect(screen.getByText("이메일 확인됨")).toBeInTheDocument();
    await submitRetainedSteps();

    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    expect(authApi.register).toHaveBeenCalledTimes(2);
    expect(screen.getByText("회원가입 완료!")).toBeInTheDocument();
  });

  it("records nothing when a cancelled lookup resolves for the current address", async () => {
    const cancelled = deferred<{ exists: boolean }>();
    const current = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists).mockReturnValueOnce(cancelled.promise).mockReturnValueOnce(current.promise);
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await act(async () => { jest.advanceTimersByTime(250); });
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "other@example.test" } });
    fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "qa@example.test" } });
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    await act(async () => { cancelled.resolve({ exists: true }); });

    expect(screen.getByLabelText("이메일")).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("이미 등록된 이메일입니다")).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText("이메일 확인됨")).not.toBeInTheDocument();
    await act(async () => { current.resolve({ exists: false }); });
    expect(screen.getByText("이메일 확인됨")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일")).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("keeps the direct duplicate after a later debounced rejection (order A)", async () => {
    const debounced = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists)
      .mockResolvedValueOnce({ exists: true })
      .mockReturnValueOnce(debounced.promise);
    jest.mocked(authApi.register).mockResolvedValue({ success: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "회원가입" })); });
    expect(screen.getByLabelText("이메일")).toHaveAccessibleDescription("이미 등록된 이메일입니다");

    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    await act(async () => { debounced.reject(new Error("lookup unavailable")); });

    expect(screen.getByLabelText("이메일")).toHaveAccessibleDescription("이미 등록된 이메일입니다");
    expect(screen.queryByText("이메일 확인됨")).not.toBeInTheDocument();
    expect(screen.queryByText("회원가입 완료!")).not.toBeInTheDocument();
  });

  it("keeps the direct duplicate on resubmit after a later debounced false result", async () => {
    const debounced = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists)
      .mockResolvedValueOnce({ exists: true })
      .mockReturnValueOnce(debounced.promise);
    jest.mocked(authApi.register).mockResolvedValue({ success: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "회원가입" })); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(1);
    expect(authApi.register).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("이메일")).toHaveAccessibleDescription("이미 등록된 이메일입니다");

    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    expect(authApi.checkEmailExists).toHaveBeenNthCalledWith(1, "qa@example.test");
    expect(authApi.checkEmailExists).toHaveBeenNthCalledWith(2, "qa@example.test");
    await act(async () => { debounced.resolve({ exists: false }); });
    await submitRetainedSteps();

    expect(authApi.register).toHaveBeenCalledTimes(2);
    expect(authApi.register).toHaveBeenNthCalledWith(1, expect.objectContaining({ email: "qa@example.test" }));
    expect(authApi.register).toHaveBeenNthCalledWith(2, expect.objectContaining({ email: "qa@example.test" }));
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("이메일")).toHaveAccessibleDescription("이미 등록된 이메일입니다");
    expect(screen.getByRole("note")).toHaveTextContent("로그인하거나 비밀번호 찾기를 이용해 주세요.");
    expect(screen.queryByText("이메일 확인됨")).not.toBeInTheDocument();
    expect(screen.queryByText("회원가입 완료!")).not.toBeInTheDocument();
  });

  it("uses a pre-register debounced duplicate when the direct lookup rejects (order B)", async () => {
    const direct = deferred<{ exists: boolean }>();
    const debounced = deferred<{ exists: boolean }>();
    const registration = deferred<Awaited<ReturnType<typeof authApi.register>>>();
    jest.mocked(authApi.checkEmailExists).mockReturnValueOnce(direct.promise).mockReturnValueOnce(debounced.promise);
    jest.mocked(authApi.register).mockReturnValue(registration.promise);
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    expect(authApi.register).not.toHaveBeenCalled();
    await act(async () => { direct.reject(new Error("lookup unavailable")); });
    expect(authApi.register).not.toHaveBeenCalled();
    await act(async () => { debounced.resolve({ exists: true }); });
    expect(authApi.register).toHaveBeenCalledTimes(1);
    expect(jest.mocked(authApi.checkEmailExists).mock.invocationCallOrder[1]).toBeLessThan(jest.mocked(authApi.register).mock.invocationCallOrder[0]);
    await act(async () => { registration.resolve({ success: true }); });

    expect(screen.getByLabelText("이메일")).toHaveAccessibleDescription("이미 등록된 이메일입니다");
    expect(screen.queryByText("회원가입 완료!")).not.toBeInTheDocument();
  });

  it("ignores a duplicate from a lookup sent after register", async () => {
    const registration = deferred<Awaited<ReturnType<typeof authApi.register>>>();
    jest.mocked(authApi.checkEmailExists).mockResolvedValueOnce({ exists: false }).mockResolvedValueOnce({ exists: true });
    jest.mocked(authApi.register).mockReturnValue(registration.promise);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "회원가입" })); });
    expect(authApi.register).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    expect(jest.mocked(authApi.checkEmailExists).mock.invocationCallOrder[1]).toBeGreaterThan(jest.mocked(authApi.register).mock.invocationCallOrder[0]);
    await act(async () => { registration.resolve({ success: true }); });

    expect(screen.getByText("회원가입 완료!")).toBeInTheDocument();
    expect(screen.queryByText("이미 등록된 이메일입니다")).not.toBeInTheDocument();
  });

  it("keeps a debounced duplicate when the direct lookup later answers false", async () => {
    const direct = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists).mockReturnValueOnce(direct.promise).mockResolvedValueOnce({ exists: true });
    jest.mocked(authApi.register).mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
    await act(async () => { jest.advanceTimersByTime(250); });
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    await act(async () => { direct.resolve({ exists: false }); });

    expect(screen.getByLabelText("이메일")).toHaveAccessibleDescription("이미 등록된 이메일입니다");
    expect(screen.getByRole("note")).toHaveTextContent("로그인하거나 비밀번호 찾기를 이용해 주세요.");
    expect(screen.queryByText("이메일 확인됨")).not.toBeInTheDocument();
    expect(screen.queryByText("회원가입 완료!")).not.toBeInTheDocument();
  });

  it("fails open when both lookups reject", async () => {
    const direct = deferred<{ exists: boolean }>();
    const debounced = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists).mockReturnValueOnce(direct.promise).mockReturnValueOnce(debounced.promise);
    jest.mocked(authApi.register).mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
    await act(async () => { jest.advanceTimersByTime(250); });
    await act(async () => { debounced.reject(new Error("debounced unavailable")); });
    await act(async () => { direct.reject(new Error("direct unavailable")); });

    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(2);
    expect(screen.getByText("회원가입 완료!")).toBeInTheDocument();
    expect(screen.queryByText("이미 등록된 이메일입니다")).not.toBeInTheDocument();
  });

  it("leaves no duplicate or checked status after an unsettled debounced rejection", async () => {
    const debounced = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists).mockReturnValueOnce(debounced.promise);
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    await act(async () => { jest.advanceTimersByTime(250); });
    await act(async () => { debounced.reject(new Error("lookup unavailable")); });

    expect(screen.getByLabelText("이메일")).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText("이메일 확인됨")).not.toBeInTheDocument();
    expect(screen.queryByText("확인 중")).not.toBeInTheDocument();
  });

  it("refuses a form submit while the debounced lookup is pending", async () => {
    const debounced = deferred<{ exists: boolean }>();
    jest.mocked(authApi.checkEmailExists).mockReturnValueOnce(debounced.promise);
    await act(async () => { jest.advanceTimersByTime(250); });
    const button = screen.getByRole("button", { name: "회원가입" });
    expect(button).toBeDisabled();
    const form = button.closest("form");
    if (!form) throw new Error("register form missing");
    await act(async () => { fireEvent.submit(form); });

    expect(authApi.register).not.toHaveBeenCalled();
    expect(authApi.checkEmailExists).toHaveBeenCalledTimes(1);
    await act(async () => { debounced.resolve({ exists: false }); });
  });

  it.each([403, 500])("does not log credentials from a register %s error", async status => {
    const config = { data: JSON.stringify({ email: "qa@example.test", password: "Password1!", name: "테스트", phone: "01012345678", birthDate: "1990-01-01" }) };
    const error = new AxiosError("failure", undefined, config as never, undefined, { status, data: status === 403 ? { code: "PENDING_APPROVAL" } : {} } as never);
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(authApi.checkEmailExists).mockResolvedValue({ exists: false });
    jest.mocked(authApi.register).mockRejectedValue(error);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "회원가입" })); });

    expect(authApi.register).toHaveBeenCalledTimes(1);
    const leaked = consoleError.mock.calls.some(args => args.some(arg =>
      arg === error || arg === config || JSON.stringify(arg)?.includes("Password1!")
    ));
    expect(leaked).toBe(false);
    if (status === 403) expect(replace).toHaveBeenCalledWith("/login?authError=LINK_PENDING_APPROVAL");
    else expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
