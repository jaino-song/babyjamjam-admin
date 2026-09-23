/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { POST } from "./route";

describe("POST /api/access-token", () => {
    it("returns a deterministic 410 problem without exposing credentials", async () => {
        const response = await POST(
            new NextRequest("http://localhost/api/access-token", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ apiKey: "secret-key" }),
            }),
        );

        expect(response.status).toBe(410);
        const body = await response.json();
        expect(body).toMatchObject({
            code: "EFORMSIGN_CREDENTIALS_SERVER_ONLY",
            status: 410,
            outcome: "NOT_APPLIED",
        });
        expect(typeof body.error).toBe("string");
        expect(JSON.stringify(body)).not.toContain("secret-key");
        expect(JSON.stringify(body)).not.toContain("Raw eformsign credentials are not exposed");
        expect(response.headers.get("Content-Type")).toContain("application/problem+json");
        expect(response.headers.get("Cache-Control")).toContain("no-store");
    });
});
