import { createRouteUtils, logUpstreamError } from "./route-utils";

describe("logUpstreamError", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("caps the upstream response body at 2,000 characters", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError("proxy", new Error("upstream failed"), "a".repeat(2_001));

        expect(errorSpy).toHaveBeenCalledWith("[proxy] Error:", expect.objectContaining({
            body: `${"a".repeat(2_000)}…(truncated)`,
        }));
    });

    it("preserves the existing two-argument call shape", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError("proxy", new Error("upstream failed"));

        expect(errorSpy).toHaveBeenCalledWith("[proxy] Error:", expect.not.objectContaining({
            body: expect.anything(),
        }));
    });

    it("redacts provider credentials and member identity from upstream bodies", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError(
            "proxy",
            new Error("provider failed"),
            JSON.stringify({
                access_token: "access-secret",
                refreshToken: "refresh-secret",
                memberEmail: "staff@example.com",
                safe: "kept",
            }),
        );

        const logged = JSON.stringify(errorSpy.mock.calls);
        expect(logged).toContain("[REDACTED]");
        expect(logged).not.toContain("access-secret");
        expect(logged).not.toContain("refresh-secret");
        expect(logged).not.toContain("staff@example.com");
        expect(logged).toContain("safe");
    });

    it("redacts every credential in compound Cookie and Set-Cookie headers", () => {
        const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        logUpstreamError(
            "proxy",
            new Error("provider failed"),
            JSON.stringify({
                Cookie: "auth_token=auth-secret; refresh_token=refresh-secret",
                "Set-Cookie": "auth_token=set-cookie-secret; Path=/",
                safe: "kept",
            }),
        );

        const logged = errorSpy.mock.calls[0]?.[1] as { body?: string };
        expect(logged.body).toContain('"Cookie":[REDACTED]');
        expect(logged.body).toContain('"Set-Cookie":[REDACTED]');
        const loggedText = JSON.stringify(logged);
        expect(loggedText).not.toContain("auth-secret");
        expect(loggedText).not.toContain("refresh-secret");
        expect(loggedText).not.toContain("set-cookie-secret");
        expect(loggedText).toContain("safe");
    });
});

describe("createRouteUtils legacy-message errorResponse", () => {
    const serverAPIClient = {
        delete: jest.fn(),
        get: jest.fn(),
        post: jest.fn(),
    } as unknown as Parameters<typeof createRouteUtils>[0]["serverAPIClient"];

    const { errorResponse } = createRouteUtils({
        errorResponseMode: "legacy-message",
        secureCookies: false,
        serverAPIClient,
    });

    function upstreamError(status: number, data: unknown) {
        return { response: { status, data } };
    }

    beforeEach(() => {
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("surfaces the Nest exception message instead of the generic HTTP error name", async () => {
        const response = errorResponse(
            upstreamError(400, {
                message: "duration must equal the Korean business-day count (15) for the submitted service period",
                error: "Bad Request",
                statusCode: 400,
            }),
            "create client",
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "서비스 기간의 실제 이용일 수는 15일이에요. 입력한 이용일 수를 확인해 주세요.",
        });
    });

    it("joins a ValidationPipe message array into one readable line", async () => {
        const response = errorResponse(
            upstreamError(400, {
                message: ["name must be a string", "phone must be a valid Korean phone number"],
                error: "Bad Request",
                statusCode: 400,
            }),
            "create client",
        );

        await expect(response.json()).resolves.toEqual({
            error: "이름 항목은 문자로 입력해 주세요. 연락처 항목에 올바른 국내 전화번호를 입력해 주세요.",
        });
    });

    it("falls back to the upstream error field when no message is present", async () => {
        const response = errorResponse(
            upstreamError(409, { error: "자동 고객 등록이 꺼져 있습니다." }),
            "create client",
        );

        await expect(response.json()).resolves.toEqual({
            error: "자동 고객 등록이 꺼져 있어요.",
        });
    });

    it("falls back to the context placeholder when the upstream body carries nothing usable", async () => {
        const response = errorResponse(upstreamError(500, {}), "create client");

        await expect(response.json()).resolves.toEqual({ error: "서버 내부 오류로 요청을 처리하지 못했어요." });
    });

    it("still redacts credentials that appear inside an upstream message", async () => {
        const response = errorResponse(
            upstreamError(400, { message: "upstream rejected Bearer abc.def.ghi" }),
            "create client",
        );

        const body = await response.json();
        expect(body.error).toBe("입력 정보가 요청 조건에 맞지 않아요. 입력 내용을 확인해 주세요.");
        expect(body.error).not.toContain("abc.def.ghi");
    });

    it.each([
        "auth_token=auth-secret 오류입니다.",
        "refresh_token: refresh-secret 오류입니다.",
        '"Cookie": "auth_token=auth-secret; refresh_token=refresh-secret"',
        "Set-Cookie: auth_token=auth-secret; Path=/",
    ])("does not reflect session cookie diagnostics from a 4xx message (%s)", async (message) => {
        const response = errorResponse(
            upstreamError(400, { message }),
            "create client",
        );

        const body = await response.json();
        expect(body.error).toBe("입력 정보가 요청 조건에 맞지 않아요. 입력 내용을 확인해 주세요.");
        expect(JSON.stringify(body)).not.toContain("auth-secret");
        expect(JSON.stringify(body)).not.toContain("refresh-secret");
    });
});
