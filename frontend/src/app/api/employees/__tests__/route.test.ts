/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    DELETE as deleteEmployeeProxy,
    GET as listEmployees,
    PATCH as updateEmployeeProxy,
    POST as createEmployee,
} from "../route";
import { GET as checkEmployeePhone } from "../check-phone/route";
import { PATCH as updateOpenStatus } from "../open-status/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        delete: jest.fn(),
        get: jest.fn(),
        patch: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockDelete = serverAPIClient.delete as jest.Mock;

// 승인된 계약: 업스트림 실패는 공유 sanitizer를 통과하며 실패가
// `exists: false`(200) 같은 성공 응답으로 위장되지 않는다.
async function expectSanitizedUpstreamFailure(
    response: Response,
    expectedStatus: number,
): Promise<{ error?: unknown }> {
    expect(response.status).toBe(expectedStatus);
    const body = await response.json();
    expect(body).not.toEqual({ exists: false });
    expect(body.error).toBeTruthy();
    return body;
}

function createRequest(
    path: string,
    init: { method?: string; body?: BodyInit; headers?: Record<string, string>; cookie?: string } = {},
): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: init.method,
        headers: {
            ...(init.cookie === undefined ? { cookie: "auth_token=auth-token" } : {}),
            ...init.headers,
        },
        body: init.body,
    });
}

describe("GET /api/employees", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("rejects a missing auth token with the shared 401 response",
        async () => {
            const response = await listEmployees(createRequest("/api/employees", { cookie: "" }));

            expect(response.status).toBe(401);
            await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
            expect(mockGet).not.toHaveBeenCalled();
        });

    it("maps an upstream list failure through the shared sanitizer with the status preserved",
        async () => {
            mockGet.mockRejectedValue({
                response: {
                    status: 403,
                    data: { error: "employee access denied" },
                },
            });

            const response = await listEmployees(createRequest("/api/employees"));

            const body = await expectSanitizedUpstreamFailure(response, 403);
            expect(body.error).toMatch(/[가-힣]/);
        });
});

describe("POST /api/employees", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("maps an upstream mutation failure through the shared sanitizer without masking",
        async () => {
            mockPost.mockRejectedValue({
                response: {
                    status: 400,
                    data: {
                        message: "전화번호 형식이 올바르지 않습니다.",
                        error: "Bad Request",
                    },
                },
            });

            const response = await createEmployee(
                createRequest("/api/employees", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "Kim" }),
                }),
            );

            expect(response.status).toBe(400);
            const body = await response.json();
            expect(body.error).toMatch(/[가-힣]/);
        });
});

describe("GET /api/employees/check-phone", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("keeps a missing phone a valid negative answer", async () => {
        const response = await checkEmployeePhone(createRequest("/api/employees/check-phone"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ exists: false });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("keeps a malformed phone a valid negative answer before proxying", async () => {
        const response = await checkEmployeePhone(
            createRequest("/api/employees/check-phone?phone=010"),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ exists: false });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("must NOT mask an upstream failure as a negative answer", async () => {
        mockGet.mockRejectedValue({
            response: {
                status: 500,
                data: { error: "upstream boom" },
            },
        });

        const response = await checkEmployeePhone(
            createRequest("/api/employees/check-phone?phone=01096411878"),
        );

        await expectSanitizedUpstreamFailure(response, 500);
    });
});

describe("PATCH/DELETE /api/employees", () => {
    beforeEach(() => {
        mockPatch.mockReset();
        mockDelete.mockReset();
    });

    // 인증 토큰 게이트가 id 검증보다 앞선다 — 인증 없는 요청은 id가
    // 유효하지 않아도 401로 먼저 잘라낸다.
    it("checks the auth token before the id-validation gate", async () => {
        const response = await updateEmployeeProxy(
            createRequest("/api/employees?id=0", {
                method: "PATCH",
                cookie: "",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "김관리" }),
            }),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("rejects invalid employee ids before proxying", async () => {
        for (const id of ["0", "abc"]) {
            const patchResponse = await updateEmployeeProxy(
                createRequest(`/api/employees?id=${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: "김관리" }),
                }),
            );
            expect(patchResponse.status).toBe(400);
            await expect(patchResponse.json()).resolves.toEqual({ error: "Invalid employee id" });

            const deleteResponse = await deleteEmployeeProxy(
                createRequest(`/api/employees?id=${id}`, { method: "DELETE" }),
            );
            expect(deleteResponse.status).toBe(400);
            await expect(deleteResponse.json()).resolves.toEqual({ error: "Invalid employee id" });
        }

        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });
});

describe("PATCH /api/employees/open-status", () => {
    beforeEach(() => {
        mockPatch.mockReset();
    });

    it("rejects a body missing openToNextWork before proxying", async () => {
        const response = await updateOpenStatus(
            createRequest("/api/employees/open-status?id=10", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            }),
        );

        expect(response.status).toBe(400);
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("maps an upstream failure through the shared sanitizer with the status preserved", async () => {
        mockPatch.mockRejectedValue({
            response: {
                status: 403,
                data: { error: "employee access denied" },
            },
        });

        const response = await updateOpenStatus(
            createRequest("/api/employees/open-status?id=10", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ openToNextWork: true }),
            }),
        );

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.error).toBeTruthy();
        expect(body).not.toEqual({ error: "employee access denied" });
    });
});
