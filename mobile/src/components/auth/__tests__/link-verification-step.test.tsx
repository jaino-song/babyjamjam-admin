import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LinkVerificationStep } from "../link-verification-step";
it("validates six digits locally, sends digits, retains errors and restarts", async () => {
  const verify = jest.fn().mockResolvedValue({ success: false, error: "인증 실패" });
  const restart = jest.fn();
  render(<LinkVerificationStep data-component="mobile_auth_register_link-verification" onVerify={verify} onRestart={restart} />);
  fireEvent.change(screen.getByLabelText("인증번호"), { target: { value: "123" } });
  fireEvent.click(screen.getByText("인증하고 계정 연결"));
  expect(screen.getByText("인증번호 6자리를 입력해 주세요.")).toBeInTheDocument();
  expect(verify).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("인증번호"), { target: { value: "a123456" } });
  fireEvent.click(screen.getByText("인증하고 계정 연결"));
  await waitFor(() => expect(verify).toHaveBeenCalledWith("123456"));
  expect(await screen.findByText("인증 실패")).toBeInTheDocument();
  fireEvent.click(screen.getByText("정보 다시 입력"));
  expect(restart).toHaveBeenCalledTimes(1);
});

it.each([false, true])("keeps secondary styling and the correct frame when embedded=%s", embedded => {
  const { container } = render(<LinkVerificationStep {...(embedded ? { embedded: true } : {})} data-component="mobile_auth_register_link-verification" onVerify={jest.fn()} onRestart={jest.fn()} />);
  const root = container.firstElementChild;
  expect(root).toHaveAttribute("data-slot", "link-verification-step");
  if (embedded) expect(root).not.toHaveClass("auth-page");
  else expect(root).toHaveClass("auth-page");
  expect(screen.getByRole("button", { name: "인증하고 계정 연결" })).toHaveClass("auth-btn", { exact: true });
  expect(screen.getByRole("button", { name: "정보 다시 입력" })).toHaveClass("auth-btn secondary", { exact: true });
});
