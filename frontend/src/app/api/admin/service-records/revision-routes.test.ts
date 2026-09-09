/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getRevisionHistory } from "./clients/[clientId]/revisions/route";
import { POST as retryRevisionDocument } from "./revisions/[revisionId]/documents/[documentStateId]/retry/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function request(path: string, method: string, body?: unknown, authenticated = true): NextRequest {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(serialized !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(serialized !== undefined ? { body: serialized } : {}),
    });
}

describe("service-record revision proxy routes", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("requires authentication for history reads", async () => {
        const response = await getRevisionHistory(
            request("/api/admin/service-records/clients/42/revisions", "GET", undefined, false),
            { params: Promise.resolve({ clientId: "42" }) },
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards encoded client ids and preserves an upstream history response", async () => {
        const payload = { caseId: "case-1", revisions: [] };
        mockGet.mockResolvedValue({ status: 200, data: payload });

        const response = await getRevisionHistory(
            request("/api/admin/service-records/clients/client%2F1/revisions", "GET"),
            { params: Promise.resolve({ clientId: "client/1" }) },
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(payload);
        expect(mockGet).toHaveBeenCalledWith(
            "/admin/service-records/clients/client%2F1/revisions",
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("accepts exactly expectedGeneration and rejects forged retry fields", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { id: "state-1" } });

        const response = await retryRevisionDocument(
            request(
                "/api/admin/service-records/revisions/rev%2F1/documents/state%2F1/retry",
                "POST",
                { expectedGeneration: "generation-1" },
            ),
            { params: Promise.resolve({ revisionId: "rev/1", documentStateId: "state/1" }) },
        );

        expect(response.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/revisions/rev%2F1/documents/state%2F1/retry",
            { expectedGeneration: "generation-1" },
            { headers: { Authorization: "Bearer token-1" } },
        );

        const forged = await retryRevisionDocument(
            request(
                "/api/admin/service-records/revisions/rev-1/documents/state-1/retry",
                "POST",
                { expectedGeneration: "generation-1", branchId: "forged" },
            ),
            { params: Promise.resolve({ revisionId: "rev-1", documentStateId: "state-1" }) },
        );
        expect(forged.status).toBe(400);
        expect(mockPost).toHaveBeenCalledTimes(1);
    });

    it.each([403, 404, 409])("preserves upstream retry status %s", async (status) => {
        mockPost.mockRejectedValue({
            isAxiosError: true,
            response: { status, data: { code: `REVISION_${status}` } },
        });

        const response = await retryRevisionDocument(
            request(
                "/api/admin/service-records/revisions/rev-1/documents/state-1/retry",
                "POST",
                { expectedGeneration: "generation-1" },
            ),
            { params: Promise.resolve({ revisionId: "rev-1", documentStateId: "state-1" }) },
        );

        expect(response.status).toBe(status);
        await expect(response.json()).resolves.toEqual({ code: `REVISION_${status}` });
    });
});
