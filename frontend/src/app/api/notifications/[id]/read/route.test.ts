/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        patch: jest.fn(),
    },
}));

const mockPatch = serverAPIClient.patch as jest.Mock;

describe("PATCH /api/notifications/[id]/read", () => {
    beforeEach(() => {
        mockPatch.mockReset();
    });

    it("rejects an unauthenticated mutation with a registered 401 problem body", async () => {
        const response = await PATCH(
            new NextRequest("http://localhost/api/notifications/12/read", { method: "PATCH" }),
            { params: Promise.resolve({ id: "12" }) },
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("keeps the upstream success status", async () => {
        mockPatch.mockResolvedValue({ status: 200, data: { id: 12, read: true } });

        const response = await PATCH(
            new NextRequest("http://localhost/api/notifications/12/read", {
                method: "PATCH",
                headers: { cookie: "auth_token=token-1" },
            }),
            { params: Promise.resolve({ id: "12" }) },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: 12, read: true });
    });
});
