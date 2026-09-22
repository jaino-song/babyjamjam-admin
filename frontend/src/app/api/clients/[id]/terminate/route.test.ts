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

function createRequest(authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/clients/75/terminate", {
        method: "PATCH",
        headers: {
            ...(authenticated ? { cookie: "auth_token=access-token" } : {}),
            "content-type": "application/json",
        },
        body: JSON.stringify({ terminatedAt: "2026-09-01" }),
    });
}

describe("PATCH /api/clients/[id]/terminate", () => {
    beforeEach(() => {
        mockPatch.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated termination with a registered 401 problem body", async () => {
        const response = await PATCH(createRequest(false), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("forwards a successful termination payload", async () => {
        mockPatch.mockResolvedValue({ data: { id: 75, terminated: true } });

        const response = await PATCH(createRequest(), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: 75, terminated: true });
    });

    it("sanitizes an upstream failure instead of a raw English 500", async () => {
        mockPatch.mockRejectedValue({
            response: { status: 500, data: { message: "termination txn shard-2 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await PATCH(createRequest(), {
                params: Promise.resolve({ id: "75" }),
            });

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(typeof body.error).toBe("string");
            expect(JSON.stringify(body)).not.toContain("shard-2");
            expect(JSON.stringify(body)).not.toContain("Failed to terminate client service");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
