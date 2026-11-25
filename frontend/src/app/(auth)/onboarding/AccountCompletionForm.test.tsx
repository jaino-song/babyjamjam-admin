import { createProblemDetails } from "@babyjamjam/shared";
import { AxiosError } from "axios";
import { serverAPIClient } from "@/lib/api/server";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { LoginAuthErrorModal } from "@/features/auth/login/shared/login-auth-error-modal";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountCompletionForm } from "./AccountCompletionForm";
import { completeAccountOnboarding } from "./actions";
import { resetAuthorityState } from "@/lib/auth/authority-state";
const replace = jest.fn();
const pendingCookies = { get: jest.fn(), delete: jest.fn() };
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(replace.mock.lastCall?.[0].split("?")[1]),
}));
jest.mock("next/headers", () => ({ cookies: async () => pendingCookies }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
jest.mock("@/lib/auth/session-cookies", () => ({ setAuthSessionCookies: jest.fn() }));
jest.mock("./actions", () => ({ completeAccountOnboarding: jest.fn() }));
jest.mock("@/lib/auth/authority-state", () => ({ resetAuthorityState: jest.fn() }));
beforeEach(() => jest.clearAllMocks());
it.each([true, false])("posts only missing phone and navigates (branch selection %s)", async (requiresBranchSelection) => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: true, requiresBranchSelection });
  render(<AccountCompletionForm email="a@example.com" name="홍길동" birthDate="1990-01-01" returnPath="/service-record-admin/client-1" />);
  expect(screen.queryByLabelText("생년월일")).not.toBeInTheDocument();
  expect(screen.getByLabelText("이메일")).toHaveAttribute("readonly");
  fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.click(screen.getByRole("button", { name: /저장하고 시작하기/ }));
  await waitFor(() => expect(completeAccountOnboarding).toHaveBeenCalledWith({ phone: "010-1234-5678" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith(requiresBranchSelection ? "/select-branch?returnTo=%2Fservice-record-admin%2Fclient-1" : "/service-record-admin/client-1"));
  expect(resetAuthorityState).toHaveBeenCalled();
});
it("posts only missing birth date and defaults to dashboard", async () => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: true });
  render(<AccountCompletionForm phone="010-1234-5678" />);
  expect(screen.queryByLabelText("전화번호")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  fireEvent.click(screen.getByRole("button", { name: /저장하고 시작하기/ }));
  await waitFor(() => expect(completeAccountOnboarding).toHaveBeenCalledWith({ birthDate: "1990-01-01" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
});

it("ignores an invalid stored phone when completing the missing birth date", async () => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: true });
  render(<AccountCompletionForm phone="02-123-4567" />);
  expect(screen.queryByLabelText("전화번호")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  fireEvent.click(screen.getByRole("button", { name: /저장하고 시작하기/ }));
  await waitFor(() => expect(completeAccountOnboarding).toHaveBeenCalledWith({ birthDate: "1990-01-01" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
});
it("ignores an invalid stored birth date when completing the missing phone", async () => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: true });
  render(<AccountCompletionForm birthDate="1990.01.01" />);
  expect(screen.queryByLabelText("생년월일")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.click(screen.getByRole("button", { name: /저장하고 시작하기/ }));
  await waitFor(() => expect(completeAccountOnboarding).toHaveBeenCalledWith({ phone: "010-1234-5678" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
});
it("rejects an empty visible phone with its required field message", () => {
  render(<AccountCompletionForm birthDate="1990-01-01" />);
  fireEvent.click(screen.getByRole("button", { name: /저장하고 시작하기/ }));
  expect(completeAccountOnboarding).not.toHaveBeenCalled();
  expect(screen.getByText("전화번호를 입력해 주세요")).toBeInTheDocument();
  expect(screen.getByLabelText("전화번호")).toHaveAttribute("aria-invalid", "true");
});

it.each([
  { code: "ACCOUNT_PROFILE_INCOMPLETE" },
  createProblemDetails({ code: "ACCOUNT_PROFILE_INCOMPLETE", requestId: "legacy-completion" }),
])("shows the owner-contact notice when a historical backend refuses completion (%j)", async data => {
  const actual = jest.requireActual<typeof import("./actions")>("./actions");
  jest.mocked(completeAccountOnboarding).mockImplementationOnce(actual.completeAccountOnboarding);
  pendingCookies.get.mockReturnValue({ value: "pending" });
  jest.mocked(serverAPIClient.post).mockRejectedValueOnce(
    new AxiosError("synthetic legacy error", undefined, undefined, undefined, { status: 403, data } as never),
  );
  render(<AccountCompletionForm birthDate="1990-01-01" returnPath="/service-record-admin/client-1" />);
  fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.click(screen.getByRole("button", { name: /저장하고 시작하기/ }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?authError=ACCOUNT_PROFILE_INCOMPLETE&returnTo=%2Fservice-record-admin%2Fclient-1"));
  expect(serverAPIClient.post).toHaveBeenCalledWith(
    "/auth/onboarding/complete", { phone: "010-1234-5678" },
    { headers: { "x-pending-onboarding-token": "pending" } },
  );
  expect(setAuthSessionCookies).not.toHaveBeenCalled();
  expect(pendingCookies.delete).not.toHaveBeenCalled();

  render(<LoginAuthErrorModal />);
  expect(await screen.findByText("오너에게 계정 정보 확인을 요청해 주세요.")).toBeVisible();
});
