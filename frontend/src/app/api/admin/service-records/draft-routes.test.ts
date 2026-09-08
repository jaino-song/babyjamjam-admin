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

function createRequest(
    path: string,
    method: string,
    body?: object | string | null,
    authenticated = true,
): NextRequest {
    const bodyValue = typeof body === "string"
        ? body
        : body === null
            ? "null"
            : body === undefined
                ? undefined
                : JSON.stringify(body);
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(bodyValue !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(bodyValue !== undefined ? { body: bodyValue } : {}),
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

    it.each([
        ["start", "{invalid", "start"],
        ["start", "42", "start"],
        ["start", "null", "start"],
        ["start", "[]", "start"],
        ["update", "{invalid", "update"],
        ["update", "42", "update"],
        ["update", "null", "update"],
        ["update", "[]", "update"],
        ["discard", "{invalid", "discard"],
        ["discard", "42", "discard"],
        ["discard", "null", "discard"],
        ["discard", "[]", "discard"],
    ])("rejects %s mutation body %s before any upstream mutation", async (operation, rawBody) => {
        const request = createRequest(
            operation === "start"
                ? "/api/admin/service-records/client/17/draft"
                : "/api/admin/service-records/drafts/draft-1",
            operation === "update" ? "PATCH" : "POST",
            rawBody,
        );
        const response = operation === "start"
            ? await startDraft(request, { params: Promise.resolve({ clientId: "17" }) })
            : operation === "update"
                ? await updateDraft(request, { params: Promise.resolve({ draftId: "draft-1" }) })
                : await discardDraft(
                    createRequest(
                        "/api/admin/service-records/drafts/draft-1/discard",
                        "POST",
                        rawBody,
                    ),
                    { params: Promise.resolve({ draftId: "draft-1" }) },
                );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "Invalid JSON body" });
        expect(mockPost).not.toHaveBeenCalled();
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("accepts an omitted optional start body as an empty object", async () => {
        mockPost.mockResolvedValue({ status: 201, data: { draft: { id: "draft-1" } } });

        const response = await startDraft(
            createRequest("/api/admin/service-records/client/17/draft", "POST"),
            { params: Promise.resolve({ clientId: "17" }) },
        );

        expect(response.status).toBe(201);
        expect(mockPost).toHaveBeenCalledWith(
            "/admin/service-records/client/17/draft",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
    });
});
