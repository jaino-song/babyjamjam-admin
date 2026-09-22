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

describe("GET /api/message-trigger-templates", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/message-trigger-templates"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure instead of a raw English 500", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "template provider crashed on host db-3" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            new NextRequest("http://localhost/api/message-trigger-templates?provider=ALIMTALK", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("db-3");
        expect(JSON.stringify(body)).not.toContain("Failed to fetch message trigger templates");
        consoleErrorSpy.mockRestore();
    });
});
