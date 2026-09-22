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
    const formData = new FormData();
    formData.append("image", new File(["image"], "prices.png", { type: "image/png" }));

    return new NextRequest("http://localhost/api/voucher-price-infos/parse-image", {
        method: "POST",
        headers: {
            cookie: "auth_token=auth-token",
        },
        body: formData,
    });
}

describe("POST /api/voucher-price-infos/parse-image", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("requires auth before parsing a voucher image", async () => {
        const request = new NextRequest("http://localhost/api/voucher-price-infos/parse-image", {
            method: "POST",
        });

        const response = await POST(request);

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
            error: "Unauthorized",
        }));
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards multipart uploads without overriding the form-data boundary", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { parsedData: [], hasValidationWarnings: false, warnings: [] },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith(
            "/voucher-price-infos/parse-image",
            expect.any(FormData),
            {
                headers: {
                    Authorization: "Bearer auth-token",
                },
                timeout: 120000,
            },
        );
    });

    it("preserves backend status and payload", async () => {
        mockPost.mockResolvedValue({
            status: 422,
            data: { error: "이미지를 파싱할 수 없습니다" },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual({
            error: "이미지를 파싱할 수 없습니다",
        });
    });

    it("does not return or log raw rejected backend parse errors", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 422,
                data: {
                    error: "internal parser path /tmp/voucher-prices",
                },
            },
        });

        const response = await POST(createRequest());

        expect(response.status).toBe(422);
        const body = await response.json();
        // The sanitized Korean fallback replaces the raw upstream error copy; the
        // internal path must never leak into the body or the log.
        expect(body.error).toEqual(expect.stringMatching(/[가-힣].*요[.!]?$/));
        expect(JSON.stringify(body)).not.toContain("/tmp/voucher-prices");
        const logged = consoleErrorSpy.mock.calls
            .flat()
            .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
            .join(" ");
        expect(logged).not.toContain("/tmp/voucher-prices");
    });
});
