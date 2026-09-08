import { t } from "@/lib/i18n/translations";

import {
    getApiDisplayMessage,
    getErrorMessage,
} from "./api-error-mapper";

const FALLBACK_KEY = "clients.form.error-save-failed";
const fallback = t("ko", FALLBACK_KEY);

function axiosError(status: number, data: unknown) {
    return { response: { status, data } };
}

describe("getErrorMessage", () => {
    it("keeps localized Prisma mapping ahead of any backend message", () => {
        const message = getErrorMessage(
            axiosError(409, {
                statusCode: 409,
                code: "P2002",
                error: "Conflict",
                field: "phone",
                message: "duplicate phone number",
            }),
            "ko",
            FALLBACK_KEY,
        );

        expect(message).not.toBe(fallback);
        expect(message).not.toBe("duplicate phone number");
        expect(message).not.toBe("Conflict");
    });

    it("resolves the established dotted key for a phone-specific Prisma message", () => {
        expect(
            getErrorMessage(
                axiosError(409, {
                    code: "P2002",
                    error: "Conflict",
                    field: "phone",
                }),
                "ko",
                FALLBACK_KEY,
            ),
        ).toBe("이미 등록된 연락처입니다. 다른 연락처를 입력해주세요.");
    });

    it("surfaces an actionable business validation message from the proxy error field", () => {
        const message = getErrorMessage(
            axiosError(400, {
                error: "duration must equal the Korean business-day count (15) for the submitted service period",
            }),
            "ko",
            FALLBACK_KEY,
        );

        expect(message).toBe(
            "duration must equal the Korean business-day count (15) for the submitted service period",
        );
    });

    it("surfaces a Korean business validation message verbatim", () => {
        const message = getErrorMessage(
            axiosError(400, { error: "서비스 시작일은 종료일보다 늦을 수 없습니다." }),
            "ko",
            FALLBACK_KEY,
        );

        expect(message).toBe("서비스 시작일은 종료일보다 늦을 수 없습니다.");
    });

    it("prefers the Nest message field over its generic HTTP error name", () => {
        const message = getErrorMessage(
            axiosError(400, {
                message: "자동 고객 등록이 꺼져 있습니다.",
                error: "Bad Request",
            }),
            "ko",
            FALLBACK_KEY,
        );

        expect(message).toBe("자동 고객 등록이 꺼져 있습니다.");
    });

    it("joins non-blank message array entries and trims each entry", () => {
        const message = getErrorMessage(
            axiosError(400, {
                message: ["  이름을 입력해 주세요  ", "", "전화번호 형식이 올바르지 않습니다."],
                error: "Bad Request",
            }),
            "ko",
            FALLBACK_KEY,
        );

        expect(message).toBe("이름을 입력해 주세요, 전화번호 형식이 올바르지 않습니다.");
    });

    it("supports direct data payloads and error arrays", () => {
        const error = {
            data: {
                message: ["", "   "],
                error: ["  첫 번째 오류  ", "두 번째 오류"],
            },
        };

        expect(getApiDisplayMessage(error)).toBe("첫 번째 오류, 두 번째 오류");
        expect(getErrorMessage(error, "ko", FALLBACK_KEY)).toBe("첫 번째 오류, 두 번째 오류");
    });

    it.each([
        "Bad Request",
        "bad request",
        "Conflict",
        "Internal Server Error",
        "Unauthorized",
        "Not Found",
        "Failed to create client",
    ])("uses the localized fallback for an uninformative server message %p", (serverMessage) => {
        expect(getErrorMessage(axiosError(400, { error: serverMessage }), "ko", FALLBACK_KEY)).toBe(
            fallback,
        );
    });

    it("does not leak transport-level Error messages", () => {
        expect(getErrorMessage(new Error("Network Error"), "ko", FALLBACK_KEY)).toBe(fallback);
        expect(getApiDisplayMessage(new Error("upstream database failure"))).toBeNull();
    });

    it.each([
        "Select a provider from the list.",
        "Password must contain at least 8 characters.",
    ])("keeps legitimate validation near-miss %p", (serverMessage) => {
        expect(getApiDisplayMessage(axiosError(400, { message: serverMessage }))).toBe(serverMessage);
        expect(getErrorMessage(axiosError(400, { message: serverMessage }), "ko", FALLBACK_KEY)).toBe(
            serverMessage,
        );
    });

    it.each([
        [400, "Invalid API key: sk_test_secret"],
        [401, "Invalid access token: eyJ.secret"],
        [400, "password: hunter2"],
    ] as const)("rejects value-bearing credential %p payloads", (status, serverMessage) => {
        const error = axiosError(status, { message: serverMessage });

        expect(getApiDisplayMessage(error)).toBeNull();
        expect(getErrorMessage(error, "ko", FALLBACK_KEY)).toBe(fallback);
    });

    it.each([
        "PrismaClientKnownRequestError: Invalid prisma invocation SELECT * FROM Client",
        "Error: database connection failed at /app/src/clients.service.ts:42",
        "upstream rejected Bearer abc.def.ghi",
    ])("does not expose unsafe server internals %p", (serverMessage) => {
        const error = axiosError(500, { message: serverMessage });

        expect(getApiDisplayMessage(error)).toBeNull();
        expect(getErrorMessage(error, "ko", FALLBACK_KEY)).toBe(fallback);
    });

    it("uses the localized fallback when the payload has no usable text", () => {
        expect(getErrorMessage(axiosError(500, {}), "ko", FALLBACK_KEY)).toBe(fallback);
        expect(getErrorMessage(axiosError(400, { message: ["", 42, null], error: "   " }), "ko", FALLBACK_KEY)).toBe(
            fallback,
        );
        expect(getErrorMessage(null, "ko", FALLBACK_KEY)).toBe(fallback);
    });
});
