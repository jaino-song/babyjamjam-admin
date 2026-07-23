/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getContext } from "../context/route";
import { POST as verifyPhone } from "../verify/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

describe("service-record authentication routes", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
    });

    it("stores the verified access token in a path-scoped HttpOnly cookie", async () => {
        mockPost.mockResolvedValue({
            status: 200,
            data: { ok: true, accessToken: "persisted-access-token" },
        });
        const request = new NextRequest("http://localhost/api/service-record/link-token/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: "010-1234-5678" }),
        });

        const response = await verifyPhone(request, {
            params: Promise.resolve({ token: "link-token" }),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("service_record_access=persisted-access-token"));
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("HttpOnly"));
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("SameSite=lax"));
        expect(response.headers.get("set-cookie")).toEqual(expect.stringContaining("Path=/api/service-record/link-token"));
    });

    it("forwards the persisted access cookie when the browser sends no Authorization header", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { totalSessions: 1 } });
        const request = new NextRequest("http://localhost/api/service-record/link-token/context", {
            headers: { cookie: "service_record_access=persisted-access-token" },
        });

        const response = await getContext(request);

        expect(response.status).toBe(200);
        expect(mockGet).toHaveBeenCalledWith("/service-record/context", {
            headers: { Authorization: "Bearer persisted-access-token" },
        });
    });
});
