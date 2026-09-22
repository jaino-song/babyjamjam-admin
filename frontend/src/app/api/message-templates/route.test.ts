/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET, POST } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

describe("GET /api/message-templates", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/message-templates"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure instead of a raw English 500", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "template table missing on shard-7" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(
            new NextRequest("http://localhost/api/message-templates", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("shard-7");
        expect(JSON.stringify(body)).not.toContain("Failed to fetch message templates");
        consoleErrorSpy.mockRestore();
    });
});

describe("POST /api/message-templates", () => {
    beforeEach(() => {
        mockPost.mockReset();
    });

    it("rejects an unauthenticated create with a registered 401 problem body", async () => {
        const response = await POST(
            new NextRequest("http://localhost/api/message-templates", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "템플릿" }),
            }),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("keeps a successful create on 201", async () => {
        mockPost.mockResolvedValue({ status: 201, data: { id: "tpl-1" } });

        const response = await POST(
            new NextRequest("http://localhost/api/message-templates", {
                method: "POST",
                headers: { cookie: "auth_token=token-1", "content-type": "application/json" },
                body: JSON.stringify({ name: "템플릿" }),
            }),
        );

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toEqual({ id: "tpl-1" });
    });
});
