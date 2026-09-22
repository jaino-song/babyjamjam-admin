import { UnauthorizedException } from "@nestjs/common";
import { LocalStrategy } from "./local.strategy";

// The login rejection must be a registered AUTH_REQUIRED problem (401): the
// HTTP mapper keys on the body code, and the public body must not carry the
// old credential-mismatch sentence (or any hint about which half failed).
const expectAuthProblem = async (promise: Promise<unknown>): Promise<void> => {
    const error: unknown = await promise.then(
        () => { throw new Error("expected validate to reject"); },
        (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: "AUTH_REQUIRED",
        outcome: "NOT_APPLIED",
        recovery: { action: "NONE", retry: { mode: "NEVER" } },
    });
    expect((error as UnauthorizedException).getResponse()).not.toHaveProperty("errors");
    expect(JSON.stringify((error as UnauthorizedException).getResponse())).not.toContain("비밀번호");
};

describe("LocalStrategy", () => {
    const authService = { validateEmailPassword: jest.fn() };
    let strategy: LocalStrategy;

    beforeEach(() => {
        jest.clearAllMocks();
        strategy = new LocalStrategy(authService as never);
    });

    it("returns the authenticated user id", async () => {
        authService.validateEmailPassword.mockResolvedValue({ user: "user-1" });

        await expect(strategy.validate("user@example.com", "secret")).resolves.toEqual({ userId: "user-1" });
    });

    it("rejects unknown credentials with an AUTH_REQUIRED problem", async () => {
        authService.validateEmailPassword.mockResolvedValue(null);

        await expectAuthProblem(strategy.validate("user@example.com", "wrong"));
    });

    it("rejects an onboarding-required result with the same AUTH_REQUIRED problem", async () => {
        authService.validateEmailPassword.mockResolvedValue({ onboardingRequired: true });

        await expectAuthProblem(strategy.validate("user@example.com", "secret"));
    });
});
