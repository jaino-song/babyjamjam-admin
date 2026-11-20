import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LinkVerificationStep } from "./link-verification-step";

it("validates six digits, retains returned failure and restarts", async () => {
  const onVerify = jest.fn().mockResolvedValue({ success: false, error: "인증 실패" });
  const onRestart = jest.fn();
  render(<LinkVerificationStep data-component="desktop_auth_test_verification" onVerify={onVerify} onRestart={onRestart} />);
  fireEvent.change(screen.getByLabelText("인증번호"), { target: { value: "12ab3" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  expect(onVerify).not.toHaveBeenCalled();
  expect(screen.getByText("인증번호 6자리를 입력해 주세요.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  await waitFor(() => expect(onVerify).toHaveBeenCalledWith("123456"));
  expect(await screen.findByText("인증 실패")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "정보 다시 입력" }));
  expect(onRestart).toHaveBeenCalledTimes(1);
});
