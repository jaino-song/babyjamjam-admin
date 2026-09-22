/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { DELETE, GET, PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockDelete = serverAPIClient.delete as jest.Mock;

function createRequest(method = "DELETE", body?: object): NextRequest {
    return new NextRequest("http://localhost/api/clients/75", {
        method,
        headers: {
            cookie: "auth_token=access-token",
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

describe("PATCH /api/clients/[id]", () => {
    beforeEach(() => {
        mockPatch.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("forwards an empty relink-only update", async () => {
        mockPatch.mockResolvedValue({ data: { id: 75 } });

        const response = await PATCH(createRequest("PATCH", {}), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: 75 });
        expect(mockPatch).toHaveBeenCalledWith(
            "/clients/75",
            {},
            { headers: { Authorization: "Bearer access-token" } },
        );
    });

    it("preserves the upstream status without logging or returning private details", async () => {
        const privateMessage = "private customer details";
        const privateToken = "Bearer private-token";
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockPatch.mockRejectedValue({
            response: {
                status: 404,
                data: {
                    code: "CLIENT_NOT_FOUND",
                    message: privateMessage,
                },
            },
            config: {
                headers: { Authorization: privateToken },
                data: privateMessage,
            },
        });

        const response = await PATCH(createRequest("PATCH", {}), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
            error: expect.stringMatching(/[가-힣].*요[.!]?$/),
            code: "CLIENT_NOT_FOUND",
        });
        const logged = JSON.stringify(consoleError.mock.calls);
        expect(logged).not.toContain(privateMessage);
        expect(logged).not.toContain(privateToken);
    });
});

describe("GET /api/clients/[id]", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("preserves a sanitized upstream not-found response", async () => {
        const privateMessage = "private database details";
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockGet.mockRejectedValue({
            response: {
                status: 404,
                data: {
                    code: "CLIENT_NOT_FOUND",
                    message: privateMessage,
                },
            },
            config: {
                headers: { Authorization: "Bearer private-token" },
            },
        });

        const response = await GET(createRequest("GET"), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({
            error: expect.stringMatching(/[가-힣].*요[.!]?$/),
            code: "CLIENT_NOT_FOUND",
        });
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateMessage);
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private-token");
    });

    it("rejects unauthenticated reads, updates, and deletes with a registered 401 problem", async () => {
        mockGet.mockReset();
        mockPatch.mockReset();
        mockDelete.mockReset();
        const unauthenticated = (method: string, body?: object) => new NextRequest(
            "http://localhost/api/clients/75",
            {
                method,
                headers: body ? { "content-type": "application/json" } : {},
                ...(body ? { body: JSON.stringify(body) } : {}),
            },
        );

        for (const [handler, method, body] of [
            [GET, "GET", undefined],
            [PATCH, "PATCH", {}],
            [DELETE, "DELETE", undefined],
        ] as const) {
            const response = await (handler as typeof DELETE)(
                unauthenticated(method, body),
                { params: Promise.resolve({ id: "75" }) },
            );

            expect(response.status).toBe(401);
            await expect(response.json()).resolves.toMatchObject({
                code: "AUTH_REQUIRED",
                status: 401,
            });
        }
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it("propagates a registered upstream problem body with its headers intact", async () => {
        const problem = createProblemDetails({
            code: "CLIENT_RETENTION_BLOCKED",
            requestId: "req-client-update",
            outcome: "NOT_APPLIED",
        });
        mockPatch.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await PATCH(createRequest("PATCH", {}), {
                params: Promise.resolve({ id: "75" }),
            });

            expect(response.status).toBe(409);
            const body = await response.json();
            expect(body).toMatchObject({
                code: "CLIENT_RETENTION_BLOCKED",
                status: 409,
                requestId: "req-client-update",
                outcome: "NOT_APPLIED",
            });
            expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});

describe("DELETE /api/clients/[id]", () => {
    beforeEach(() => {
        mockDelete.mockReset();
    });

    it("passes through the allowlisted safe detail for a coded delete conflict", async () => {
        mockDelete.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    error: "Conflict",
                    code: "CLIENT_RETENTION_BLOCKED",
                    message: "연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없습니다.",
                },
            },
        });

        const response = await DELETE(createRequest(), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "연결된 운영 또는 이력 데이터가 있어 고객을 삭제할 수 없습니다.",
            code: "CLIENT_RETENTION_BLOCKED",
        });
    });

    it("does not expose an unrecognized upstream conflict message", async () => {
        mockDelete.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    error: "Conflict",
                    message: "relation client_private_internal_fkey failed",
                },
            },
        });

        const response = await DELETE(createRequest(), {
            params: Promise.resolve({ id: "75" }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: "연결된 정보 때문에 고객을 삭제할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            code: "CLIENT_RETENTION_BLOCKED",
        });
    });
});
