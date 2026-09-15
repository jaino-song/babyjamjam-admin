import { getSafeApiDisplayMessage, sanitizeApiDisplayMessage } from "./safe-api-error-message";

const response = (status: number, message: unknown) => ({
    response: { status, data: { message } },
});

describe("getSafeApiDisplayMessage", () => {
    it.each([
        "auth_token=auth-secret 오류입니다.",
        "refresh_token: refresh-secret 오류입니다.",
        '"Cookie": "auth_token=auth-secret; refresh_token=refresh-secret"',
        "Set-Cookie: auth_token=auth-secret; Path=/",
    ])("rejects session cookie diagnostics from a 4xx message (%s)", (message) => {
        expect(getSafeApiDisplayMessage(response(400, message))).toBeNull();
    });

    it("preserves ordinary validation text that does not carry a sensitive value", () => {
        const message = "비밀번호는 8자 이상으로 입력해 주세요.";

        expect(getSafeApiDisplayMessage(response(400, message))).toBe(message);
    });
});

describe("sanitizeApiDisplayMessage", () => {
    it.each([
        ["auth_token=auth-secret&next=ok", "auth_token=[REDACTED]&next=ok"],
        ["?refresh_token=refresh-secret", "?refresh_token=[REDACTED]"],
        ['{"auth_token":"auth-secret"}', '{"auth_token":[REDACTED]}'],
        ["'Set-Cookie': 'auth_token=auth-secret; Path=/'", "'Set-Cookie': [REDACTED]"],
    ])("redacts sensitive query and quoted assignments (%s)", (message, expected) => {
        expect(sanitizeApiDisplayMessage(message)).toBe(expected);
    });

    it("redacts the full value of a compound cookie header", () => {
        const message = "Cookie: auth_token=auth-secret; refresh_token=refresh-secret; selected_branch_id=branch-1";
        const sanitized = sanitizeApiDisplayMessage(message);

        expect(sanitized).toBe("Cookie: [REDACTED]");
        expect(sanitized).not.toContain("auth-secret");
        expect(sanitized).not.toContain("refresh-secret");
    });

    it("redacts folded Set-Cookie values that contain comma-separated cookies", () => {
        const message = "Set-Cookie: sid=first-secret; Expires=Wed, 21 Oct 2030 07:28:00 GMT, session=second-secret; Path=/";
        const sanitized = sanitizeApiDisplayMessage(message);

        expect(sanitized).toBe("Set-Cookie: [REDACTED]");
        expect(sanitized).not.toContain("first-secret");
        expect(sanitized).not.toContain("second-secret");
    });

    it("preserves ordinary text around a redacted value", () => {
        expect(sanitizeApiDisplayMessage("입력값 auth_token=auth-secret 이 올바르지 않아요.")).toBe(
            "입력값 auth_token=[REDACTED] 이 올바르지 않아요.",
        );
    });
});
