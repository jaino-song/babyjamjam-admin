import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { completeKakaoOnboarding, verifyKakaoLink } from "@/app/(shell)/(auth)/kakao/onboarding/actions";
import { OnboardingForm } from "../onboarding-form";
const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
jest.mock("@/app/(shell)/(auth)/kakao/onboarding/actions", () => ({ completeKakaoOnboarding: jest.fn(), verifyKakaoLink: jest.fn() }));
beforeEach(() => {
  jest.resetAllMocks();
});
it("opens the challenge, retains values on restart and returns to login after verification", async () => {
  jest.mocked(completeKakaoOnboarding).mockResolvedValue({ success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" });
  jest.mocked(verifyKakaoLink).mockResolvedValue({ success: true });
  render(<OnboardingForm phone="010-1234-5678" birthDate="1990-01-01" role="user" />);
  const host = screen.getByText("카카오 가입 마무리").closest('[data-slot="auth-kakao-onboarding-page"]');
  expect(host).toHaveClass("auth-page");
  expect(screen.getByText("로그인에 필요한 추가 정보를 입력해 주세요.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("가입 완료"));
  const code = await screen.findByLabelText("인증번호");
  const step = code.closest<HTMLDivElement>('[data-slot="link-verification-step"]');
  expect(screen.getByText("카카오 가입 마무리")).toBeInTheDocument();
  expect(screen.queryByText("로그인에 필요한 추가 정보를 입력해 주세요.")).not.toBeInTheDocument();
  expect(host).toContainElement(step);
  expect(host).toHaveClass("auth-page");
  expect(step).not.toHaveClass("auth-page");
  fireEvent.click(screen.getByText("정보 다시 입력"));
  expect(screen.getByLabelText("전화번호")).toHaveValue("010-1234-5678");
  expect(screen.getByLabelText("생년월일")).toHaveValue("1990-01-01");
  fireEvent.click(screen.getByText("가입 완료"));
  fireEvent.change(await screen.findByLabelText("인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByText("인증하고 계정 연결"));
  await waitFor(() => expect(verifyKakaoLink).toHaveBeenCalledWith("challenge", "123456"));
  expect(replace).toHaveBeenCalledWith("/login?authError=ACCOUNT_LINKED");
});
it.each([
  ["phone", "전화번호", "생년월일", "이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요.", "이미 등록된 전화번호예요"],
  ["phone", "전화번호", "생년월일", "전화번호 형식이 올바르지 않아요. 010-1234-5678처럼 입력해 주세요.", "010-1234-5678로 입력해 주세요"],
  ["birthDate", "생년월일", "전화번호", "생년월일 형식이 올바르지 않아요. 1990-01-01처럼 입력해 주세요.", "YYYY-MM-DD로 입력해 주세요"],
] as const)("renders the %s action failure in the matching field slot: %s", async (field, label, otherLabel, error, slotCopy) => {
  jest.mocked(completeKakaoOnboarding).mockResolvedValue({ success: false, field, error });
  render(<OnboardingForm phone="010-1234-5678" birthDate="1990-01-01" role="user" />);
  fireEvent.click(screen.getByRole("button", { name: "가입 완료" }));

  await waitFor(() => expect(completeKakaoOnboarding).toHaveBeenCalledTimes(1));
  const input = screen.getByLabelText(label);
  await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
  expect(input).toHaveAccessibleDescription(slotCopy);
  expect(screen.getByLabelText(otherLabel)).not.toHaveAttribute("aria-invalid", "true");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("인증번호")).not.toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
});
it.each([
  "잠시 기다린 뒤 요청 상태를 확인해 주세요.",
  "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
])("shows the Kakao rate-limit error as an alert and keeps the form: %s", async error => {
  jest.mocked(completeKakaoOnboarding).mockResolvedValue({ success: false, error });
  render(<OnboardingForm phone="010-1234-5678" birthDate="1990-01-01" role="user" />);
  fireEvent.click(screen.getByRole("button", { name: "가입 완료" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(error);
  expect(screen.getByLabelText("전화번호")).toHaveValue("010-1234-5678");
  expect(screen.getByLabelText("생년월일")).toHaveValue("1990-01-01");
  expect(screen.getByRole("button", { name: "가입 완료" })).toBeEnabled();
  expect(screen.queryByLabelText("인증번호")).not.toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
});
