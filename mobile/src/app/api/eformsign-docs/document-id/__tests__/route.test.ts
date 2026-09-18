/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(path: string, cookie?: string): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        headers: cookie ? { cookie } : undefined,
    });
}

describe("GET /api/eformsign-docs/document-id", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("requires the existing application session token", async () => {
        const response = await GET(createRequest("/api/eformsign-docs/document-id?documentId=doc-1"));

        expect(response.status).toBe(401);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects a missing or blank document ID before proxying", async () => {
        for (const query of ["", "?documentId=%20"]) {
            const response = await GET(createRequest(`/api/eformsign-docs/document-id${query}`));

            expect(response.status).toBe(400);
        }

        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards the exact document ID and session token to the local endpoint", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { documentId: "doc/1", createdDate: "2026-09-18T12:00:00.000Z" },
        });

        const response = await GET(
            createRequest("/api/eformsign-docs/document-id?documentId=doc%2F1", "auth_token=session-1"),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            documentId: "doc/1",
            createdDate: "2026-09-18T12:00:00.000Z",
        });
        expect(mockGet).toHaveBeenCalledWith(
            "/eformsign-docs/document-id?documentId=doc%2F1",
            {
                params: {},
                headers: { Authorization: "Bearer session-1" },
            },
        );
    });

    it("preserves a null upstream response", async () => {
        mockGet.mockResolvedValue({ status: 200, data: null });

        const response = await GET(
            createRequest("/api/eformsign-docs/document-id?documentId=doc-1", "auth_token=session-1"),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toBeNull();
    });
});
