/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/voucher-price-infos/type", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(
            new NextRequest("http://localhost/api/voucher-price-infos/type"),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("keeps a successful type read untouched", async () => {
        mockGet.mockResolvedValue({ status: 200, data: [{ type: "A", duration: 5 }] });

        const response = await GET(
            new NextRequest("http://localhost/api/voucher-price-infos/type?type=A&year=2026", {
                headers: { cookie: "auth_token=token-1" },
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([{ type: "A", duration: 5 }]);
        expect(mockGet).toHaveBeenCalledWith(
            "/voucher-price-infos/type",
            expect.objectContaining({ params: { type: "A", year: "2026" } }),
        );
    });
});
