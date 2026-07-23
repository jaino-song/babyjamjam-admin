/**
 * @jest-environment node
 */
import { AxiosError, AxiosHeaders } from "axios";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(authenticated = true) {
    return new NextRequest("http://localhost/api/message-logs/77/retry", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

describe("POST /api/message-logs/[id]/retry", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("forwards the authenticated retry to the backend", async () => {
        mockPost.mockResolvedValue({
            status: 201,
            data: { id: 77, status: "pending", templateKey: "service_record_link_sms" },
        });

        const response = await POST(createRequest(), {
            params: Promise.resolve({ id: "77" }),
        });

        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ id: 77, status: "pending" });
        expect(mockPost).toHaveBeenCalledWith(
            "/message-logs/77/retry",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("preserves a backend conflict response", async () => {
        mockPost.mockRejectedValue(
            new AxiosError("Conflict", "ERR_BAD_RESPONSE", undefined, undefined, {
                status: 409,
                statusText: "Conflict",
                headers: {},
                config: { headers: new AxiosHeaders() },
                data: { message: "이미 재발송이 진행 중입니다." },
            }),
        );

        const response = await POST(createRequest(), {
            params: Promise.resolve({ id: "77" }),
        });

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ message: "이미 재발송이 진행 중입니다." });
    });

    it("requires authentication before forwarding", async () => {
        const response = await POST(createRequest(false), {
            params: Promise.resolve({ id: "77" }),
        });

        expect(response.status).toBe(401);
        expect(mockPost).not.toHaveBeenCalled();
    });
});
