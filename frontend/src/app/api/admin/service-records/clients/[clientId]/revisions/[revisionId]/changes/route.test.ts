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

function createRequest(authenticated = true): NextRequest {
    return new NextRequest(
        "http://localhost/api/admin/service-records/clients/42/revisions/rev-1/changes",
        { method: "GET", headers: authenticated ? { cookie: "auth_token=access-token" } : {} },
    );
}

const params = (clientId: string, revisionId: string) => ({ params: Promise.resolve({ clientId, revisionId }) });

describe("GET /api/admin/service-records/clients/:clientId/revisions/:revisionId/changes", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated request with a registered 401 problem body", async () => {
        const response = await GET(createRequest(false), params("42", "rev-1"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards to the exact backend path with the bearer token and returns the body uncached", async () => {
        const payload = { revisionId: "rev-1", beforeAvailable: true, basicInfo: [], sessions: [] };
        mockGet.mockResolvedValue({ status: 200, data: payload });

        const response = await GET(createRequest(), params("42", "rev-1"));

        expect(mockGet).toHaveBeenCalledWith(
            "/admin/service-records/clients/42/revisions/rev-1/changes",
            { headers: { Authorization: "Bearer access-token" } },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        await expect(response.json()).resolves.toEqual(payload);
    });

    it("encodes both ids so a crafted id cannot change the backend path", async () => {
        mockGet.mockResolvedValue({ status: 200, data: {} });

        await GET(createRequest(), params("4/2", "../rev?x=1#y"));

        expect(mockGet).toHaveBeenCalledWith(
            "/admin/service-records/clients/4%2F2/revisions/..%2Frev%3Fx%3D1%23y/changes",
            expect.anything(),
        );
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "RESOURCE_NOT_FOUND",
            requestId: "req-revision-changes",
            outcome: "NOT_APPLIED",
        });
        mockGet.mockRejectedValue({
            response: {
                status: 404,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });

        const response = await GET(createRequest(), params("42", "missing"));

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
    });
});
