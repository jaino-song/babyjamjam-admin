/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getFeedbackTemplateId } from "../feedback-template-id/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function request(authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/eformsign-docs/feedback-template-id", {
        headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
    });
}

describe("eformsign feedback-template-id BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("returns an AUTH_REQUIRED problem without a token", async () => {
        const response = await getFeedbackTemplateId(request(false));

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
        }));
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("stops authoring an English fallback for an upstream error status", async () => {
        mockGet.mockResolvedValue({
            status: 404,
            data: { message: "raw upstream detail" },
        });

        const response = await getFeedbackTemplateId(request());

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(body)).not.toContain("Backend returned");
        expect(JSON.stringify(body)).not.toContain("raw upstream detail");
    });

    it("keeps the success passthrough", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { templateId: "tpl-1" } });

        const response = await getFeedbackTemplateId(request());

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ templateId: "tpl-1" });
    });
});
