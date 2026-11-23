import { createProblemDetails } from "@babyjamjam/shared";
import { AxiosError } from "axios";
import { serverAPIClient } from "@/lib/api/server";
import { writeLoginSessionCookies } from "@/lib/auth/login-session-cookies";
import { LoginAuthErrorModal } from "../login-auth-error-modal";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { completeAccountOnboarding } from "@/app/(shell)/(auth)/onboarding/actions";
import { resetAuthorityState } from "@/lib/auth/authority-state";
import { AccountCompletionForm } from "../account-completion-form";
const replace = jest.fn();
const locationReplace = jest.fn();
const originalLocation = window.location;
const pendingCookies = { get: jest.fn(), delete: jest.fn() };
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(replace.mock.lastCall?.[0].split("?")[1]),
}));
jest.mock("next/headers", () => ({ cookies: async () => pendingCookies }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
jest.mock("@/lib/auth/login-session-cookies", () => ({ writeLoginSessionCookies: jest.fn() }));
jest.mock("@/app/(shell)/(auth)/onboarding/actions", () => ({ completeAccountOnboarding: jest.fn() }));
jest.mock("@/lib/auth/authority-state", () => ({ resetAuthorityState: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resetAuthorityState).mockReset().mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = jest.fn();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, replace: locationReplace },
    writable: true,
    configurable: true,
  });
});
afterEach(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
});
it.each([true, false])("submits only missing phone and resets authority before a document navigation with branch selection %s", async requiresBranchSelection => {
  let finishReset: () => void = () => {};
  jest.mocked(resetAuthorityState).mockReturnValue(new Promise<void>(resolve => { finishReset = resolve; }));
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: true, requiresBranchSelection });
  render(<AccountCompletionForm email="qa@example.test" name="테스트" birthDate="1990-01-01" />);
  expect(screen.queryByLabelText("생년월일")).toBeNull();
  expect(screen.getByLabelText("이메일")).toBeDisabled();
  expect(screen.getByLabelText("이름")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.click(screen.getByText("저장하고 시작하기"));
  await waitFor(() => expect(completeAccountOnboarding).toHaveBeenCalledWith({ phone: "010-1234-5678" }));
  await waitFor(() => expect(resetAuthorityState).toHaveBeenCalledTimes(1));
  expect(locationReplace).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  await act(async () => { finishReset(); });
  await waitFor(() => expect(locationReplace).toHaveBeenCalledWith(requiresBranchSelection ? "/select-branch" : "/dashboard"));
  expect(replace).not.toHaveBeenCalled();
});
it("submits only missing birth date and shows a returned field error", async () => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: false, field: "birthDate", error: "생년월일을 확인해 주세요." });
  render(<AccountCompletionForm phone="010-1234-5678" />);
  expect(screen.queryByLabelText("전화번호")).toBeNull();
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  fireEvent.click(screen.getByText("저장하고 시작하기"));
  await waitFor(() => expect(completeAccountOnboarding).toHaveBeenCalledWith({ birthDate: "1990-01-01" }));
  expect(await screen.findByText("생년월일을 확인해 주세요")).toBeInTheDocument();
  expect(resetAuthorityState).not.toHaveBeenCalled();
  expect(locationReplace).not.toHaveBeenCalled();
});
it("sends denied accounts back to the login notice", async () => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: false, authErrorCode: "PENDING_APPROVAL" });
  render(<AccountCompletionForm phone="010-1234-5678" />);
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  fireEvent.click(screen.getByText("저장하고 시작하기"));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?authError=PENDING_APPROVAL"));
  expect(resetAuthorityState).not.toHaveBeenCalled();
  expect(locationReplace).not.toHaveBeenCalled();
});

it.each([
  { code: "ACCOUNT_PROFILE_INCOMPLETE" },
  createProblemDetails({ code: "ACCOUNT_PROFILE_INCOMPLETE", requestId: "legacy-completion" }),
])("shows the owner-contact notice when a historical backend refuses completion (%j)", async data => {
  const actual = jest.requireActual<typeof import("@/app/(shell)/(auth)/onboarding/actions")>("@/app/(shell)/(auth)/onboarding/actions");
  jest.mocked(completeAccountOnboarding).mockImplementationOnce(actual.completeAccountOnboarding);
  pendingCookies.get.mockReturnValue({ value: "pending" });
  jest.mocked(serverAPIClient.post).mockRejectedValueOnce(
    new AxiosError("synthetic legacy error", undefined, undefined, undefined, { status: 403, data } as never),
  );
  render(<AccountCompletionForm birthDate="1990-01-01" />);
  fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.click(screen.getByText("저장하고 시작하기"));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?authError=ACCOUNT_PROFILE_INCOMPLETE"));
  expect(serverAPIClient.post).toHaveBeenCalledWith(
    "/auth/onboarding/complete", { phone: "010-1234-5678" },
    { headers: { "x-pending-onboarding-token": "pending" } },
  );
  expect(writeLoginSessionCookies).not.toHaveBeenCalled();
  expect(pendingCookies.delete).not.toHaveBeenCalled();

  render(<LoginAuthErrorModal />);
  expect(await screen.findByText("오너에게 계정 정보 확인을 요청해 주세요.")).toBeVisible();
});
