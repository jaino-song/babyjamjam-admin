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

describe("GET /api/notifications", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/notifications"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("keeps a successful list untouched", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { items: [], unreadCount: 0 } });

        const response = await GET(
            new NextRequest("http://localhost/api/notifications?limit=10", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ items: [], unreadCount: 0 });
        expect(mockGet).toHaveBeenCalledWith(
            "/notifications",
            expect.objectContaining({ params: { limit: "10" } }),
        );
    });
});
