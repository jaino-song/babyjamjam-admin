/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getActiveClients } from "../active-clients/route";
import { GET as getWorkHistory } from "../work-history/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(path: string, cookie = "auth_token=access-token") {
    return new NextRequest(`http://localhost${path}`, {
        headers: { cookie },
    });
}

describe("employee detail proxy routes", () => {
    beforeEach(() => mockGet.mockReset());

    it("requires authentication before id or pagination validation", async () => {
        const activeResponse = await getActiveClients(createRequest("/api/employees/0/active-clients", ""), {
            params: Promise.resolve({ id: "0" }),
        });
        const historyResponse = await getWorkHistory(
            createRequest("/api/employees/0/work-history?page=0&limit=101", ""),
            { params: Promise.resolve({ id: "0" }) },
        );

        expect(activeResponse.status).toBe(401);
        expect(historyResponse.status).toBe(401);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards active client lookups with the authenticated tenant token", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: [{
                clientId: 11,
                clientName: "박서연",
                role: "primary",
                startDate: "2026-09-01",
                endDate: "2026-09-30",
                serviceStatus: "active",
            }],
        });

        const response = await getActiveClients(createRequest("/api/employees/7/active-clients"), {
            params: Promise.resolve({ id: "7" }),
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([
            expect.objectContaining({ clientId: 11, role: "primary" }),
        ]);
        expect(mockGet).toHaveBeenCalledWith(
            "/employees/7/active-clients",
            { headers: { Authorization: "Bearer access-token" } },
        );
    });

    it("rejects invalid active-client ids before proxying", async () => {
        const response = await getActiveClients(createRequest("/api/employees/0/active-clients"), {
            params: Promise.resolve({ id: "0" }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "Invalid employee id" });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards paginated work-history parameters", async () => {
        mockGet.mockResolvedValue({
            status: 200,
            data: {
                data: [],
                total: 0,
                page: 2,
                limit: 10,
                totalPages: 0,
            },
        });

        const response = await getWorkHistory(
            createRequest("/api/employees/7/work-history?page=2&limit=10"),
            { params: Promise.resolve({ id: "7" }) },
        );

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith(
            "/employees/7/work-history",
            {
                params: { page: "2", limit: "10" },
                headers: { Authorization: "Bearer access-token" },
            },
        );
    });

    it("rejects invalid pagination before proxying", async () => {
        for (const query of ["page=0", "limit=101", "limit=abc"]) {
            const response = await getWorkHistory(
                createRequest(`/api/employees/7/work-history?${query}`),
                { params: Promise.resolve({ id: "7" }) },
            );

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toEqual({ error: "Invalid pagination" });
        }

        expect(mockGet).not.toHaveBeenCalled();
    });
});
