/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        post: jest.fn(),
    },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: BodyInit): NextRequest {
    return new NextRequest("http://localhost/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
}

describe("POST /api/auth/resend-verification", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("rejects a body with an invalid email without proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({ email: "not-an-email" })));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards a valid body to the backend", async () => {
        mockPost.mockResolvedValue({ status: 200, data: { success: true } });

        const response = await POST(createRequest(JSON.stringify({ email: "user@example.com" })));

        expect(response.status).toBe(200);
        expect(mockPost).toHaveBeenCalledWith("/auth/resend-verification", { email: "user@example.com" });
    });
});
