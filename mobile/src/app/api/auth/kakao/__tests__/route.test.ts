/**
 * @jest-environment node
 */
import { resolveBackendBaseUrl } from "@/lib/api/server";

import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
    resolveBackendBaseUrl: jest.fn(),
}));

const mockResolveBackendBaseUrl = resolveBackendBaseUrl as jest.Mock;

describe("GET /api/auth/kakao", () => {
    beforeEach(() => {
        mockResolveBackendBaseUrl.mockReset();
    });

    it("redirects to the backend Kakao OAuth endpoint", async () => {
        mockResolveBackendBaseUrl.mockReturnValue("https://api.example.com");

        const response = await GET();

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("https://api.example.com/auth/kakao");
    });

    it("fails clearly when the backend base URL is not configured", async () => {
        mockResolveBackendBaseUrl.mockReturnValue(null);

        const response = await GET();

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: "Backend API base URL is not configured",
        });
    });
});
