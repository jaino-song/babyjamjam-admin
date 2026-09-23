/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { POST } from "../route";

describe("POST /api/refresh-access-token", () => {
    it("returns a deterministic tombstone and never issues provider cookies", async () => {
        const request = new NextRequest("http://localhost/api/refresh-access-token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie: "auth_token=auth-token",
            },
            body: JSON.stringify({ executionTime: 1780000000000, refreshToken: "caller-refresh" }),
        });

        const response = await POST(request);

        expect(response.status).toBe(410);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_EXPIRED",
            status: 410,
            outcome: "NOT_APPLIED",
            error: "Raw eformsign credentials are not exposed",
        }));
        expect(response.headers.get("set-cookie")).toBeNull();
    });
});
