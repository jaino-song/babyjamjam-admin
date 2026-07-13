import { getJwtSecret } from "../jwt-secret";

const ORIGINAL_ENV = process.env;

describe("getJwtSecret", () => {
    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        delete process.env["JWT_SECRET"];
        delete process.env["NODE_ENV"];
        delete process.env["VERCEL_ENV"];
        delete process.env["ALLOW_DEV_JWT_SECRET"];
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it("should return configured secret after trimming whitespace", () => {
        process.env["NODE_ENV"] = "production";
        process.env["JWT_SECRET"] = "  configured-secret  ";

        expect(getJwtSecret()).toBe("configured-secret");
    });

    it.each([
        ["production", undefined],
        ["staging", undefined],
        [undefined, "preview"],
        [undefined, "production"],
    ])("should require JWT_SECRET in production-like env NODE_ENV=%s VERCEL_ENV=%s", (nodeEnv, vercelEnv) => {
        if (nodeEnv !== undefined) {
            process.env["NODE_ENV"] = nodeEnv;
        }
        if (vercelEnv !== undefined) {
            process.env["VERCEL_ENV"] = vercelEnv;
        }

        expect(() => getJwtSecret()).toThrow("JWT_SECRET is required");
    });

    it("should preserve the fallback in tests", () => {
        process.env["NODE_ENV"] = "test";
        expect(getJwtSecret()).toBe("your-secret-key");
    });

    it.each(["development", undefined])("should fail closed without explicit local opt-in for NODE_ENV=%s", (nodeEnv) => {
        if (nodeEnv) process.env["NODE_ENV"] = nodeEnv;

        expect(() => getJwtSecret()).toThrow("JWT_SECRET is required");
    });

    it("should allow the development fallback only with explicit opt-in", () => {
        process.env["NODE_ENV"] = "development";
        process.env["ALLOW_DEV_JWT_SECRET"] = "1";

        expect(getJwtSecret()).toBe("your-secret-key");
    });
});
