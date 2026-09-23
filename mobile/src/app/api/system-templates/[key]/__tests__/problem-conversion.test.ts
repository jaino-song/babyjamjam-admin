/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getTemplate } from "../route";
import { POST as previewTemplate } from "../preview/route";
import { POST as validateTemplate } from "../validate/route";
import { POST as resetTemplate } from "../reset/route";
import { GET as listVersions } from "../versions/route";
import { GET as getVersion } from "../versions/[version]/route";
import { POST as rollbackTemplate } from "../rollback/[version]/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

function createRequest(
    path: string,
    method = "GET",
    cookie = "auth_token=auth-token",
    body?: BodyInit,
): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(cookie ? { cookie } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body,
    });
}

const keyParams = { params: Promise.resolve({ key: "GREETING" }) };
const versionParams = { params: Promise.resolve({ key: "GREETING", version: "2" }) };

async function expectAuthRequiredProblem(response: Response): Promise<void> {
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
        code: "AUTH_REQUIRED",
        status: 401,
        outcome: "NOT_APPLIED",
        error: "Unauthorized",
    }));
}

describe("system-template [key] BFF problem conversion (BJJ-319 6h3)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
        mockPut.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ["GET key", () => getTemplate(createRequest("/api/system-templates/GREETING", "GET", ""), keyParams)],
        ["GET versions", () => listVersions(createRequest("/api/system-templates/GREETING/versions", "GET", ""), keyParams)],
        ["GET version", () => getVersion(createRequest("/api/system-templates/GREETING/versions/2", "GET", ""), versionParams)],
        ["POST preview", () => previewTemplate(
            createRequest("/api/system-templates/GREETING/preview", "POST", "", JSON.stringify({ content: "Hi" })),
            keyParams,
        )],
        ["POST validate", () => validateTemplate(
            createRequest("/api/system-templates/GREETING/validate", "POST", "", JSON.stringify({ content: "Hi" })),
            keyParams,
        )],
        ["POST reset", () => resetTemplate(createRequest("/api/system-templates/GREETING/reset", "POST", ""), keyParams)],
        ["POST rollback", () => rollbackTemplate(createRequest("/api/system-templates/GREETING/rollback/2", "POST", ""), versionParams)],
    ])("returns an AUTH_REQUIRED problem for %s without contacting the backend", async (_name, act) => {
        const response = await act();

        await expectAuthRequiredProblem(response);
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
        expect(mockPut).not.toHaveBeenCalled();
    });

    it("keeps the versions GET success passthrough", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: [{ versionNumber: 2, createdAt: "2026-01-01", createdBy: "user-1" }],
        });

        const response = await listVersions(createRequest("/api/system-templates/GREETING/versions"), keyParams);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([
            { versionNumber: 2, createdAt: "2026-01-01", createdBy: "user-1" },
        ]);
    });

    it("sanitizes a rejected rollback upstream error with the status preserved", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: {
                    message: "Version is already current",
                    diagnostics: { authorization: "Bearer upstream-secret" },
                },
            },
        });

        const response = await rollbackTemplate(
            createRequest("/api/system-templates/GREETING/rollback/2", "POST"),
            versionParams,
        );

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(body.code).not.toBe("UPSTREAM_ERROR");
        expect(JSON.stringify(body)).not.toContain("upstream-secret");
    });

    it("sanitizes a resolved non-2xx template fetch with the status preserved", async () => {
        mockGet.mockResolvedValue({
            status: 404,
            data: { error: "template not found", query: "SELECT * FROM system_templates" },
        });

        const response = await getTemplate(createRequest("/api/system-templates/GREETING"), keyParams);

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(body.code).not.toBe("UPSTREAM_ERROR");
        expect(JSON.stringify(body)).not.toContain("SELECT * FROM system_templates");
    });

    it("forwards a registered upstream problem body verbatim through the [key] proxy", async () => {
        mockGet.mockResolvedValue({
            status: 422,
            data: {
                type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#validation-failed",
                title: "Validation failed",
                status: 422,
                detail: "입력 정보가 처리 조건에 맞지 않아요.",
                code: "VALIDATION_FAILED",
                requestId: "req-template-1",
                params: {},
            },
        });

        const response = await getTemplate(createRequest("/api/system-templates/GREETING"), keyParams);

        expect(response.status).toBe(422);
        expect(response.headers.get("content-type")).toContain("application/problem+json");
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 422, requestId: "req-template-1" });
    });
});
