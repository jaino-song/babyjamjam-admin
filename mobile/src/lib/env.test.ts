/**
 * @jest-environment node
 */
const ORIGINAL_ENV = process.env;

async function loadEnvModule(overrides: Record<string, string | undefined> = {}) {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };

    Object.entries(overrides).forEach(([key, value]) => {
        if (value === undefined) {
            delete process.env[key];
            return;
        }

        process.env[key] = value;
    });

    let envModule: typeof import("./env") | undefined;

    await jest.isolateModulesAsync(async () => {
        envModule = await import("./env");
    });

    return envModule as typeof import("./env");
}

describe("env", () => {
    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it("fails fast when NEXT_PUBLIC_API_BASE_URL is missing in production", async () => {
        await expect(loadEnvModule({
            NODE_ENV: "production",
            NEXT_PUBLIC_API_BASE_URL: undefined,
            DEVELOPMENT_API_BASE_URL: undefined,
        })).rejects.toThrow(/NEXT_PUBLIC_API_BASE_URL is required when NODE_ENV=production/);
    });

    it("does not allow a development override to replace the production backend URL", async () => {
        const env = await loadEnvModule({
            NODE_ENV: "production",
            NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/",
            DEVELOPMENT_API_BASE_URL: "http://localhost:3001",
        });

        expect(env.PUBLIC_BACKEND_BASE_URL).toBe("https://api.example.com");
        expect(env.getServerRuntimeConfig().backendBaseUrl).toBe("https://api.example.com");
    });

    it("uses the localhost fallback in development when backend URLs are unset", async () => {
        const env = await loadEnvModule({
            NODE_ENV: "development",
            NEXT_PUBLIC_API_BASE_URL: undefined,
            DEVELOPMENT_API_BASE_URL: undefined,
        });

        expect(env.PUBLIC_BACKEND_BASE_URL).toBe("http://localhost:3001");
        expect(env.getServerRuntimeConfig().backendBaseUrl).toBe("http://localhost:3001");
    });
});
