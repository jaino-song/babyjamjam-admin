/**
 * @jest-environment node
 */
jest.mock("@/lib/api/server", () => ({
    BACKEND_BASE_URL: "https://api.example.com",
}));

import { GET } from "../route";

describe("GET /api/auth/kakao", () => {
    it("redirects to the backend Kakao OAuth endpoint", async () => {
        const response = await GET();

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe("https://api.example.com/auth/kakao?client=mobile");
    });
});
