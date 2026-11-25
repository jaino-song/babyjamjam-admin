/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: unknown, versions: string[] = []): NextRequest {
    return new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        headers: [["content-type", "application/json"], ...versions.map((value): [string, string] => ["x-account-link-version", value])],
        body: JSON.stringify(body),
    });
}

const validBody = {
    email: "user@example.com",
    password: "Password1!",
    name: "Hong Gildong",
    phone: "010-1234-5678",
    birthDate: "1990-01-01",
};

describe("POST /api/auth/register", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("propagates a registered upstream problem body with its status", async () => {
        const problem = createProblemDetails({
            code: "EMPLOYEE_PHONE_ALREADY_REGISTERED",
            requestId: "req-register",
            outcome: "NOT_APPLIED",
        });
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { ...problem, statusCode: problem.status, message: problem.detail, error: problem.detail },
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "s@e.c", password: "pw", name: "n" }));

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
            code: "EMPLOYEE_PHONE_ALREADY_REGISTERED",
            status: 409,
        });
        consoleErrorSpy.mockRestore();
    });

    it("keeps the legacy hasKakaoAccount compatibility field on sanitized upstream failures", async () => {
        mockPost.mockRejectedValue({
            response: {
                status: 409,
                data: { message: "카카오 계정", code: "KAKAO_LINKED", hasKakaoAccount: true },
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "s@e.c", password: "pw", name: "n" }));

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.hasKakaoAccount).toBe(true);
        expect(typeof body.error).toBe("string");
        consoleErrorSpy.mockRestore();
    });

    it("sanitizes a transport failure without reflecting internal details", async () => {
        mockPost.mockRejectedValue(new Error("connect ETIMEDOUT"));
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest({ email: "s@e.c", password: "pw", name: "n" }));

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("ETIMEDOUT");
        consoleErrorSpy.mockRestore();
    });

    it.each([
        { versions: [], supported: false },
        { versions: [""], supported: false },
        { versions: ["2"], supported: false },
        { versions: ["1", "1"], supported: false },
        { versions: ["1, 2"], supported: false },
        { versions: ["1"], supported: true },
    ])("forwards only the exact supported version ($versions)", async ({ versions, supported }) => {
        const data = supported
            ? { success: true, linkVerificationRequired: true, linkChallengeToken: "synthetic-challenge" }
            : { success: true };
        mockPost.mockResolvedValueOnce({ status: 201, data });

        const response = await POST(createRequest(validBody, versions));

        expect(response.status).toBe(201);
        expect(mockPost).toHaveBeenCalledWith("/auth/register", validBody, supported
            ? { headers: { "x-account-link-version": "1" } }
            : undefined);
        await expect(response.json()).resolves.toEqual(data);
    });

    it.each([{ versions: [] }, { versions: ["1"] }])("passes through the safe phone refusal for $versions", async ({ versions }) => {
        const problem = createProblemDetails({
            code: "VALIDATION_FAILED",
            requestId: "synthetic-refusal",
            errors: [{ pointer: "/phone", code: "INVALID_VALUE", detail: "Invalid value" }],
        });
        mockPost.mockRejectedValueOnce({ response: { status: 400, data: problem } });
        const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await POST(createRequest(validBody, versions));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            code: "VALIDATION_FAILED", errors: [{ pointer: "/phone", code: "INVALID_VALUE" }],
        });
        log.mockRestore();
    });
});
