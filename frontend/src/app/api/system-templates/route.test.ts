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

describe("GET /api/system-templates", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/system-templates"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure instead of a raw English 500", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "template copy table missing" } },
        });

        const response = await GET(
            new NextRequest("http://localhost/api/system-templates", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("Failed to fetch system templates");
        expect(typeof body.error).toBe("string");
    });
});
