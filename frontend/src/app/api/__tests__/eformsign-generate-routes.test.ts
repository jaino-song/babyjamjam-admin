/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as generateDocument } from "../generate-document/route";
import { POST as generateSignature } from "../generate-signature/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;
const authToken = "auth-token";
const expectedAuthorization = `Bearer ${authToken}`;

function createRequest(path: string, body: string, cookie?: string): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(cookie ? { cookie } : {}),
        },
        body,
    });
}

describe("eformsign generate API routes", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("requires staff auth before generating signatures", async () => {
        const response = await generateSignature(
            createRequest("/api/generate-signature", JSON.stringify({ executionTime: 1780000000000 })),
        );

        expect(response.status).toBe(401);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards staff auth when generating signatures", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { signature: "signed" } });

        const response = await generateSignature(
            createRequest(
                "/api/generate-signature",
                JSON.stringify({ executionTime: 1780000000000 }),
                `auth_token=${authToken}`,
            ),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ signature: "signed" });
        expect(mockPost).toHaveBeenCalledWith(
            "/api/generate-signature",
            { executionTime: 1780000000000 },
            { headers: { Authorization: expectedAuthorization } },
        );
    });

    it("requires staff auth before generating documents", async () => {
        const response = await generateDocument(
            createRequest(
                "/api/generate-document",
                JSON.stringify({ contractData: {}, clientId: 7 }),
                "eformsign_access_token=eformsign-token; eformsign_refresh_token=refresh-token",
            ),
        );

        expect(response.status).toBe(401);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards staff auth when generating documents", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { documentId: "doc-1" } });

        const response = await generateDocument(
            createRequest(
                "/api/generate-document",
                JSON.stringify({ contractData: { customerName: "고객" }, clientId: 7 }),
                `auth_token=${authToken}; eformsign_access_token=eformsign-token; eformsign_refresh_token=refresh-token`,
            ),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ documentId: "doc-1" });
        expect(mockPost).toHaveBeenCalledWith(
            "/api/generate-document",
            {
                contractData: { customerName: "고객" },
                accessToken: "eformsign-token",
                refreshToken: "refresh-token",
                clientId: 7,
            },
            { headers: { Authorization: expectedAuthorization } },
        );
    });

    it("rejects document generation without a persisted client", async () => {
        const response = await generateDocument(
            createRequest(
                "/api/generate-document",
                JSON.stringify({ contractData: { customerName: "고객" } }),
                `auth_token=${authToken}; eformsign_access_token=eformsign-token; eformsign_refresh_token=refresh-token`,
            ),
        );

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON bodies as client errors", async () => {
        const response = await generateSignature(
            createRequest("/api/generate-signature", "{bad-json", `auth_token=${authToken}`),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "Request body must be valid JSON",
        });
        expect(mockPost).not.toHaveBeenCalled();
    });
});
