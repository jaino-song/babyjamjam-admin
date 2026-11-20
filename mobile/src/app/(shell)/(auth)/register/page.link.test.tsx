import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared";
import { authApi } from "@/services/api";
import RegisterPage from "./page";
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/services/api", () => ({ authApi: { register: jest.fn(), checkEmailExists: jest.fn(), verifyRegisterLink: jest.fn() } }));
beforeEach(() => {
  jest.clearAllMocks();
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
  fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
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
