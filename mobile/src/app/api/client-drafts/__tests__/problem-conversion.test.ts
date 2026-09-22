/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { NO_STORE_CACHE_CONTROL } from "@babyjamjam/shared/api";

import { GET as countDrafts } from "../count/route";
import { GET as listDrafts } from "../route";
import { GET as getDraft, PATCH as patchDraft } from "../[id]/route";
import { POST as confirmDraft } from "../[id]/confirm/route";
import { POST as discardDraft } from "../[id]/discard/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        patch: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function authedRequest(path: string, init: { method?: string; body?: string } = {}): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: init.method ?? "GET",
        headers: {
            cookie: "auth_token=auth-token",
            ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
    });
}

function anonymousRequest(path: string, method = "GET"): NextRequest {
    return new NextRequest(`http://localhost${path}`, { method });
}

const idParams = { params: Promise.resolve({ id: "draft-1" }) };

async function expectAuthRequiredProblem(response: Response): Promise<void> {
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(response.headers.get("Content-Language")).toBe("ko-KR");
    expect(response.headers.get("Cache-Control")).toBe(NO_STORE_CACHE_CONTROL);
    const requestId = response.headers.get("X-Request-Id");
    expect(requestId).toEqual(expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/));
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
        code: "AUTH_REQUIRED",
        status: 401,
        outcome: "NOT_APPLIED",
        error: "Unauthorized",
        requestId,
    }));
}

describe("client-drafts BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPatch.mockReset();
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ["list", () => listDrafts(anonymousRequest("/api/client-drafts"))],
        ["count", () => countDrafts(anonymousRequest("/api/client-drafts/count"))],
        ["detail GET", () => getDraft(anonymousRequest("/api/client-drafts/draft-1"), idParams)],
        ["detail PATCH", () => patchDraft(anonymousRequest("/api/client-drafts/draft-1", "PATCH"), idParams)],
        ["confirm", () => confirmDraft(anonymousRequest("/api/client-drafts/draft-1/confirm", "POST"), idParams)],
        ["discard", () => discardDraft(anonymousRequest("/api/client-drafts/draft-1/discard", "POST"), idParams)],
    ])("returns an AUTH_REQUIRED problem for %s without contacting the backend", async (_name, act) => {
        const response = await act();

        await expectAuthRequiredProblem(response);
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("keeps the success passthrough for the draft list", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { items: [] } });

        const response = await listDrafts(authedRequest("/api/client-drafts"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ items: [] });
    });

    it("preserves a backend conflict on confirm through the shared problem boundary", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { message: "이미 확정된 초안이에요.", diagnostics: { secret: "upstream-secret" } },
            },
        });

        const response = await confirmDraft(
            authedRequest("/api/client-drafts/draft-1/confirm", {
                method: "POST",
                body: JSON.stringify({ fields: { name: "n", careCenter: false, voucherClient: false, breastPump: false } }),
            }),
            idParams,
        );

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("upstream-secret");
        expect(body.error).toMatch(/[가-힣]/);
    });
});
