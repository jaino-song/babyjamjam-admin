/** @jest-environment node */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET } from "../service-record-missing/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn() } }));
const mockGet = jest.mocked(serverAPIClient.get);
const path = "/api/clients/service-record-missing";

function request(authenticated = true): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
  });
}

describe("GET /api/clients/service-record-missing (static route beside [id])", () => {
  beforeEach(() => jest.clearAllMocks());

  it("forwards auth and returns the missing-client data without treating the segment as an id", async () => {
    const data = {
      count: 1,
      items: [{ clientId: 523, clientName: "QA-고객", primaryEmployeeName: "QA-제공인력", unwrittenThroughSessionIndex: 3 }],
    };
    mockGet.mockResolvedValue({ status: 200, data });
    const response = await GET(request());
    expect(mockGet).toHaveBeenCalledWith("/clients/service-record-missing", {
      headers: { Authorization: "Bearer auth-token" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual(data);
  });

  it("requires auth before contacting the backend", async () => {
    const response = await GET(request(false));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ code: "AUTH_REQUIRED", status: 401 }));
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("keeps a successful empty response distinct from a failure", async () => {
    mockGet.mockResolvedValue({ status: 200, data: { count: 0, items: [] } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ count: 0, items: [] });
  });

  it("uses the read error helper without exposing backend diagnostics", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    mockGet.mockRejectedValue({ response: { status: 500, data: { message: "SELECT * FROM Client" } } });
    const response = await GET(request());
    consoleError.mockRestore();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("SELECT");
    expect(body).not.toHaveProperty("items");
  });
});
