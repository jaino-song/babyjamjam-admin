/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createCreateRequest(body: object): NextRequest {
    return new NextRequest("http://localhost/api/clients", {
        method: "POST",
        headers: {
            cookie: "auth_token=access-token",
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

const createBody = {
    name: "Baby Kim",
    careCenter: false,
    voucherClient: true,
    breastPump: false,
};

describe("POST /api/clients", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("passes a converted duplicate-phone problem body through with its code intact", async () => {
        const problem = createProblemDetails({
            code: "CLIENT_PHONE_ALREADY_REGISTERED",
            requestId: "req-duplicate-phone",
            outcome: "NOT_APPLIED",
            errors: [{
                pointer: "/phone",
                code: "INVALID_VALUE",
                detail: "같은 전화번호의 고객이 이미 등록되어 있습니다.",
                location: "body",
            }],
        });
        // 백엔드 경계는 구버전 호환으로 message/error를 실어 보낸다.
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await POST(createCreateRequest(createBody));

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toEqual(expect.objectContaining({
            code: "CLIENT_PHONE_ALREADY_REGISTERED",
            status: 409,
            requestId: "req-duplicate-phone",
            outcome: "NOT_APPLIED",
        }));
    });

    it("keeps the legacy clientId conflict bridge for unconverted upstream payloads", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    message: "이미 같은 전화번호의 고객이 있습니다.",
                    clientId: 73,
                },
            },
        });

        const response = await POST(createCreateRequest(createBody));

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            message: "이미 같은 전화번호의 고객이 있어요.",
            clientId: 73,
        });
    });
});
