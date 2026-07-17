/**
 * @jest-environment node
 */
import { serverAPIClient } from "@/lib/api/server";

import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/auth/branches/all", () => {
    beforeEach(() => {
        mockGet.mockReset();
        jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("forwards the public branch response", async () => {
        const branches = [{ id: "11111111-1111-4111-8111-111111111111", name: "인천점" }];
        mockGet.mockResolvedValue({ status: 200, data: branches });

        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(branches);
        expect(mockGet).toHaveBeenCalledWith("/auth/branches/all");
    });
});
