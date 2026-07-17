export type TokenExchangeClassification =
  | {
      kind: "authenticated";
      accessToken: string;
      refreshToken: string;
      requiresBranchSelection: boolean;
    }
  | {
      kind: "account-onboarding";
      onboardingRoute: "/onboarding";
      pendingToken: string;
    }
  | {
      kind: "kakao-onboarding";
      onboardingRoute: "/kakao/onboarding";
      pendingToken: string;
    }
  | { kind: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function classifyTokenExchangeResponse(
  value: unknown,
): TokenExchangeClassification {
  if (!isRecord(value)) {
    return { kind: "invalid" };
  }

  if (
    typeof value.accessToken === "string"
    && typeof value.refreshToken === "string"
  ) {
    return {
      kind: "authenticated",
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      requiresBranchSelection: Boolean(
        value.requiresBranchSelection || value.requiresOrgSelection,
      ),
    };
  }

  if (
    value.onboardingRequired === true
    && value.onboardingRoute === "/onboarding"
    && typeof value.pendingAccountOnboardingToken === "string"
  ) {
    return {
      kind: "account-onboarding",
      onboardingRoute: "/onboarding",
      pendingToken: value.pendingAccountOnboardingToken,
    };
  }

  if (
    value.onboardingRequired === true
    && value.onboardingRoute === "/kakao/onboarding"
    && typeof value.pendingSignupToken === "string"
  ) {
    return {
      kind: "kakao-onboarding",
      onboardingRoute: "/kakao/onboarding",
      pendingToken: value.pendingSignupToken,
    };
  }

  return { kind: "invalid" };
}
