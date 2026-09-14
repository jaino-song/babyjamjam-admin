/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        patch: jest.fn(),
    },
}));

const mockPatch = serverAPIClient.patch as jest.Mock;

function createRequest(body: object): NextRequest {
    return new NextRequest("http://localhost/api/clients/12/request-replacement", {
        method: "PATCH",
        headers: {
            cookie: "auth_token=access-token",
            "content-type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

const replacementBody = { newPrimaryEmployeeId: 7, newSecondaryEmployeeId: 9 };

describe("PATCH /api/clients/[id]/request-replacement", () => {
    beforeEach(() => {
        mockPatch.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("forwards the replacement body and keeps the 200 success shape", async () => {
        mockPatch.mockResolvedValue({ data: { id: 12, serviceStatus: "replacement_requested" } });

        const response = await PATCH(createRequest(replacementBody), {
            params: Promise.resolve({ id: "12" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: 12, serviceStatus: "replacement_requested" });
        expect(mockPatch).toHaveBeenCalledWith(
            "/clients/12/request-replacement",
            replacementBody,
            { headers: { Authorization: "Bearer access-token" } },
        );
    });

    it("passes a converted assignment problem body through with its status and code intact", async () => {
        const problem = createProblemDetails({
            code: "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE",
            requestId: "req-replacement-1",
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
        });
        mockPatch.mockRejectedValue({
            response: {
                status: 400,
                data: problem,
            },
        });

        const response = await PATCH(createRequest(replacementBody), {
            params: Promise.resolve({ id: "12" }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            type: problem.type,
            title: problem.title,
            status: 400,
            detail: problem.detail,
            code: "EMPLOYEE_ASSIGNMENT_NOT_ELIGIBLE",
            requestId: "req-replacement-1",
            outcome: "NOT_APPLIED",
        }));
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    });

    it("keeps the sanitized fallback for a legacy upstream error", async () => {
        const privateMessage = "private employee row detail";
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockPatch.mockRejectedValue({
            response: {
                status: 400,
                data: { message: privateMessage },
            },
        });

        const response = await PATCH(createRequest(replacementBody), {
            params: Promise.resolve({ id: "12" }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain(privateMessage);
        // The legacy fallback still logs the upstream failure for diagnosis.
        expect(consoleError).toHaveBeenCalled();
    });

    it("returns 401 without an auth token and never proxies the request", async () => {
        const request = new NextRequest("http://localhost/api/clients/12/request-replacement", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(replacementBody),
        });

        const response = await PATCH(request, { params: Promise.resolve({ id: "12" }) });

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(mockPatch).not.toHaveBeenCalled();
    });
});
