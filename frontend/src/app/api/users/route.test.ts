/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/users", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/users"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body instead of a raw passthrough", async () => {
        const problem = createProblemDetails({
            code: "REQUEST_INVALID",
            requestId: "req-users-1",
            outcome: "NOT_APPLIED",
        });
        mockGet.mockResolvedValue({ status: 400, data: problem });

        const response = await GET(
            new NextRequest("http://localhost/api/users", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_INVALID", status: 400, requestId: "req-users-1" });
        expect(response.headers.get("content-type")).toContain("application/problem+json");
    });

    it("sanitizes a resolved legacy upstream failure body", async () => {
        mockGet.mockResolvedValue({
            status: 500,
            data: { message: "select * failed on internal table" },
        });

        const response = await GET(
            new NextRequest("http://localhost/api/users", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("internal table");
        expect(JSON.stringify(body)).not.toContain("Failed to fetch users");
    });
});
