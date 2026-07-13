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

function createRequest(body: BodyInit = JSON.stringify({ documentId: "doc-1" })): NextRequest {
    return new NextRequest("http://localhost/api/generate-staff-document", {
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

describe("POST /api/generate-staff-document", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("rejects bodies missing documentId before proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({})));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards the validated documentId with cookie tokens to the backend", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { documentId: "doc-1" } });

        const response = await POST(createRequest());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ documentId: "doc-1" });
        expect(mockPost).toHaveBeenCalledWith(
            "/api/generate-staff-document",
            {
                documentId: "doc-1",
                accessToken: "access-token",
                refreshToken: "refresh-token",
                prefillEndDate: undefined,
            },
            { headers: { Authorization: "Bearer auth-token" } },
        );
    });

    it("does not expose raw backend error details", async () => {
        mockPost.mockResolvedValue({
            status: 502,
            data: {
                error: "document generator path /tmp/staff-document",
                code: "DOCUMENT_GENERATION_ERROR",
                diagnostics: { host: "generator.internal" },
            },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(502);
        await expect(response.json()).resolves.toEqual({
            error: "Failed to generate staff document",
            code: "DOCUMENT_GENERATION_ERROR",
        });

        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");
        expect(logged).not.toContain("/tmp/staff-document");
        expect(logged).not.toContain("generator.internal");
    });
});
