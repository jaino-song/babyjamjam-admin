/**
 * @jest-environment node
 */
import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/auth/branches/all", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "RESOURCE_NOT_FOUND",
            requestId: "req-branches-all",
            outcome: "NOT_APPLIED",
        });
        mockGet.mockRejectedValue({
            response: {
                status: 404,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await GET();

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            code: "RESOURCE_NOT_FOUND",
            status: 404,
        });
    });

    it("keeps a successful branch list untouched", async () => {
        mockGet.mockResolvedValue({ data: [{ id: 1, name: "본점" }], status: 200 });

        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([{ id: 1, name: "본점" }]);
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockGet.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.internal"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET();

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("ENOTFOUND");
        consoleErrorSpy.mockRestore();
    });
});
