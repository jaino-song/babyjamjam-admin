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

function createRequest(rawBody: string | undefined, authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/eformsign-docs/jobs/creation", {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(rawBody !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(rawBody !== undefined ? { body: rawBody } : {}),
    });
}

describe("POST /api/eformsign-docs/jobs/creation", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated enqueue with a registered 401 problem body", async () => {
        const response = await POST(createRequest(JSON.stringify({ templateId: "tpl-1" }), false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("answers a malformed body with a registered validation problem", async () => {
        const response = await POST(createRequest("{invalid"));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("sanitizes an upstream enqueue failure instead of a raw English body", async () => {
        mockPost.mockRejectedValue({
            response: { status: 500, data: { message: "creation queue shard-4 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await POST(createRequest(JSON.stringify({ templateId: "tpl-1" })));

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(typeof body.error).toBe("string");
            expect(JSON.stringify(body)).not.toContain("shard-4");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
