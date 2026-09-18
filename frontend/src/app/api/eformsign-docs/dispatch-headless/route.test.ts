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
    return new NextRequest("http://localhost/api/eformsign-docs/dispatch-headless", {
        method: "POST",
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

describe("POST /api/eformsign-docs/dispatch-headless", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated dispatch with a registered 401 problem body", async () => {
        const response = await POST(createRequest({ clientId: 7 }, false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("answers an invalid clientId with a structured VALIDATION_FAILED problem", async () => {
        const response = await POST(createRequest({ clientId: 0 }));

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
        expect(body.errors).toMatchObject([{ pointer: "/clientId", code: "REQUIRED" }]);
        expect(JSON.stringify(body)).not.toContain("clientId is required");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("sanitizes an upstream dispatch failure instead of a raw English body", async () => {
        mockPost.mockRejectedValue({
            response: { status: 500, data: { message: "dispatch worker shard-1 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await POST(createRequest({ clientId: 7 }));

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(typeof body.error).toBe("string");
            expect(JSON.stringify(body)).not.toContain("shard-1");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
