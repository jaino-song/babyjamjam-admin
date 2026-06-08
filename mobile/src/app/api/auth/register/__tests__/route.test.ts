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
    return new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
    });
}

const validBody = {
    email: "user@example.com",
    password: "password123",
    name: "Hong Gildong",
    phone: "010-1234-5678",
    birthDate: "1990-01-01",
    branchId: "11111111-1111-4111-8111-111111111111",
    role: "user",
};

describe("POST /api/auth/register", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockPost.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it("rejects a body missing required fields without proxying", async () => {
        const response = await POST(createRequest(JSON.stringify({ email: "user@example.com" })));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("rejects malformed JSON without proxying", async () => {
        const response = await POST(createRequest("{bad-json"));

        expect(response.status).toBe(400);
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("forwards a valid body to the backend", async () => {
        mockPost.mockResolvedValue({ status: 201, data: { success: true } });

        const response = await POST(createRequest(JSON.stringify(validBody)));

        expect(response.status).toBe(201);
        expect(mockPost).toHaveBeenCalledWith("/auth/register", validBody);
    });
});
