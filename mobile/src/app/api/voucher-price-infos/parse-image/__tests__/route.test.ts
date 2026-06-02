/**
 * @jest-environment node
 */
import { jwtDecode } from "jwt-decode";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("jwt-decode", () => ({
    jwtDecode: jest.fn(),
}));

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockJwtDecode = jwtDecode as jest.Mock;
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
    beforeEach(() => {
        mockJwtDecode.mockReset();
        mockPost.mockReset();
    });

    it("forwards multipart uploads without overriding the form-data boundary", async () => {
        mockJwtDecode.mockReturnValue({ role: "owner" });
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
        mockJwtDecode.mockReturnValue({ role: "owner" });
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
});
