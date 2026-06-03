/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as rollbackTemplate } from "../[key]/rollback/[version]/route";
import { POST as validateTemplate } from "../[key]/validate/route";
import { GET as getTemplateVersions } from "../[key]/versions/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const expectedAuthorization = `Bearer ${"token-1"}`;

function createRequest(path: string, method = "GET", cookie?: string, body?: BodyInit): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(cookie ? { cookie } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body,
    });
}

describe("system-template nested API routes", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("requires auth before proxying nested system-template routes", async () => {
        const response = await getTemplateVersions(
            createRequest("/api/system-templates/GREETING/versions"),
            { params: Promise.resolve({ key: "GREETING" }) },
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({
            error: "Authentication required. Please log in.",
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("proxies version history requests to the backend path", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: [{ versionNumber: 2, createdAt: "2026-01-01", createdBy: "user-1" }],
        });

        const response = await getTemplateVersions(
            createRequest("/api/system-templates/GREETING/versions", "GET", "auth_token=token-1"),
            { params: Promise.resolve({ key: "GREETING" }) },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([
            { versionNumber: 2, createdAt: "2026-01-01", createdBy: "user-1" },
        ]);
        expect(mockGet).toHaveBeenCalledWith("/system-templates/GREETING/versions", {
            headers: { Authorization: expectedAuthorization },
        });
    });

    it("proxies rollback requests and sanitizes backend failure payload", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { message: "Version is already current" },
            },
        });

        const response = await rollbackTemplate(
            createRequest("/api/system-templates/GREETING/rollback/2", "POST", "auth_token=token-1"),
            { params: Promise.resolve({ key: "GREETING", version: "2" }) },
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: "Failed to rollback system template" });
        expect(mockPost).toHaveBeenCalledWith(
            "/system-templates/GREETING/rollback/2",
            {},
            { headers: { Authorization: expectedAuthorization } },
        );
    });

    it("rejects malformed template action JSON before proxying", async () => {
        const response = await validateTemplate(
            createRequest(
                "/api/system-templates/GREETING/validate",
                "POST",
                "auth_token=token-1",
                "{bad-json",
            ),
            { params: Promise.resolve({ key: "GREETING" }) },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "Request body must be valid JSON",
        });
        expect(mockPost).not.toHaveBeenCalled();
    });
});
