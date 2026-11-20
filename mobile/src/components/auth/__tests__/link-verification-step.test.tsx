import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LinkVerificationStep } from "../link-verification-step";
it("validates six digits locally, sends digits, retains errors and restarts", async () => {
  const verify = jest.fn().mockResolvedValue({ success: false, error: "인증 실패" });
  const restart = jest.fn();
  render(<LinkVerificationStep data-component="mobile_auth_register_link-verification" onVerify={verify} onRestart={restart} />);
  fireEvent.change(screen.getByLabelText("인증번호"), { target: { value: "123" } });
  fireEvent.click(screen.getByText("인증하고 계정 연결"));
  expect(screen.getByRole("alert").textContent).toBe("인증번호 6자리를 입력해 주세요.");
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

const WRONG_CODE = "인증번호가 맞지 않거나 만료됐어요. 다시 입력하거나 처음부터 진행해 주세요.";
it("shows the full error in a block, disables during verification, then restores focus", async () => {
  let finish!: (result: { success: boolean; error: string }) => void;
  const verify = jest.fn(() => new Promise<{ success: boolean; error: string }>(resolve => { finish = resolve; }));
  render(<LinkVerificationStep data-component="mobile_auth_register_link-verification" onVerify={verify} onRestart={jest.fn()} />);
  const input = screen.getByLabelText("인증번호");
  const slotId = input.getAttribute("aria-describedby")!;
  const slot = document.getElementById(slotId)!;
  expect(slot).toBeEmptyDOMElement();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const hint = screen.getByText("문자가 오지 않으면 입력한 전화번호와 생년월일을 확인한 뒤 다시 시도해 주세요.");
  expect(input.closest("form")).toContainElement(hint);
  expect(hint.previousElementSibling).toBe(screen.getByRole("button", { name: "정보 다시 입력" }));
  fireEvent.change(input, { target: { value: "123456" } });
  // Do not focus the input before submitting: jsdom retains focus on disabled inputs.
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  expect(input).toBeDisabled();
  expect(input).not.toHaveFocus();
  expect(screen.getByRole("button", { name: "정보 다시 입력" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "인증 중" })).toBeDisabled();
  await act(async () => { finish({ success: false, error: WRONG_CODE }); });
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe(WRONG_CODE);
  expect(alert).toHaveClass("auth-server-error", "mt-3");
  expect(alert).toHaveAttribute("data-slot", "auth-server-error");
  expect(alert).toHaveAttribute("data-component", "mobile_auth_register_link-verification_error");
  expect(alert.nextElementSibling).toBe(input.closest("form"));
  expect(slot).toBeEmptyDOMElement();
  expect(input).toHaveAttribute("aria-describedby", alert.id);
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveClass("auth-input", "error");
  expect(input).toBeEnabled();
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "654321" } });
  expect(input).toHaveAttribute("aria-describedby", slotId);
  expect(input).not.toHaveClass("error");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each(["missing error", "rejected"])("shows fallback failures in the alert: %s", async failure => {
  const verify = failure === "rejected" ? jest.fn().mockRejectedValue(new Error("upstream")) : jest.fn().mockResolvedValue({ success: false });
  render(<LinkVerificationStep data-component="mobile_auth_register_link-verification" onVerify={verify} onRestart={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("인증번호"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  expect((await screen.findByRole("alert")).textContent).toBe("인증번호를 확인하지 못했습니다.");
});
