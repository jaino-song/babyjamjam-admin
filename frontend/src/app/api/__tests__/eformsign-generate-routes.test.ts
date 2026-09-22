/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as generateDocument } from "../generate-document/route";
import { POST as generateSignature } from "../generate-signature/route";
import { POST as generateStaffDocument } from "../generate-staff-document/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, body = "{}") {
    return new NextRequest(`http://localhost${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=auth-token",
        },
        body,
    });
}

describe("retired eformsign provider routes", () => {
    beforeEach(() => mockPost.mockReset());

    it.each([
        ["signature", generateSignature, "/api/generate-signature"],
        ["document generation", generateDocument, "/api/generate-document"],
        ["staff document generation", generateStaffDocument, "/api/generate-staff-document"],
    ])("returns a deterministic 410 problem for %s", async (_label, handler, path) => {
        const response = await handler(createRequest(path, JSON.stringify({ executionTime: 1 })));

        expect(response.status).toBe(410);
        const body = await response.json();
        expect(body).toMatchObject({
            code: "EFORMSIGN_PROVIDER_OPERATION_SERVER_ONLY",
            status: 410,
            outcome: "NOT_APPLIED",
        });
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("server-mediated");
        expect(JSON.stringify(body)).not.toContain("Use the server-mediated");
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect(mockPost).not.toHaveBeenCalled();
    });
});
