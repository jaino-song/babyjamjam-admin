import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import { useCallbackPageController } from "../use-callback-page-controller";
import { resetAuthorityState } from "@/lib/auth/authority-state";
import {
  OAUTH_RETURN_PATH_STORAGE_KEY,
  OAUTH_RETURN_PATH_TTL_MS,
} from "@/lib/auth/safe-return-path";

const mockReplace = jest.fn();
const mockPush = jest.fn();

// Controlled per test so we can drive `searchParams.get("code" | "error" | "returnTo")`.
let searchParamValues: Record<string, string | null> = {};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => (key in searchParamValues ? searchParamValues[key] : null),
  }),
}));

const exchangeTokenMock = jest.fn();
jest.mock("@/app/(auth)/callback/actions", () => ({
  exchangeToken: (code: string) => exchangeTokenMock(code),
}));

jest.mock("@/lib/auth/authority-state", () => ({
  resetAuthorityState: jest.fn().mockResolvedValue(undefined),
}));

const mockedResetAuthorityState = jest.mocked(resetAuthorityState);

// A probe so we can render the hook through `render(<StrictMode>...)`. Note:
// `renderHook(..., { wrapper: <StrictMode> })` does NOT double-invoke the hook's
// effect under React 19 — only `render()` inside a <StrictMode> element does,
// which is the condition this regression depends on.
function CallbackProbe() {
  const { error, goToLogin } = useCallbackPageController();
  return (
    <>
      <span>{error}</span>
      <button type="button" onClick={goToLogin}>로그인</button>
    </>
  );
}

function setStoredReturnPath(path: string, expiresAt = Date.now() + OAUTH_RETURN_PATH_TTL_MS) {
  window.sessionStorage.setItem(
    OAUTH_RETURN_PATH_STORAGE_KEY,
    JSON.stringify({ path, expiresAt }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedResetAuthorityState.mockResolvedValue(undefined);
  searchParamValues = {};
  window.sessionStorage.clear();
});

describe("useCallbackPageController", () => {
  // Regression guard for the dev-only stuck "로그인 중..." spinner. React Strict Mode
  // runs the effect twice (setup -> cleanup -> setup). The fix must let the second
  // (live) run navigate, and the single-use code must still be exchanged exactly
  // once. Before the fix, a per-render ref guard made run #2 bail while run #1
  // dropped its result as cancelled, so the page never left the spinner.
  it("navigates to /dashboard under Strict Mode's double-invoked effect", async () => {
    searchParamValues = { error: null, code: "kakao-auth-code" };
    exchangeTokenMock.mockResolvedValue({ success: true, requiresBranchSelection: false });

    render(
      <StrictMode>
        <CallbackProbe />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
    expect(mockedResetAuthorityState).toHaveBeenCalled();
    expect(exchangeTokenMock).toHaveBeenCalledTimes(1);
  });

  it("returns directly to a safe editor path after social login", async () => {
    searchParamValues = { error: null, code: "kakao-direct-code" };
    setStoredReturnPath("/service-record-admin/client-1");
    exchangeTokenMock.mockResolvedValue({ success: true, requiresBranchSelection: false });

    render(<CallbackProbe />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/service-record-admin/client-1");
    });
    expect(window.sessionStorage.getItem(OAUTH_RETURN_PATH_STORAGE_KEY)).toBeNull();
  });

  it("preserves the safe editor path through branch selection", async () => {
    searchParamValues = { error: null, code: "kakao-branch-code" };
    setStoredReturnPath("/service-record-admin/client-1");
    exchangeTokenMock.mockResolvedValue({ success: true, requiresBranchSelection: true });

    render(<CallbackProbe />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/select-branch?returnTo=%2Fservice-record-admin%2Fclient-1",
      );
    });
    expect(window.sessionStorage.getItem(OAUTH_RETURN_PATH_STORAGE_KEY)).toBeNull();
  });

  it("preserves the safe editor path through either onboarding route", async () => {
    searchParamValues = { error: null, code: "kakao-onboarding-code" };
    setStoredReturnPath("/service-record-admin/client-1");
    exchangeTokenMock.mockResolvedValue({
      success: true,
      onboardingRequired: true,
      onboardingRoute: "/kakao/onboarding",
    });

    render(<CallbackProbe />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/kakao/onboarding?returnTo=%2Fservice-record-admin%2Fclient-1",
      );
    });
    expect(window.sessionStorage.getItem(OAUTH_RETURN_PATH_STORAGE_KEY)).toBeNull();
  });

  it("accepts a safe callback query return path when no storage value exists", async () => {
    searchParamValues = {
      error: null,
      code: "kakao-query-code",
      returnTo: "/service-record-admin/client-1",
    };
    exchangeTokenMock.mockResolvedValue({ success: true, requiresBranchSelection: false });

    render(<CallbackProbe />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/service-record-admin/client-1");
    });
  });

  it.each([
    ["external", "https://evil.example"],
    ["expired", "/service-record-admin/client-1"],
  ])("falls back to the dashboard for %s stored return paths", async (kind, path) => {
    searchParamValues = { error: null, code: "kakao-unsafe-code" };
    setStoredReturnPath(
      path,
      kind === "expired" ? Date.now() - 1 : Date.now() + OAUTH_RETURN_PATH_TTL_MS,
    );
    exchangeTokenMock.mockResolvedValue({ success: true, requiresBranchSelection: false });

    render(<CallbackProbe />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
    expect(window.sessionStorage.getItem(OAUTH_RETURN_PATH_STORAGE_KEY)).toBeNull();
  });

  it("keeps a safe editor path when callback errors send the user to login", async () => {
    searchParamValues = { error: "access_denied", code: null };
    setStoredReturnPath("/service-record-admin/client-1");

    render(<CallbackProbe />);
    await screen.findByText("로그인 중 오류가 발생했어요.");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "로그인" })).toBeInTheDocument();
    });
    screen.getByRole("button", { name: "로그인" }).click();

    expect(mockPush).toHaveBeenCalledWith(
      "/login?returnTo=%2Fservice-record-admin%2Fclient-1",
    );
    expect(window.sessionStorage.getItem(OAUTH_RETURN_PATH_STORAGE_KEY)).toBeNull();
  });

  it("does not expose arbitrary callback error text", async () => {
    searchParamValues = { error: "provider stack trace", code: null };

    render(<CallbackProbe />);

    expect(await screen.findByText("로그인 중 오류가 발생했어요.")).toBeInTheDocument();
    expect(screen.queryByText("provider stack trace")).not.toBeInTheDocument();
    expect(exchangeTokenMock).not.toHaveBeenCalled();
  });
});
