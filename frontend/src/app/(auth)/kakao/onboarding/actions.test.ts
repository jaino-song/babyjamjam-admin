import { createProblemDetails } from "@babyjamjam/shared";
import { AxiosError } from "axios";
import { completeKakaoOnboarding, verifyKakaoLink } from "./actions";
import { serverAPIClient } from "@/lib/api/server";
const store = { get: jest.fn(), delete: jest.fn() };
jest.mock("next/headers", () => ({ cookies: async () => store }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
beforeEach(() => { jest.clearAllMocks(); store.get.mockReturnValue({ value: "pending" }); });
it("keeps the pending cookie for a link challenge", async () => {
  jest.mocked(serverAPIClient.post).mockResolvedValue({ status: 201, data: { success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" } });
  expect(await completeKakaoOnboarding({ phone: "01012345678", birthDate: "1990-01-01", role: "user" }, "1")).toEqual({ success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" });
  expect(serverAPIClient.post).toHaveBeenCalledWith("/auth/kakao/complete-signup", expect.objectContaining({ role: "user" }), {
    headers: { "x-pending-signup-token": "pending", "x-account-link-version": "1" },
  });
  expect(store.delete).not.toHaveBeenCalled();
});
it("forwards verification and clears the cookie on any successful status", async () => {
  jest.mocked(serverAPIClient.post).mockResolvedValue({ status: 201, data: { success: true, linked: true } });
  expect(await verifyKakaoLink("challenge", "123456")).toEqual({ success: true });
  expect(serverAPIClient.post).toHaveBeenCalledWith("/auth/kakao/link/verify", { challengeToken: "challenge", code: "123456" }, { headers: { "x-pending-signup-token": "pending" } });
  expect(store.delete).toHaveBeenCalledWith("pending_kakao_signup");
});
it.each(["signup", "verify"])("clears 401 in the thrown %s path", async (operation) => {
  jest.mocked(serverAPIClient.post).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 401, data: { code: "AUTH_REQUIRED" } } as never));
  const result = operation === "verify" ? await verifyKakaoLink("challenge", "123456") : await completeKakaoOnboarding({ phone: "01012345678", birthDate: "1990-01-01", role: "user" });
  expect(result.error).toBe("카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요.");
  expect(store.delete).toHaveBeenCalledWith("pending_kakao_signup");
});

it("maps the real generic /code problem to locally authored copy and keeps the cookie", async () => {
  const data = createProblemDetails({ code: "VALIDATION_FAILED", status: 400, requestId: "test", errors: [{ pointer: "/code", code: "INVALID_VALUE", detail: "Invalid value" }] });
  jest.mocked(serverAPIClient.post).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 400, data } as never));
  expect(await verifyKakaoLink("challenge", "123456")).toEqual({ success: false, error: "인증번호가 맞지 않거나 만료됐어요. 다시 입력하거나 처음부터 진행해 주세요." });
  expect(store.delete).not.toHaveBeenCalled();
});
it("maps /phone on the first step to the field", async () => {
  const data = createProblemDetails({ code: "VALIDATION_FAILED", status: 400, requestId: "test", errors: [{ pointer: "/phone", code: "INVALID_VALUE", detail: "Invalid value" }] });
  jest.mocked(serverAPIClient.post).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 400, data } as never));
  expect(await completeKakaoOnboarding({ phone: "01012345678", birthDate: "1990-01-01", role: "user" })).toEqual({ success: false, field: "phone", error: "이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요." });
});
it("uses the safe rate-limit fallback for an unverified problem", async () => {
  jest.mocked(serverAPIClient.post).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 429, data: { detail: "internal" } } as never));
  expect((await completeKakaoOnboarding({ phone: "01012345678", birthDate: "1990-01-01", role: "user" })).error).toBe("요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
});

it.each([
  ["a full problem document", createProblemDetails({ code: "PENDING_APPROVAL", status: 403, requestId: "test" })],
  ["a plain body", { code: "PENDING_APPROVAL" }],
])("maps a pending match from %s without deleting the pending cookie", async (_name, data) => {
  jest.mocked(serverAPIClient.post).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 403, data } as never));
  expect(await completeKakaoOnboarding({ phone: "01012345678", birthDate: "1990-01-01", role: "user" })).toEqual({ success: false, code: "LINK_PENDING_APPROVAL" });
  expect(store.delete).not.toHaveBeenCalled();
});

it("keeps the generic copy for another 403 code", async () => {
  jest.mocked(serverAPIClient.post).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 403, data: { code: "ACCESS_DENIED", message: "upstream internals" } } as never));
  expect(await completeKakaoOnboarding({ phone: "01012345678", birthDate: "1990-01-01", role: "user" })).toEqual({ success: false, error: "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요." });
  expect(store.delete).not.toHaveBeenCalled();
});

it("does not map a pending code without HTTP 403", async () => {
  jest.mocked(serverAPIClient.post).mockRejectedValue(new AxiosError("failure", undefined, undefined, undefined, { status: 400, data: { code: "PENDING_APPROVAL" } } as never));
  expect(await completeKakaoOnboarding({ phone: "01012345678", birthDate: "1990-01-01", role: "user" })).toEqual({ success: false, error: "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요." });
});

describe("Kakao signup capability across releases", () => {
  const input = { phone: "010-1234-5678", birthDate: "1990-01-01", role: "user" };
  const signupPost = jest.mocked(serverAPIClient.post);
  const legacyHeaders = { "x-pending-signup-token": "pending" };
  const optedInHeaders = { ...legacyHeaders, "x-account-link-version": "1" };

  it.each([undefined, "", "2", "1, 1", " 1"])("treats action argument %p as legacy", async value => {
    signupPost.mockResolvedValueOnce({ data: { success: true, linkVerificationRequired: true, linkChallengeToken: "challenge" } });

    await expect(completeKakaoOnboarding(input, value)).resolves.toEqual({
      success: false, error: "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요.",
    });
    expect(signupPost).toHaveBeenCalledWith("/auth/kakao/complete-signup", input, { headers: legacyHeaders });
    expect(store.delete).not.toHaveBeenCalled();
  });

  it.each([undefined, "1"])("shows a phone refusal and keeps the pending signup for capability %p", async value => {
    const data = createProblemDetails({
      code: "VALIDATION_FAILED", requestId: "historical-phone-refusal",
      errors: [{ pointer: "/phone", code: "INVALID_VALUE", detail: "Invalid value" }],
    });
    signupPost.mockRejectedValueOnce(new AxiosError("synthetic refusal", undefined, undefined, undefined, { status: 400, data } as never));

    const result = value === undefined ? await completeKakaoOnboarding(input) : await completeKakaoOnboarding(input, value);
    expect(result).toEqual({
      success: false, field: "phone", error: "이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요.",
    });
    expect(signupPost).toHaveBeenCalledWith("/auth/kakao/complete-signup", input, {
      headers: value === "1" ? optedInHeaders : legacyHeaders,
    });
    expect(store.delete).not.toHaveBeenCalled();
  });

  it.each([undefined, "1"])("completes an ordinary signup for capability %p", async value => {
    signupPost.mockResolvedValueOnce({ data: { success: true, userId: "synthetic-user" } });

    await expect(completeKakaoOnboarding(input, value)).resolves.toEqual({ success: true });
    expect(signupPost).toHaveBeenCalledWith("/auth/kakao/complete-signup", input, {
      headers: value === "1" ? optedInHeaders : legacyHeaders,
    });
    expect(store.delete).toHaveBeenCalledWith("pending_kakao_signup");
  });
});
