/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getServiceRecords } from "../../admin/service-records/client/[clientId]/route";
import { GET as getClients, POST as createClient } from "../route";
import { DELETE as deleteClient, GET as getClient, PATCH as updateClient } from "../[id]/route";
import { PATCH as completeReplacement } from "../[id]/complete-replacement/route";
import { PATCH as requestReplacement } from "../[id]/request-replacement/route";
import { PATCH as terminateClient } from "../[id]/terminate/route";
import { GET as analytics } from "../analytics/route";
import { GET as checkPhone } from "../check-phone/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        delete: jest.fn(),
        get: jest.fn(),
        patch: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockDelete = serverAPIClient.delete as jest.Mock;

function request(path: string, init: { method?: string; cookie?: boolean; body?: string } = {}): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: init.method ?? "GET",
        headers: {
            ...(init.cookie === false ? {} : { cookie: "auth_token=auth-token" }),
            ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
    });
}

const clientParams = { params: Promise.resolve({ id: "12" }) };
const serviceRecordsParams = { params: Promise.resolve({ clientId: "12" }) };

async function expectAuthRequiredProblem(response: Response): Promise<void> {
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(response.headers.get("Content-Language")).toBe("ko-KR");
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
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

describe("clients BFF problem conversion (BJJ-319 6.1e)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPatch.mockReset();
        mockPost.mockReset();
        mockDelete.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ["list GET", () => getClients(request("/api/clients", { cookie: false }))],
        ["create POST", () => createClient(request("/api/clients", { method: "POST", cookie: false, body: "{}" }))],
        ["detail GET", () => getClient(request("/api/clients/12", { cookie: false }), clientParams)],
        ["update PATCH", () => updateClient(request("/api/clients/12", { method: "PATCH", cookie: false, body: "{}" }), clientParams)],
        ["delete DELETE", () => deleteClient(request("/api/clients/12", { method: "DELETE", cookie: false }), clientParams)],
        ["terminate PATCH", () => terminateClient(request("/api/clients/12/terminate", { method: "PATCH", cookie: false, body: "{}" }), clientParams)],
        ["request-replacement PATCH", () => requestReplacement(request("/api/clients/12/request-replacement", { method: "PATCH", cookie: false, body: "{}" }), clientParams)],
        ["complete-replacement PATCH", () => completeReplacement(request("/api/clients/12/complete-replacement", { method: "PATCH", cookie: false, body: "{}" }), clientParams)],
        ["check-phone GET", () => checkPhone(request("/api/clients/check-phone?phone=01012345678", { cookie: false }))],
        ["analytics GET", () => analytics(request("/api/clients/analytics", { cookie: false }))],
        ["service-records GET", () => getServiceRecords(request("/api/admin/service-records/client/12", { cookie: false }), serviceRecordsParams)],
    ])("returns an AUTH_REQUIRED problem for %s without a token", async (_name, act) => {
        await expectAuthRequiredProblem(await act());

        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it.each([
        ["detail GET", () => getClient(request("/api/clients/bad id"), { params: Promise.resolve({ id: "bad id" }) })],
        ["update PATCH", () => updateClient(request("/api/clients/0", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: "0" }) })],
        ["delete DELETE", () => deleteClient(request("/api/clients/1.5", { method: "DELETE" }), { params: Promise.resolve({ id: "1.5" }) })],
        ["terminate PATCH", () => terminateClient(request("/api/clients/x", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: "x" }) })],
        ["request-replacement PATCH", () => requestReplacement(request("/api/clients/x/request-replacement", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: "x" }) })],
        ["complete-replacement PATCH", () => completeReplacement(request("/api/clients/x/complete-replacement", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ id: "x" }) })],
    ])("rejects a malformed client id for %s with a VALIDATION_FAILED path problem", async (_name, act) => {
        const response = await act();

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Invalid client id",
            errors: [{ pointer: "/id", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" }],
        }));
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it("rejects a malformed service-records client id with a VALIDATION_FAILED path problem", async () => {
        const response = await getServiceRecords(
            request("/api/admin/service-records/client/abc"),
            { params: Promise.resolve({ clientId: "abc" }) },
        );

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Invalid client id",
            errors: [{ pointer: "/clientId", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" }],
        }));
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("sanitizes a list GET upstream rejection with the status preserved", async () => {
        mockGet.mockRejectedValue({
            response: {
                status: 403,
                data: { error: "Bearer upstream-secret", message: "member@example.com" },
            },
        });

        const response = await getClients(request("/api/clients"));

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(body.code).not.toBe("UPSTREAM_ERROR");
        expect(JSON.stringify(body)).not.toContain("upstream-secret");
        expect(JSON.stringify(body)).not.toContain("member@example.com");
    });

    it("forwards a registered upstream problem body verbatim on detail GET", async () => {
        mockGet.mockRejectedValue({
            response: {
                status: 422,
                data: {
                    type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#validation-failed",
                    title: "Validation failed",
                    status: 422,
                    detail: "입력 정보가 처리 조건에 맞지 않아요.",
                    code: "VALIDATION_FAILED",
                    requestId: "req-client-12",
                    params: {},
                },
            },
        });

        const response = await getClient(request("/api/clients/12"), clientParams);

        expect(response.status).toBe(422);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 422, requestId: "req-client-12" });
    });

    it("sanitizes a terminate PATCH upstream rejection with the status preserved", async () => {
        mockPatch.mockRejectedValue({
            response: {
                status: 409,
                data: { message: "SELECT * FROM Client WHERE id = 12" },
            },
        });

        const response = await terminateClient(
            request("/api/clients/12/terminate", { method: "PATCH", body: JSON.stringify({ reason: "moved" }) }),
            clientParams,
        );

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(body.code).not.toBe("UPSTREAM_ERROR");
        expect(JSON.stringify(body)).not.toContain("SELECT * FROM Client");
    });

    it("keeps the service-records success passthrough", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { items: [] } });

        const response = await getServiceRecords(
            request("/api/admin/service-records/client/12"),
            serviceRecordsParams,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
        await expect(response.json()).resolves.toEqual({ items: [] });
    });

    it("sanitizes an analytics fetch failure with the status preserved", async () => {
        mockGet.mockRejectedValue({
            response: {
                status: 502,
                data: { message: "database host analytics.internal returned /tmp/clients" },
            },
        });

        const response = await analytics(request("/api/clients/analytics"));

        expect(response.status).toBe(502);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(JSON.stringify(body)).not.toContain("analytics.internal");
        expect(JSON.stringify(body)).not.toContain("/tmp/clients");
    });

    it("keeps the check-phone degraded contract without leaking backend details", async () => {
        mockGet.mockRejectedValue(new Error("backend unavailable"));

        const response = await checkPhone(request("/api/clients/check-phone?phone=01012345678"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ exists: false });
    });

    it("keeps the check-phone success shape", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: { data: [{ phone: "010-1234-5678" }], total: 1, page: 1, limit: 500 },
        });

        const response = await checkPhone(request("/api/clients/check-phone?phone=01012345678"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ exists: true });
    });
});
