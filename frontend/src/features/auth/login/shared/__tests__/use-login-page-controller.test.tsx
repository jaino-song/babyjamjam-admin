import { act, renderHook, waitFor } from "@testing-library/react";

import { useLoginPageController } from "../use-login-page-controller";
import { loginWithEmail } from "@/app/(auth)/login/actions";
import { resetAuthorityState } from "@/lib/auth/authority-state";

const mockReplace = jest.fn();
let returnTo: string | null = null;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(returnTo ? { returnTo } : {}),
}));

jest.mock("@/app/(auth)/login/actions", () => ({
  loginWithEmail: jest.fn(),
}));

jest.mock("@/lib/auth/authority-state", () => ({
  resetAuthorityState: jest.fn().mockResolvedValue(undefined),
}));

const mockLoginWithEmail = jest.mocked(loginWithEmail);
const mockResetAuthorityState = jest.mocked(resetAuthorityState);
type LoginController = ReturnType<typeof useLoginPageController>;

async function submitLogin(result: { current: LoginController }) {
  act(() => {
    result.current.handleChange("email")({
      target: { value: "admin@example.com" },
    } as React.ChangeEvent<HTMLInputElement>);
    result.current.handleChange("password")({
      target: { value: "password" },
    } as React.ChangeEvent<HTMLInputElement>);
  });

  await act(async () => {
    await result.current.handleSubmit({ preventDefault: jest.fn() } as unknown as React.FormEvent<HTMLFormElement>);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  returnTo = null;
  mockResetAuthorityState.mockResolvedValue(undefined);
});

describe("useLoginPageController return navigation", () => {
  it("routes a successful login directly to the safe editor path", async () => {
    returnTo = "/service-record-admin/client-1";
    mockLoginWithEmail.mockResolvedValue({ success: true, requiresBranchSelection: false });

    const { result } = renderHook(() => useLoginPageController());
    await submitLogin(result);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/service-record-admin/client-1");
    });
    expect(mockResetAuthorityState).toHaveBeenCalled();
  });

  it("keeps the safe editor path while sending a branchless session to branch selection", async () => {
    returnTo = "/service-record-admin/client-1";
    mockLoginWithEmail.mockResolvedValue({ success: true, requiresBranchSelection: true });

    const { result } = renderHook(() => useLoginPageController());
    await submitLogin(result);

    expect(mockReplace).toHaveBeenCalledWith(
      "/select-branch?returnTo=%2Fservice-record-admin%2Fclient-1",
    );
  });

  it("preserves the safe editor path when login returns an allowlisted auth error", async () => {
    returnTo = "/service-record-admin/client-1";
    mockLoginWithEmail.mockResolvedValue({
      success: false,
      authErrorCode: "PENDING_APPROVAL",
    });

    const { result } = renderHook(() => useLoginPageController());
    await submitLogin(result);

    expect(mockReplace).toHaveBeenCalledWith(
      "/login?authError=PENDING_APPROVAL&returnTo=%2Fservice-record-admin%2Fclient-1",
    );
  });

  it("falls back to the dashboard when the return path is unsafe", async () => {
    returnTo = "https://evil.example";
    mockLoginWithEmail.mockResolvedValue({ success: true, requiresBranchSelection: false });

    const { result } = renderHook(() => useLoginPageController());
    await submitLogin(result);

    expect(mockReplace).toHaveBeenCalledWith("/dashboard");
  });
});
