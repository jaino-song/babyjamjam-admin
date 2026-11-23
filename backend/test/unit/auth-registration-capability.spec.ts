import { BadRequestException } from "@nestjs/common";
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { RouteParamsFactory } from "@nestjs/core/router/route-params-factory";

import type { AuthService } from "application/services/auth.service";
import { problemBody } from "application/utils/problem-bodies";
import { RateLimitGuard } from "infrastructure/auth/rate-limit.guard";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { AuthController } from "interface/controllers/auth.controller";

describe.each(["register", "completeKakaoOnboarding"] as const)("%s capability ingress", method => {
    const registerWithEmail = jest.fn();
    const completeKakaoOnboarding = jest.fn();
    const resetForKey = jest.fn();
    const controller = new AuthController(
        { registerWithEmail, completeKakaoOnboarding } as unknown as AuthService,
        {} as PrismaService,
        { resetForKey } as unknown as RateLimitGuard,
    );
    const email = "qa@example.invalid";
    const body = { phone: "01012345678", birthDate: "1990-01-01" };
    const expectedArguments = method === "register"
        ? [email, "Password1!", "QA", body.phone, body.birthDate]
        : ["pending", body.phone, body.birthDate, "user"];
    const signup = method === "register" ? registerWithEmail : completeKakaoOnboarding;
    const paramsFactory = new RouteParamsFactory();

    function call(version?: string | string[]) {
        const params = Reflect.getMetadata(ROUTE_ARGS_METADATA, AuthController, method) as Record<string, { data: string }>;
        const index = method === "register" ? 2 : 3;
        const headerName = params[`${RouteParamtypes.HEADERS}:${index}`]?.data;
        if (headerName !== "x-account-link-version") throw new Error("Missing account link header decorator");
        const request = { headers: { "x-account-link-version": version } };
        const header = paramsFactory.exchangeKeyForValue<typeof request, undefined, typeof version>(
            RouteParamtypes.HEADERS, headerName, { req: request, res: undefined, next: jest.fn() },
        ) ?? undefined;

        return method === "register"
            ? controller.register({ ...body, email, password: "Password1!", name: "QA" }, "127.0.0.1", header)
            : controller.completeKakaoOnboarding("pending", undefined, { ...body, role: "user" }, header);
    }

    beforeEach(() => jest.resetAllMocks());

    it.each([
        { version: undefined }, { version: "" }, { version: "2" },
        { version: "1, 1" }, { version: ["1", "1"] }, { version: ["1"] }, { version: " 1" },
    ])("propagates the legacy refusal without a success reset for $version", async ({ version }) => {
        signup.mockRejectedValueOnce(new BadRequestException(problemBody("VALIDATION_FAILED", {
            pointer: "/phone", code: "INVALID_VALUE", detail: "Test phone refusal",
        })));
        await expect(call(version)).rejects.toMatchObject({
            status: 400, response: { errors: [{ pointer: "/phone", code: "INVALID_VALUE" }] },
        });

        expect(signup).toHaveBeenCalledWith(...expectedArguments, false);
        expect(resetForKey).not.toHaveBeenCalled();
        expect(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype[method])).toContain(RateLimitGuard);
    });

    it("forwards explicit opt-in and returns the challenge", async () => {
        const challenge = { success: true, linkVerificationRequired: true, linkChallengeToken: "synthetic" };
        signup.mockResolvedValueOnce(challenge);
        await expect(call("1")).resolves.toEqual(challenge);
        expect(signup).toHaveBeenCalledWith(...expectedArguments, true);
    });

    it.each([undefined, "1"])("permits ordinary signup at version %p", async version => {
        const result = { success: true, userId: "synthetic-user" };
        signup.mockResolvedValueOnce(result);
        await expect(call(version)).resolves.toEqual(result);
        expect(signup).toHaveBeenCalledWith(...expectedArguments, version === "1");
        if (method === "register") {
            expect(resetForKey).toHaveBeenCalledWith("127.0.0.1", email, "post:register");
        }
    });
});
