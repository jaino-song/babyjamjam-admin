import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import RegisterPage from "./page";
import { authApi } from "@/services/api";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/services/api", () => ({ authApi: { checkEmailExists: jest.fn() } }));

it("announces the pending email check with an inline Spinner and no visible waiting copy", async () => {
  jest.mocked(authApi.checkEmailExists).mockReturnValue(new Promise(() => {}));
  render(<RegisterPage />);
  fireEvent.change(screen.getByLabelText("이메일"), { target: { value: "qa@example.test" } });
  await waitFor(() => expect(authApi.checkEmailExists).toHaveBeenCalledWith("qa@example.test"));
  const status = screen.getByRole("status", { name: "이메일 확인 중" });
  expect(status.closest('[data-slot="email-label-row"]')).toHaveAttribute(
    "data-component", "mobile_auth_register_form_email-field_label-row",
  );
  expect(status.tagName).toBe("SPAN");
  expect(status.querySelector('[data-slot="spinner"]')).not.toBeNull();
  expect(screen.getByText("이메일 확인 중")).toHaveClass("sr-only");
  expect(screen.queryByText("확인 중")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
});
