/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(path: string, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        headers: authenticated ? { cookie: "auth_token=token-1" } : undefined,
    });
}

describe("GET /api/message-trigger-jobs/client/[clientId]/upcoming", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("requires authentication before forwarding", async () => {
        const response = await GET(
            createRequest("/api/message-trigger-jobs/client/42/upcoming", false),
            { params: Promise.resolve({ clientId: "42" }) },
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards the client id and opaque pagination params with the bearer token", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                items: [
                    {
                        id: "job-1",
                        ruleName: "모니터링 설문",
                        templateKey: "SURVEY",
                        scheduledFor: "2026-09-29T06:00:00.000Z",
                        nextAttemptAt: null,
                        effectiveDueAt: "2026-09-29T06:00:00.000Z",
                        status: "pending",
                        recipientType: "CLIENT",
                        recipientName: "고객",
                    },
                ],
                nextCursor: "opaque-next",
            },
        });

        const response = await GET(
            createRequest("/api/message-trigger-jobs/client/42/upcoming?limit=50&cursor=opaque-current"),
            { params: Promise.resolve({ clientId: "42" }) },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await expect(response.json()).resolves.toMatchObject({ nextCursor: "opaque-next" });
        expect(mockGet).toHaveBeenCalledWith(
            "/message-trigger-jobs/client/42/upcoming",
            {
                headers: { Authorization: "Bearer token-1" },
                params: { limit: "50", cursor: "opaque-current" },
            },
        );
    });

    it("encodes a client id before forwarding", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { items: [], nextCursor: null } });

        await GET(
            createRequest("/api/message-trigger-jobs/client/42%2Flegacy/upcoming"),
            { params: Promise.resolve({ clientId: "42/legacy" }) },
        );

        expect(mockGet).toHaveBeenCalledWith(
            "/message-trigger-jobs/client/42%2Flegacy/upcoming",
            expect.anything(),
        );
    });
});
