/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/auth/me", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/auth/me"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("stops reflecting the raw upstream message field", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "select * failed on internal table" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            new NextRequest("http://localhost/api/auth/me", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("internal table");
        expect(typeof body.error).toBe("string");
        consoleErrorSpy.mockRestore();
    });
});
