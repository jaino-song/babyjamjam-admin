/**
 * @jest-environment node
 */
import { AxiosError, AxiosHeaders } from "axios";
import { createProblemDetails } from "@babyjamjam/shared";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;
const context = { params: Promise.resolve({ documentId: "doc-1" }) };

function createRequest(authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/eformsign/documents/doc-1/void", {
        method: "POST",
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

function upstreamError(status: number, data: unknown): AxiosError {
    return new AxiosError("upstream", "ERR_BAD_RESPONSE", undefined, undefined, {
        status,
        statusText: String(status),
        headers: {},
        config: { headers: new AxiosHeaders() },
        data,
    });
}

describe("POST /api/eformsign/documents/[documentId]/void", () => {
    beforeEach(() => {
        mockPost.mockReset();
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("forwards the request to the backend void endpoint with an empty body", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: {
                documentId: "doc-1",
                voidedAt: "2026-10-13T01:02:03.000Z",
                voidedByName: "김지원",
                displayStatus: "voided",
            },
        });

        const response = await POST(createRequest(), context);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            documentId: "doc-1",
            voidedAt: "2026-10-13T01:02:03.000Z",
            voidedByName: "김지원",
            displayStatus: "voided",
        });
        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(mockPost).toHaveBeenCalledWith(
            "/api/documents/doc-1/void",
            {},
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it("url-encodes the document id in the backend path", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { documentId: "a/b" } });

        await POST(createRequest(), { params: Promise.resolve({ documentId: "a/b" }) });

        expect(mockPost.mock.calls[0][0]).toBe("/api/documents/a%2Fb/void");
    });

    it("passes a 409 conflict through with its status and a problem body", async () => {
        mockPost.mockRejectedValue(
            upstreamError(
                409,
                createProblemDetails({
                    code: "REQUEST_CONFLICT",
                    requestId: "req-1",
                    outcome: "NOT_APPLIED",
                }),
            ),
        );

        const response = await POST(createRequest(), context);

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body).toMatchObject({ code: "REQUEST_CONFLICT", status: 409 });
        expect(typeof body.error).toBe("string");
    });

    it("keeps the upstream status for a 500 so the card treats the outcome as uncertain", async () => {
        mockPost.mockRejectedValue(upstreamError(500, { message: "internal detail" }));

        const response = await POST(createRequest(), context);

        expect(response.status).toBe(500);
        expect(JSON.stringify(await response.json())).not.toContain("internal detail");
    });

    it("requires authentication before contacting the backend", async () => {
        const response = await POST(createRequest(false), context);

        expect(response.status).toBe(401);
        expect(mockPost).not.toHaveBeenCalled();
    });
});
