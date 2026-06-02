import { getKakaoOAuthConfig } from "../kakao-config";

const ORIGINAL_ENV = process.env;

describe("getKakaoOAuthConfig", () => {
    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        delete process.env["KAKAO_CLIENT_ID"];
        delete process.env["KAKAO_CLIENT_SECRET"];
        delete process.env["KAKAO_CALLBACK_URL"];
        delete process.env["NODE_ENV"];
        delete process.env["VERCEL_ENV"];
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it("should return configured OAuth values after trimming whitespace", () => {
        process.env["NODE_ENV"] = "production";
        process.env["KAKAO_CLIENT_ID"] = "  kakao-client  ";
        process.env["KAKAO_CLIENT_SECRET"] = "  kakao-secret  ";
        process.env["KAKAO_CALLBACK_URL"] = "  https://staff.example.com/auth/kakao/callback  ";

        expect(getKakaoOAuthConfig()).toEqual({
            clientID: "kakao-client",
            clientSecret: "kakao-secret",
            callbackURL: "https://staff.example.com/auth/kakao/callback",
        });
    });

    it.each([
        ["production", undefined],
        ["staging", undefined],
        [undefined, "preview"],
        [undefined, "production"],
    ])("should require Kakao ID and callback in production-like env NODE_ENV=%s VERCEL_ENV=%s", (nodeEnv, vercelEnv) => {
        if (nodeEnv !== undefined) {
            process.env["NODE_ENV"] = nodeEnv;
        }
        if (vercelEnv !== undefined) {
            process.env["VERCEL_ENV"] = vercelEnv;
        }

        expect(() => getKakaoOAuthConfig()).toThrow("KAKAO_CLIENT_ID and KAKAO_CALLBACK_URL are required");
    });

    it.each(["development", "test", undefined])("should preserve local fallback for NODE_ENV=%s", (nodeEnv) => {
        if (nodeEnv !== undefined) {
            process.env["NODE_ENV"] = nodeEnv;
        }

        expect(getKakaoOAuthConfig()).toEqual({
            clientID: "dev-kakao-client-id",
            clientSecret: undefined,
            callbackURL: "http://localhost:3001/auth/kakao/callback",
        });
    });
});
