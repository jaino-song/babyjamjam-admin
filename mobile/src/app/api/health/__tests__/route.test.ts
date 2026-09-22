/**
 * @jest-environment node
 */
import { serverAPIClient } from "@/lib/api/server";

import { GET as healthCheck } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        defaults: { baseURL: "https://backend.example.test" },
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const defaults = serverAPIClient.defaults as { baseURL: string | undefined };

describe("health BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleInfoSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        defaults.baseURL = "https://backend.example.test";
        consoleInfoSpy = jest.spyOn(console, "info").mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleInfoSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it("keeps a reachable backend diagnostic success", async () => {
        mockGet.mockResolvedValue({ status: 200, data: {} });

        const response = await healthCheck();

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe("success");
        expect(body.backend).toEqual(expect.objectContaining({ reachable: true }));
    });

    it("answers an unreachable backend with a registered DEPENDENCY_UNAVAILABLE problem that keeps the diagnostics", async () => {
        mockGet.mockRejectedValue(new Error("connect ECONNREFUSED"));

        const response = await healthCheck();

        expect(response.status).toBe(503);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const requestId = response.headers.get("X-Request-Id");
        expect(requestId).toBeTruthy();
        const body = await response.json();
        expect(body).toMatchObject({
            code: "DEPENDENCY_UNAVAILABLE",
            status: 503,
            requestId,
        });
        expect(body.status).toBe(503);
        expect(body.backend).toEqual({ reachable: false });
        expect(typeof body.timestamp).toBe("string");
        expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    });

    it("answers a missing backend URL with a registered INTERNAL_ERROR problem", async () => {
        defaults.baseURL = undefined;

        const response = await healthCheck();

        expect(response.status).toBe(500);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({
            code: "INTERNAL_ERROR",
            status: 500,
        });
        expect(body.status).toBe(500);
    });
});
