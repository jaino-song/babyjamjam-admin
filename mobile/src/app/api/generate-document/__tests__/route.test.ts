/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

const VALID_CONTRACT_DATA = {
    customerName: "고객",
    customerContact: "010-0000-0000",
};

function createRequest(body: BodyInit): NextRequest {
    return new NextRequest("http://localhost/api/generate-document", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: [
                "auth_token=auth-token",
                "eformsign_access_token=access-token",
                "eformsign_refresh_token=refresh-token",
            ].join("; "),
        },
        body,
    });
}

describe("POST /api/generate-document", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects bodies missing contractData before proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({ clientId: 5 })));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards validated contractData and cookie tokens to the backend", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { documentId: "doc-9" } });

        const response = await POST(
            createRequest(JSON.stringify({ contractData: VALID_CONTRACT_DATA, clientId: 5 })),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ documentId: "doc-9" });
        expect(mockPost).toHaveBeenCalledWith(
            "/api/generate-document",
            {
                contractData: VALID_CONTRACT_DATA,
                accessToken: "access-token",
                refreshToken: "refresh-token",
                clientId: 5,
            },
            { headers: { Authorization: "Bearer auth-token" } },
        );
    });
});
