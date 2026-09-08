/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getDraft, POST as startDraft } from "./client/[clientId]/draft/route";
import { PATCH as updateDraft } from "./drafts/[draftId]/route";
import { POST as discardDraft } from "./drafts/[draftId]/discard/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;

function createRequest(path: string, method: string, body?: object, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

describe("service-record draft proxy routes", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
        mockPatch.mockReset();
    });

    it("requires authentication for draft reads and never calls upstream", async () => {
        const response = await getDraft(
            createRequest("/api/admin/service-records/client/17/draft", "GET", undefined, false),
            { params: Promise.resolve({ clientId: "17" }) },
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards encoded client ids for bodyless reads and resumes", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { draft: null } });
        mockPost.mockResolvedValue({ status: 201, data: { draft: { id: "draft-1" } } });

        const readResponse = await getDraft(
            createRequest("/api/admin/service-records/client/17%2F1/draft", "GET"),
            { params: Promise.resolve({ clientId: "17/1" }) },
        );
        const startResponse = await startDraft(
            createRequest("/api/admin/service-records/client/17%2F1/draft", "POST", {}),
            { params: Promise.resolve({ clientId: "17/1" }) },
        );

        expect(readResponse.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith(
            "/admin/service-records/client/17%2F1/draft",
            { headers: { Authorization: "Bearer token-1" } },
        );
        expect(startResponse.status).toBe(201);
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/client/17%2F1/draft",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("forwards CAS update and discard bodies without changing their authority", async () => {
        mockPatch.mockResolvedValue({ status: 200, data: { draft: { draftVersion: 2 } } });
        mockPost.mockResolvedValue({ status: 200, data: { draft: { status: "DISCARDED" } } });

        const updateResponse = await updateDraft(
            createRequest("/api/admin/service-records/drafts/draft%2F1", "PATCH", {
                expectedDraftVersion: 1,
                changes: { sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10" }] },
            }),
            { params: Promise.resolve({ draftId: "draft/1" }) },
        );
        const discardResponse = await discardDraft(
            createRequest("/api/admin/service-records/drafts/draft%2F1/discard", "POST", { expectedDraftVersion: 2 }),
            { params: Promise.resolve({ draftId: "draft/1" }) },
        );

        expect(updateResponse.status).toBe(200);
        expect(mockPatch).toHaveBeenCalledWith(
            "/admin/service-records/drafts/draft%2F1",
            { expectedDraftVersion: 1, changes: { sessions: [{ sessionIndex: 1, serviceDate: "2026-07-10" }] } },
            { headers: { Authorization: "Bearer token-1" } },
        );
        expect(discardResponse.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/drafts/draft%2F1/discard",
            { expectedDraftVersion: 2 },
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it.each([403, 404, 409])("preserves upstream status %s for CAS operations", async (status) => {
        mockPatch.mockRejectedValue({
            isAxiosError: true,
            response: { status, data: { code: `DRAFT_${status}` } },
        });

        const response = await updateDraft(
            createRequest("/api/admin/service-records/drafts/draft-1", "PATCH", {
                expectedDraftVersion: 1,
                changes: {},
            }),
            { params: Promise.resolve({ draftId: "draft-1" }) },
        );

        expect(response.status).toBe(status);
        await expect(response.json()).resolves.toEqual({ code: `DRAFT_${status}` });
    });
});
