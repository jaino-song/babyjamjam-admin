/**
 * @jest-environment node
 */
import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        defaults: { baseURL: "http://backend.test" },
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

describe("GET /api/health", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("reports success diagnostics when the backend answers", async () => {
        mockGet.mockResolvedValue({ status: 200, statusText: "OK", data: { ok: true } });

        const response = await GET();

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ status: "success" });
        expect(body.backend).toMatchObject({ reachable: true });
    });

    it("answers an unreachable backend with a registered 503 problem body", async () => {
        mockGet.mockRejectedValue(
            new Error("connect ECONNREFUSED 10.0.0.12:8080 after 10000ms"),
        );
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET();

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(body).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503 });
        expect(JSON.stringify(body)).not.toContain("10.0.0.12");
        consoleErrorSpy.mockRestore();
    });

    it("never reflects the raw upstream error message in any failure body", async () => {
        mockGet.mockRejectedValue({
            message: "PrismaClientKnownRequestError at /srv/app/dist/db.js:12",
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET();

        expect(response.status).toBe(503);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("/srv/app/dist");
        consoleErrorSpy.mockRestore();
    });

    it("answers an unconfigured backend with a registered 500 problem body", async () => {
        const serverModule = jest.requireMock("@/lib/api/server") as {
            serverAPIClient: { defaults: { baseURL: string | undefined } };
        };
        const previousBaseURL = serverModule.serverAPIClient.defaults.baseURL;
        serverModule.serverAPIClient.defaults.baseURL = undefined;
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET();

            expect(response.status).toBe(500);
            await expect(response.json()).resolves.toMatchObject({
                code: "INTERNAL_ERROR",
                status: 500,
            });
        } finally {
            serverModule.serverAPIClient.defaults.baseURL = previousBaseURL;
            consoleErrorSpy.mockRestore();
        }
    });
});
