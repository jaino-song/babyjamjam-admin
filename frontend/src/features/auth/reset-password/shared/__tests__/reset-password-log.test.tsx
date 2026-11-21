import { inspect } from "node:util";
import { AxiosError, AxiosHeaders } from "axios";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { authApi } from "@/services/api";

import { ResetPasswordPageContent } from "../reset-password-page-content";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams("token=reset-token-secret"),
}));
jest.mock("@/services/api", () => ({ authApi: { resetPassword: jest.fn() } }));

afterEach(() => jest.restoreAllMocks());

it("logs a reset failure without the token, new password or authorization header", async () => {
  const token = "reset-token-secret";
  const password = "P@ss-reset-secret1";
  const authorization = "Bearer reset-header-secret";
  const message = `Request failed for https://example.test/auth/reset-password?token=${token}`;
  const error = new AxiosError(message, "ERR_BAD_REQUEST", {
    data: JSON.stringify({ token, newPassword: password }),
    headers: new AxiosHeaders({ Authorization: authorization }),
  });
  expect(error).toBeInstanceOf(Error);
  jest.mocked(authApi.resetPassword).mockRejectedValueOnce(error);
  const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
  render(<ResetPasswordPageContent variant="desktop" />);
  fireEvent.change(screen.getByLabelText("새 비밀번호", { selector: "input" }), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("비밀번호 확인", { selector: "input" }), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 변경" }));

  await waitFor(() => expect(log).toHaveBeenCalledWith("Reset password error:", {
    name: "AxiosError", code: "ERR_BAD_REQUEST",
  }));
  expect(authApi.resetPassword).toHaveBeenCalledWith(token, password);
  await waitFor(() => expect(screen.getByRole("button", { name: "비밀번호 변경" })).toBeEnabled());
  for (const args of log.mock.calls) {
    for (const arg of args) {
      const printed = inspect(arg, { depth: null });
      expect(printed).not.toContain(token);
      expect(printed).not.toContain(password);
      expect(printed).not.toContain(authorization);
      expect(printed).not.toContain(message);
    }
  }
});
