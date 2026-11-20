import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared";
import { authApi } from "@/services/api";
import RegisterPage from "./page";
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
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
  expect(await screen.findByRole("note")).toHaveTextContent("이미 등록된 이메일이에요. 카카오로 가입한 계정이라면 계속 진행해 비밀번호 로그인을 추가할 수 있어요.");
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
  expect(screen.getByText("이미 등록된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요")).toBeInTheDocument();
  expect(screen.queryByText("회원가입 완료!")).toBeNull();
});
it("places the phone problem under the phone field", async () => {
  const problem = createProblemDetails({ code: "VALIDATION_FAILED", requestId: "test-request", errors: [{ pointer: "/phone", code: "INVALID_VALUE", detail: "Invalid value" }] });
  jest.mocked(authApi.register).mockRejectedValue({ response: { status: 400, data: problem } });
  await submit();
  const phone = await screen.findByLabelText("전화번호");
  await waitFor(() => expect(document.getElementById(phone.getAttribute("aria-describedby")!)).toHaveTextContent("이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요"));
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
