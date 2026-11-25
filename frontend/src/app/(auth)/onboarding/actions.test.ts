import { createProblemDetails, type ProblemCode, type ProblemError } from "@babyjamjam/shared";
import { AxiosError } from "axios";
import { completeAccountOnboarding } from "./actions";
import { completeKakaoOnboarding } from "../kakao/onboarding/actions";
import { serverAPIClient } from "@/lib/api/server";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";
const store = { get: jest.fn(), delete: jest.fn() };
jest.mock("next/headers", () => ({ cookies: async () => store }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
jest.mock("@/lib/auth/session-cookies", () => ({ setAuthSessionCookies: jest.fn() }));
const post = jest.mocked(serverAPIClient.post);
beforeEach(() => { jest.clearAllMocks(); store.get.mockReturnValue({ value: "pending" }); });
function fail(status: number, code: ProblemCode, errors?: ProblemError[]) {
  post.mockRejectedValue(new AxiosError("request failed", undefined, undefined, undefined, {
    status, data: createProblemDetails({ status, code, requestId: "test", errors }),
  } as never));
}
it("requires a cookie", async () => {
  store.get.mockReturnValue(undefined);
  expect(await completeAccountOnboarding({})).toEqual({ success: false, error: "로그인 세션이 만료됐어요. 다시 로그인해 주세요." });
  expect(post).not.toHaveBeenCalled();
});
it("sets session cookies without exposing tokens and deletes the pending cookies and preference", async () => {
  post.mockResolvedValue({ status: 201, data: { accessToken: "access", refreshToken: "refresh", requiresBranchSelection: true } });
  expect(await completeAccountOnboarding({ phone: "01012345678" })).toEqual({ success: true, requiresBranchSelection: true });
  expect(post).toHaveBeenCalledWith("/auth/onboarding/complete", { phone: "01012345678" }, { headers: { "x-pending-onboarding-token": "pending" } });
  expect(setAuthSessionCookies).toHaveBeenCalledWith(store, { accessToken: "access", refreshToken: "refresh", autoLogin: true });
  expect(store.delete.mock.calls).toEqual([["pending_account_onboarding"], ["pending_account_onboarding_auto_login"], ["pending_kakao_signup"]]);
});
it("clears an expired cookie", async () => {
  fail(401, "AUTH_REQUIRED");
  expect((await completeAccountOnboarding({})).error).toContain("만료");
  expect(store.delete).toHaveBeenCalledWith("pending_account_onboarding");
  expect(store.delete).toHaveBeenCalledWith("pending_account_onboarding_auto_login");
});
it("maps /phone INVALID_VALUE to the owner-contact message", async () => {
  fail(400, "VALIDATION_FAILED", [{ pointer: "/phone", code: "INVALID_VALUE", detail: "Invalid value" }]);
  expect(await completeAccountOnboarding({})).toEqual({ success: false, field: "phone", error: "이미 등록된 전화번호예요. 오너에게 문의해 주세요." });
});

describe.each(["account", "kakao"])("%s onboarding field validation", (screen) => {
  it.each<["phone" | "birthDate", ProblemError["code"], string]>([
    ["phone", "REQUIRED", "전화번호를 입력해 주세요"],
    ["phone", "INVALID_FORMAT", "010-1234-5678로 입력해 주세요"],
    ["phone", "OUT_OF_RANGE", "010-1234-5678로 입력해 주세요"],
    ["phone", "UNEXPECTED_FIELD", "010-1234-5678로 입력해 주세요"],
    ["birthDate", "REQUIRED", "생년월일을 입력해 주세요"],
    ["birthDate", "INVALID_FORMAT", "YYYY-MM-DD로 입력해 주세요"],
    ["birthDate", "OUT_OF_RANGE", "YYYY-MM-DD로 입력해 주세요"],
    ["birthDate", "UNEXPECTED_FIELD", "YYYY-MM-DD로 입력해 주세요"],
    ["birthDate", "INVALID_VALUE", "YYYY-MM-DD로 입력해 주세요"],
  ])("maps /%s %s to the form message", async (field, code, message) => {
    fail(400, "VALIDATION_FAILED", [{ pointer: `/${field}`, code, detail: "Invalid value" }]);
    const result = screen === "account"
      ? await completeAccountOnboarding({})
      : await completeKakaoOnboarding({ phone: "01012345678", birthDate: "1990-01-01", role: "user" });
    expect(result).toEqual({ success: false, field, error: message });
    expect(store.delete).not.toHaveBeenCalled();
    expect(setAuthSessionCookies).not.toHaveBeenCalled();
  });
});

it("returns the normalized message for a verified rate-limit problem", async () => {
  fail(429, "REQUEST_RATE_LIMITED");
  expect(await completeAccountOnboarding({})).toEqual({ success: false, error: "잠시 기다린 뒤 요청 상태를 확인해 주세요." });
  expect(store.delete).not.toHaveBeenCalled();
  expect(setAuthSessionCookies).not.toHaveBeenCalled();
});

it("uses local rate-limit copy when the problem cannot be verified", async () => {
  post.mockRejectedValue(new AxiosError("request failed", undefined, undefined, undefined, {
    status: 429, data: { code: "REQUEST_RATE_LIMITED", detail: "Untrusted upstream detail" },
  } as never));
  expect(await completeAccountOnboarding({})).toEqual({ success: false, error: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." });
  expect(store.delete).not.toHaveBeenCalled();
  expect(setAuthSessionCookies).not.toHaveBeenCalled();
});

it("keeps generic failure copy for unrelated failures", async () => {
  fail(500, "INTERNAL_ERROR");
  expect(await completeAccountOnboarding({})).toEqual({ success: false, error: "계정 정보를 저장하지 못했습니다." });
});
it.each(["PENDING_APPROVAL", "ACCOUNT_REJECTED", "NO_ACCESSIBLE_BRANCH"])("returns %s", async (code) => {
  fail(403, code as ProblemCode);
  expect(await completeAccountOnboarding({})).toEqual({ success: false, code });
});

it.each([
  [400, "ACCOUNT_PROFILE_INCOMPLETE"],
  [403, "ACCOUNT_PROFILE_INCOMPLETE_EXTRA"],
  [403, "ACCESS_DENIED"],
] as const)("keeps the generic completion failure for %s %s", async (status, code) => {
  post.mockRejectedValueOnce(new AxiosError("synthetic error", undefined, undefined, undefined, {
    status, data: { code },
  } as never));
  expect(await completeAccountOnboarding({})).toEqual({ success: false, error: "계정 정보를 저장하지 못했습니다." });
  expect(store.delete).not.toHaveBeenCalled();
  expect(setAuthSessionCookies).not.toHaveBeenCalled();
});
