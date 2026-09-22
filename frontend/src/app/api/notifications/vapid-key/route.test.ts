/**
 * @jest-environment node
 */
import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/notifications/vapid-key", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        mockGet.mockReset();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("keeps a successful key fetch untouched", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { publicKey: "vapid-public-key" } });

        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ publicKey: "vapid-public-key" });
    });

    it("preserves an upstream failure status and drops the raw English error body", async () => {
        mockGet.mockRejectedValue({
            response: { status: 503, data: { message: "push service disabled on pod-2" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET();

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("pod-2");
        expect(JSON.stringify(body)).not.toContain("Failed to fetch vapid key");
        consoleErrorSpy.mockRestore();
    });

    it("answers a transport failure with the sanitized 500 problem contract", async () => {
        mockGet.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.9:8080"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET();

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
        expect(JSON.stringify(body)).not.toContain("10.0.0.9");
        consoleErrorSpy.mockRestore();
    });
});
