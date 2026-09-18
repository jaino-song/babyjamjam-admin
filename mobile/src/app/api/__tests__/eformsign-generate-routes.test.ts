/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST as generateDocument } from "../generate-document/route";
import { POST as generateSignature } from "../generate-signature/route";

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
    ])("returns a deterministic 410 for %s", async (_label, handler, path) => {
        const response = await handler(createRequest(path, JSON.stringify({ executionTime: 1 })));

        expect(response.status).toBe(410);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_EXPIRED",
            status: 410,
            outcome: "NOT_APPLIED",
        }));
        expect(response.headers.get("Cache-Control")).toContain("no-store");
        expect(mockPost).not.toHaveBeenCalled();
    });
});
