/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { POST } from "../route";

describe("POST /api/generate-document", () => {
    it("returns the provider-operation tombstone without forwarding caller credentials", async () => {
        const request = new NextRequest("http://localhost/api/generate-document", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                cookie: "auth_token=auth-token",
            },
            body: JSON.stringify({
                contractData: { customerName: "고객" },
                clientId: 5,
                accessToken: "caller-token",
                refreshToken: "caller-refresh",
            }),
        });

        const response = await POST(request);

        expect(response.status).toBe(410);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "REQUEST_EXPIRED",
            status: 410,
            outcome: "NOT_APPLIED",
            error: "Use the server-mediated eformsign dispatch operation",
        }));
    });
});
