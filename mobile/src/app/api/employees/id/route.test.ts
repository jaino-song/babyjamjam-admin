/** @jest-environment node */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn() } }));
const mockGet = serverAPIClient.get as jest.Mock;
function request(query = "?id=12", authenticated = true) {
    return new NextRequest(`http://localhost/api/employees/id${query}`, {
        headers: authenticated ? { cookie: "auth_token=test-token" } : {},
    });
}
beforeEach(() => { mockGet.mockReset(); });

it("forwards a valid id with authentication headers", async () => {
    mockGet.mockResolvedValue({ data: { id: 12, name: "직원" } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 12, name: "직원" });
    expect(mockGet).toHaveBeenCalledWith("/employees/id", {
        params: { id: "12" }, headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
    });
});
it.each(["", "?id=0", "?id=abc", "?id=-1", "?id=1.5"])("rejects invalid query %s locally", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mockGet).not.toHaveBeenCalled();
});
it("rejects missing authentication before calling upstream", async () => {
    expect((await GET(request("?id=12", false))).status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
});
it.each(["", null, {}])("preserves not-found empty upstream data %j", async (data) => {
    mockGet.mockResolvedValue({ data });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data || null);
});
it("preserves failure status without leaking upstream text", async () => {
    mockGet.mockRejectedValue({ response: { status: 500, data: { error: "private upstream detail" } } });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private upstream detail");
});
