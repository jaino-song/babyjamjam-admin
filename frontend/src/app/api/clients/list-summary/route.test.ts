/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { GET as getClients } from "../route";
import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/clients/list-summary", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("requires the application auth token before calling the backend", async () => {
        const response = await GET(
            new NextRequest("http://localhost/api/clients/list-summary?search=%EA%B9%80"),
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_REQUIRED",
            status: 401,
        });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards the search text and authenticated backend headers", async () => {
        const summary = {
            total: 1,
            byTab: {
                all: 1,
                pre_booking: 0,
                waiting: 0,
                replacement_requested: 0,
                active: 1,
                completed: 0,
                terminated: 0,
            },
            dueDate: { thisMonth: 1, nextMonth: 0 },
            serviceEnd: { count: 0, from: "2026-09-29", to: "2026-10-02" },
        };
        mockGet.mockResolvedValue({ status: 200, data: summary });

        const response = await GET(
            new NextRequest("http://localhost/api/clients/list-summary?search=%20%EA%B9%80%20", {
                headers: { cookie: "auth_token=access-token" },
            }),
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(summary);
        expect(mockGet).toHaveBeenCalledWith("/clients/list-summary", {
            params: { search: " 김 " },
            headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
        });
    });

    it("forwards the new tab without changing the legacy filter parameter", async () => {
        mockGet.mockResolvedValue({ status: 200, data: [] });

        const response = await getClients(
            new NextRequest(
                "http://localhost/api/clients?page=2&limit=20&search=%EA%B9%80&tab=active&filter=starting-soon",
                { headers: { cookie: "auth_token=access-token" } },
            ),
        );

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith("/clients", {
            params: {
                page: "2",
                limit: "20",
                search: "김",
                tab: "active",
                filter: "starting-soon",
            },
            headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
        });
    });

    it("preserves a registered backend problem response", async () => {
        const problem = createProblemDetails({
            code: "ACCESS_DENIED",
            requestId: "req-summary-denied",
            outcome: "NOT_APPLIED",
        });
        mockGet.mockRejectedValue({
            response: {
                status: 403,
                data: problem,
            },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET(
                new NextRequest("http://localhost/api/clients/list-summary", {
                    headers: { cookie: "auth_token=access-token" },
                }),
            );

            expect(response.status).toBe(403);
            await expect(response.json()).resolves.toMatchObject({
                code: "ACCESS_DENIED",
                requestId: "req-summary-denied",
                status: 403,
            });
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
