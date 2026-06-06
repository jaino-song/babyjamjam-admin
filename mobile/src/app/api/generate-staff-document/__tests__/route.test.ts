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

function createRequest(): NextRequest {
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
        body: JSON.stringify({ documentId: "doc-1" }),
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
