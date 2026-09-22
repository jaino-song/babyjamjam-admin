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

function uploadRequest(file: File | null, authenticated = true): NextRequest {
    const formData = new FormData();
    if (file) {
        formData.append("image", file);
    }

    return new NextRequest("http://localhost/api/voucher-price-infos/parse-image", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
        body: formData,
    });
}

describe("POST /api/voucher-price-infos/parse-image", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated parse with a registered 401 problem body", async () => {
        const response = await POST(
            uploadRequest(new File(["img"], "price.png", { type: "image/png" }), false),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("answers a missing image with a structured VALIDATION_FAILED problem", async () => {
        const response = await POST(uploadRequest(null));

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
        expect(JSON.stringify(body)).toContain("/image");
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure instead of a raw data passthrough", async () => {
        mockPost.mockRejectedValue({
            response: { status: 502, data: { message: "gemini gateway exploded at ai-1.internal" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(
            uploadRequest(new File(["img"], "price.png", { type: "image/png" })),
        );

        expect(response.status).toBe(502);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("ai-1.internal");
        expect(JSON.stringify(body)).not.toContain("파싱 실패");
        consoleErrorSpy.mockRestore();
    });

    it("answers a transport failure with the sanitized 500 problem contract", async () => {
        mockPost.mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.8:443"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(
            uploadRequest(new File(["img"], "price.png", { type: "image/png" })),
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body).toMatchObject({ code: "INTERNAL_ERROR", status: 500 });
        expect(JSON.stringify(body)).not.toContain("10.0.0.8");
        consoleErrorSpy.mockRestore();
    });
});
