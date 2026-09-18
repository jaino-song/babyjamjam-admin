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

function createRequest(query: string, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost/api/eformsign-docs/document-id${query}`, {
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

describe("GET /api/eformsign-docs/document-id", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(createRequest("?documentId=doc-1", false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("answers a missing documentId with a structured VALIDATION_FAILED problem", async () => {
        const response = await GET(createRequest(""));

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
        expect(body.errors).toMatchObject([{ pointer: "/documentId", code: "REQUIRED" }]);
        expect(JSON.stringify(body)).not.toContain("documentId is required");
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure instead of reflecting its message", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "document index shard-7 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET(createRequest("?documentId=doc-1"));

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(typeof body.error).toBe("string");
            expect(JSON.stringify(body)).not.toContain("shard-7");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
