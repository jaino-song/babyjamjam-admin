import { createProblemDetails, type ProblemCode, type ProblemError } from "@babyjamjam/shared";
import { AxiosError } from "axios";
import { completeAccountOnboarding } from "./actions";
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
it("sets session cookies without exposing tokens and deletes both pending cookies", async () => {
  post.mockResolvedValue({ status: 201, data: { accessToken: "access", refreshToken: "refresh", requiresBranchSelection: true } });
  expect(await completeAccountOnboarding({ phone: "01012345678" })).toEqual({ success: true, requiresBranchSelection: true });
  expect(post).toHaveBeenCalledWith("/auth/onboarding/complete", { phone: "01012345678" }, { headers: { "x-pending-onboarding-token": "pending" } });
  expect(setAuthSessionCookies).toHaveBeenCalledWith(store, { accessToken: "access", refreshToken: "refresh" });
  expect(store.delete.mock.calls).toEqual([["pending_account_onboarding"], ["pending_kakao_signup"]]);
});
it("clears an expired cookie", async () => {
  fail(401, "AUTH_REQUIRED");
  expect((await completeAccountOnboarding({})).error).toContain("만료");
  expect(store.delete).toHaveBeenCalledWith("pending_account_onboarding");
});
it.each(["phone", "birthDate"])("maps /%s to local field copy", async (field) => {
  fail(400, "VALIDATION_FAILED", [{ pointer: `/${field}`, code: "INVALID_VALUE", detail: "Invalid value" }]);
  const result = await completeAccountOnboarding({});
  expect(result.field).toBe(field);
  expect(result.error).toBe(field === "phone" ? "이미 등록된 전화번호예요. 오너에게 문의해 주세요." : "올바른 생년월일을 입력해 주세요.");
});
it.each(["PENDING_APPROVAL", "ACCOUNT_REJECTED", "NO_ACCESSIBLE_BRANCH"])("returns %s", async (code) => {
  fail(403, code as ProblemCode);
  expect(await completeAccountOnboarding({})).toEqual({ success: false, code });
});
