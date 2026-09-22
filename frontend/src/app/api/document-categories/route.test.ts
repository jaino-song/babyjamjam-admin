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

describe("/api/document-categories", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(new NextRequest("http://localhost/api/document-categories"));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects an unauthenticated create with a registered 401 problem body", async () => {
        const response = await POST(
            new NextRequest("http://localhost/api/document-categories", { method: "POST" }),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("sanitizes read and create transport failures without reflecting internal details", async () => {
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        mockGet.mockRejectedValue(new Error("query planner collapsed"));
        const getRequest = new NextRequest("http://localhost/api/document-categories", {
            headers: { cookie: "auth_token=token-1" },
        });

        const getResponse = await GET(getRequest);

        expect(getResponse.status).toBe(500);
        const getBody = await getResponse.json();
        expect(typeof getBody.error).toBe("string");
        expect(getBody.error).not.toContain("query planner");

        mockPost.mockRejectedValue(new Error("insert into secret_table failed"));
        const postRequest = new NextRequest("http://localhost/api/document-categories", {
            method: "POST",
            headers: { cookie: "auth_token=token-1", "content-type": "application/json" },
            body: JSON.stringify({ name: "분류" }),
        });

        const postResponse = await POST(postRequest);

        expect(postResponse.status).toBe(500);
        const postBody = await postResponse.json();
        expect(typeof postBody.error).toBe("string");
        expect(postBody.error).not.toContain("secret_table");
        consoleErrorSpy.mockRestore();
    });
});
