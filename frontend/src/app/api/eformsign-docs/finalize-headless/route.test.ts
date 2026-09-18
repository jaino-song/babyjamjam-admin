/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: unknown, authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/eformsign-docs/finalize-headless", {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

describe("POST /api/eformsign-docs/finalize-headless", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated finalize with a registered 401 problem body", async () => {
        const response = await POST(createRequest({ documentId: "doc-1" }, false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("sanitizes an upstream finalize failure instead of a raw English body", async () => {
        mockPost.mockRejectedValue({
            response: { status: 500, data: { message: "finalize worker shard-2 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await POST(createRequest({ documentId: "doc-1" }));

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(typeof body.error).toBe("string");
            expect(JSON.stringify(body)).not.toContain("shard-2");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
