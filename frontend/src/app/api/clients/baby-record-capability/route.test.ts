/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn() } }));

const get = jest.mocked(serverAPIClient.get);
const path = "http://localhost/api/clients/baby-record-capability";
const authenticated = () => new NextRequest(`${path}?branchId=ignore-me`, {
    headers: { cookie: "auth_token=test-token; selected_branch_id=ignore-me" },
});

describe("GET /api/clients/baby-record-capability", () => {
    beforeEach(() => get.mockReset());

    it("requires an authenticated session", async () => {
        const response = await GET(new NextRequest(path));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(get).not.toHaveBeenCalled();
    });

    it.each([true, false])("forwards the authenticated branch capability (%s) without caching", async (enabled) => {
        get.mockResolvedValue({ status: 200, data: { enabled } });
        const response = await GET(authenticated());

        expect(get).toHaveBeenCalledWith("/clients/baby-record-capability", {
            headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        await expect(response.json()).resolves.toEqual({ enabled });
    });

    it("rejects a non-boolean upstream capability", async () => {
        get.mockResolvedValue({ status: 200, data: { enabled: "true" } });
        const response = await GET(authenticated());

        expect(response.status).toBe(502);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        await expect(response.json()).resolves.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
    });
});
