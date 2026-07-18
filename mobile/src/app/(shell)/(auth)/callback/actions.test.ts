import { cookies } from "next/headers";

import { serverAPIClient } from "@/lib/api/server";
import { exchangeToken } from "./actions";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/api/server", () => ({
  serverAPIClient: { post: jest.fn() },
}));
jest.mock("@/lib/env", () => ({
  getServerRuntimeConfig: () => ({ isSecureCookieEnv: true }),
}));

const mockCookies = jest.mocked(cookies);
const mockPost = jest.mocked(serverAPIClient.post);

describe("mobile callback exchangeToken", () => {
  it("stores the pending Kakao signup token instead of treating it as an access token", async () => {
    const cookieStore = {
      set: jest.fn(),
      delete: jest.fn(),
    };
    mockCookies.mockResolvedValue(cookieStore as never);
    mockPost.mockResolvedValue({
      data: {
        onboardingRequired: true,
        onboardingRoute: "/kakao/onboarding",
        pendingSignupToken: "pending-signup-token",
      },
    });

    await expect(exchangeToken("one-time-code")).resolves.toEqual({
      success: true,
      onboardingRequired: true,
      onboardingRoute: "/kakao/onboarding",
    });
    expect(cookieStore.set).toHaveBeenCalledWith(
      "pending_kakao_signup",
      "pending-signup-token",
      expect.objectContaining({ httpOnly: true, secure: true, maxAge: 1800 }),
    );
    expect(cookieStore.delete).toHaveBeenCalledWith("auth_token");
    expect(cookieStore.delete).toHaveBeenCalledWith("refresh_token");
  });
});
