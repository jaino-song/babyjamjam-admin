import { expect, test } from "@playwright/test";

import { classifyTokenExchangeResponse } from "../src/app/auth/callback/token-response";

test.describe("legacy auth token response", () => {
  test("classifies an access-token response", () => {
    expect(classifyTokenExchangeResponse({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    })).toEqual({
      kind: "authenticated",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      requiresBranchSelection: false,
    });
  });

  test("classifies existing-account onboarding", () => {
    expect(classifyTokenExchangeResponse({
      onboardingRequired: true,
      onboardingRoute: "/onboarding",
      pendingAccountOnboardingToken: "pending-account-token",
    })).toEqual({
      kind: "account-onboarding",
      onboardingRoute: "/onboarding",
      pendingToken: "pending-account-token",
    });
  });

  test("classifies Kakao signup onboarding", () => {
    expect(classifyTokenExchangeResponse({
      onboardingRequired: true,
      onboardingRoute: "/kakao/onboarding",
      pendingSignupToken: "pending-signup-token",
    })).toEqual({
      kind: "kakao-onboarding",
      onboardingRoute: "/kakao/onboarding",
      pendingToken: "pending-signup-token",
    });
  });

  test("rejects a response without tokens or onboarding data", () => {
    expect(classifyTokenExchangeResponse({ message: "Unauthorized" })).toEqual({
      kind: "invalid",
    });
  });
});
