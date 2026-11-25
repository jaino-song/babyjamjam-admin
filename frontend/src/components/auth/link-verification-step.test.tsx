import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("connects the failed check to the invalid input and clears it on a new submit", async () => {
  let finishVerify: (result: { success: boolean }) => void = () => {};
  const onVerify = jest.fn()
    .mockResolvedValueOnce({ success: false, error: "인증 실패" })
    .mockImplementationOnce(() => new Promise<{ success: boolean }>((resolve) => { finishVerify = resolve; }));
  render(<LinkVerificationStep data-component="desktop_auth_test_verification" onVerify={onVerify} onRestart={jest.fn()} />);
  const input = screen.getByLabelText("인증번호");
  expect(input).toHaveAttribute("aria-invalid", "false");
  expect(input).not.toHaveAttribute("aria-describedby");
  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  const error = await screen.findByRole("alert");
  expect(error).toHaveTextContent("인증 실패");
  expect(error.id).not.toBe("");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAttribute("aria-describedby", error.id);
  fireEvent.click(screen.getByRole("button", { name: "인증하고 계정 연결" }));
  await waitFor(() => expect(onVerify).toHaveBeenCalledTimes(2));
  expect(input).toBeDisabled();
  expect(input).toHaveAttribute("aria-invalid", "false");
  expect(input).not.toHaveAttribute("aria-describedby");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => { finishVerify({ success: true }); });
});

it.each(["returned", "thrown"])("focuses the code after repeated %s verification failures", async (failure) => {
  const onVerify = failure === "returned"
    ? jest.fn().mockResolvedValue({ success: false, error: "인증 실패" })
    : jest.fn().mockRejectedValue(new Error("verification failed"));
  render(<LinkVerificationStep data-component="desktop_auth_test_verification" onVerify={onVerify} onRestart={jest.fn()} />);
  const input = screen.getByLabelText("인증번호");
  const button = screen.getByRole("button", { name: "인증하고 계정 연결" });
  fireEvent.change(input, { target: { value: "123456" } });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(onVerify).toHaveBeenCalledTimes(attempt));
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input).toBeEnabled();
    expect(input).toHaveAttribute("aria-invalid", "true");
  }
});

it("focuses the code after each six-digit refusal, including an unchanged error", async () => {
  const onVerify = jest.fn();
  render(<LinkVerificationStep data-component="desktop_auth_test_verification" onVerify={onVerify} onRestart={jest.fn()} />);
  const input = screen.getByLabelText("인증번호");
  const button = screen.getByRole("button", { name: "인증하고 계정 연결" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input).toHaveAttribute("aria-invalid", "true");
  }
  expect(onVerify).not.toHaveBeenCalled();
});
