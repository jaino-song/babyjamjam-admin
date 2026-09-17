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

describe("PATCH /api/notifications/read-all", () => {
    beforeEach(() => {
        mockPatch.mockReset();
    });

    it("rejects an unauthenticated mutation with a registered 401 problem body", async () => {
        const response = await PATCH(
            new NextRequest("http://localhost/api/notifications/read-all", { method: "PATCH" }),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockPatch).not.toHaveBeenCalled();
    });
});
