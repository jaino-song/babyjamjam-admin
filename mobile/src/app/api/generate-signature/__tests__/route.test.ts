/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { POST } from "../route";

function createRequest(body: BodyInit): NextRequest {
    return new NextRequest("http://localhost/api/generate-signature", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            cookie: "auth_token=auth-token",
        },
        body,
    });
}

describe("POST /api/generate-signature", () => {
    it("returns the provider-operation tombstone regardless of request body", async () => {
        const response = await POST(createRequest(JSON.stringify({ executionTime: 1 })));

        expect(response.status).toBe(410);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_EXPIRED",
            status: 410,
            outcome: "NOT_APPLIED",
            error: "eformsign provider operations are server-only",
        }));
    });
});
