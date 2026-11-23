/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { createProblemDetails } from "@babyjamjam/shared";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/env", () => ({ getServerRuntimeConfig: () => ({}) }));

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: BodyInit, versions: string[] = []): NextRequest {
    return new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        headers: [["content-type", "application/json"], ...versions.map((value): [string, string] => ["x-account-link-version", value])],
        body,
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
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("rejects a body missing required fields without proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({ email: "user@example.com" })));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON without proxying", async () => {
        const response = await POST(createRequest("{bad-json"));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards a valid body to the backend", async () => {
        mockPost.mockResolvedValue({ status: 201, data: { success: true } });

        const response = await POST(createRequest(JSON.stringify(validBody)));

        expect(response.status).toBe(201);
        expect(mockPost).toHaveBeenCalledWith("/auth/register", validBody, undefined);
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

        const response = await POST(createRequest(JSON.stringify(validBody), versions));

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

        const response = await POST(createRequest(JSON.stringify(validBody), versions));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            code: "VALIDATION_FAILED", errors: [{ pointer: "/phone", code: "INVALID_VALUE" }],
        });
        log.mockRestore();
    });
});
