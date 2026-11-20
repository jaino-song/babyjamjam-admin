/** @jest-environment node */
import { cookies } from "next/headers";
import { AxiosError } from "axios";
import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { writeLoginSessionCookies } from "@/lib/auth/login-session-cookies";
import { completeAccountOnboarding } from "./actions";
import { completeKakaoOnboarding, verifyKakaoLink } from "../kakao/onboarding/actions";
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
jest.mock("@/lib/auth/login-session-cookies", () => ({ writeLoginSessionCookies: jest.fn() }));
const store = { get: jest.fn(), delete: jest.fn() };
const post = jest.mocked(serverAPIClient.post);
function failure(status: number, code: "VALIDATION_FAILED" | "AUTH_REQUIRED" | "PENDING_APPROVAL" | "ACCOUNT_REJECTED" | "NO_ACCESSIBLE_BRANCH", pointer?: string, fieldCode: "INVALID_VALUE" | "REQUIRED" = "INVALID_VALUE") {
  const data = createProblemDetails({ code, requestId: "test-request", ...(pointer ? { errors: [{ pointer, code: fieldCode, detail: "Invalid value" }] } : {}) });
  return new AxiosError("failure", undefined, undefined, undefined, { status, data } as never);
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(cookies).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof cookies>>);
  store.get.mockReturnValue({ value: "pending" });
});
it("rejects missing cookie without a request", async () => {
  store.get.mockReturnValue(undefined);
  expect(await completeAccountOnboarding({})).toEqual({ success: false, error: "로그인 세션이 만료됐어요. 다시 로그인해 주세요." });
  expect(post).not.toHaveBeenCalled();
});
it("writes the session and deletes both pending cookies", async () => {
  const data = { success: true, accessToken: "a", refreshToken: "r", requiresBranchSelection: true };
  post.mockResolvedValue({ data, status: 201 });
  expect(await completeAccountOnboarding({ phone: "010-1234-5678" })).toEqual({ success: true, requiresBranchSelection: true });
  expect(writeLoginSessionCookies).toHaveBeenCalledWith(data, true);
  expect(store.delete.mock.calls).toEqual([["pending_account_onboarding"], ["pending_kakao_signup"]]);
  expect(post).toHaveBeenCalledWith("/auth/onboarding/complete", { phone: "010-1234-5678" }, { headers: { "x-pending-onboarding-token": "pending" } });
});
it("expires the pending session on 401", async () => {
  post.mockRejectedValue(failure(401, "AUTH_REQUIRED"));
  expect((await completeAccountOnboarding({})).error).toContain("만료");
  expect(store.delete).toHaveBeenCalledWith("pending_account_onboarding");
});
it.each(["PENDING_APPROVAL", "ACCOUNT_REJECTED", "NO_ACCESSIBLE_BRANCH"] as const)("returns 403 %s", async code => {
  post.mockRejectedValue(failure(403, code));
  expect((await completeAccountOnboarding({})).authErrorCode).toBe(code);
});
it.each(["phone", "birthDate"] as const)("maps the %s pointer to authored field copy", async field => {
  post.mockRejectedValue(failure(400, "VALIDATION_FAILED", `/${field}`));
  expect(await completeAccountOnboarding({})).toMatchObject({ success: false, field, error: field === "phone" ? "이미 등록된 전화번호예요. 오너에게 문의해 주세요." : expect.any(String) });
});
it("retains Kakao pending cookie for a link challenge", async () => {
  post.mockResolvedValue({ data: { success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" } });
  expect(await completeKakaoOnboarding({ phone: "010-1234-5678", birthDate: "1990-01-01", role: "user" })).toMatchObject({ linkVerificationRequired: true, linkChallengeToken: "challenge" });
  expect(store.delete).not.toHaveBeenCalled();
});
it.each([
  ["/phone", "INVALID_VALUE", "phone", "이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요."],
  ["/phone", "REQUIRED", "phone", "전화번호 형식이 올바르지 않아요. 010-1234-5678처럼 입력해 주세요."],
  ["/birthDate", "INVALID_VALUE", "birthDate", "생년월일 형식이 올바르지 않아요. 1990-01-01처럼 입력해 주세요."],
  ["/birthDate", "REQUIRED", "birthDate", "생년월일 형식이 올바르지 않아요. 1990-01-01처럼 입력해 주세요."],
] as const)("maps Kakao %s %s to its field and authored copy", async (pointer, fieldCode, field, error) => {
  post.mockRejectedValue(failure(400, "VALIDATION_FAILED", pointer, fieldCode));

  expect(await completeKakaoOnboarding({ phone: "010-1234-5678", birthDate: "1990-01-01", role: "user" }))
    .toEqual({ success: false, field, error });
  expect(store.delete).not.toHaveBeenCalled();
});
it.each([
  ["verified", createProblemDetails({ code: "REQUEST_RATE_LIMITED", requestId: "test-request" }), "잠시 기다린 뒤 요청 상태를 확인해 주세요."],
  ["unverified", { code: "REQUEST_RATE_LIMITED", detail: "Untrusted upstream detail", message: "Untrusted upstream message" }, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."],
] as const)("uses safe copy for a %s Kakao 429", async (_shape, data, error) => {
  post.mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 429, data } as never));

  expect(await completeKakaoOnboarding({ phone: "010-1234-5678", birthDate: "1990-01-01", role: "user" }))
    .toEqual({ success: false, error });
  expect(store.delete).not.toHaveBeenCalled();
});
it("verifies Kakao link and deletes the pending cookie", async () => {
  post.mockResolvedValue({ data: { success: true, linked: true } });
  expect(await verifyKakaoLink("challenge", "123456")).toEqual({ success: true });
  expect(post).toHaveBeenCalledWith("/auth/kakao/link/verify", { challengeToken: "challenge", code: "123456" }, { headers: { "x-pending-signup-token": "pending" } });
  expect(store.delete).toHaveBeenCalledWith("pending_kakao_signup");
});
it("expires Kakao links on 401", async () => {
  post.mockRejectedValue(failure(401, "AUTH_REQUIRED"));
  expect((await verifyKakaoLink("challenge", "123456")).error).toBe("카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요.");
  expect(store.delete).toHaveBeenCalledWith("pending_kakao_signup");
});
it("maps code failures from real problem shape", async () => {
  post.mockRejectedValue(failure(400, "VALIDATION_FAILED", "/code"));
  expect((await verifyKakaoLink("challenge", "123456")).error).toBe("인증번호가 맞지 않거나 만료됐어요. 다시 입력하거나 처음부터 진행해 주세요.");
});
