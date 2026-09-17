/** @jest-environment node */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { GET } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: { get: jest.fn() },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const request = (phone = "010-1234-5678", authenticated = true) => new NextRequest(
  `http://localhost/api/clients/check-phone?phone=${encodeURIComponent(phone)}`,
  { headers: authenticated ? { cookie: "auth_token=test-auth-token" } : {} },
);

describe("GET /api/clients/check-phone", () => {
  beforeEach(() => mockGet.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it("rejects unauthenticated requests before contacting the backend", async () => {
    expect((await GET(request(undefined, false))).status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves the backend duplicate result %s", async (exists) => {
    mockGet.mockResolvedValue({ data: { exists } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ exists });
    expect(mockGet).toHaveBeenCalledWith("/clients/check-phone", expect.objectContaining({
      params: { phone: "01012345678" },
    }));
  });

  it.each([401, 403, 500])("keeps backend %s failures from appearing available", async (status) => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    const warningLog = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockGet.mockRejectedValue({
      config: { headers: { Authorization: "private-test-marker" } },
      response: { status, data: { message: "private-test-marker" } },
    });
    const response = await GET(request());
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).not.toEqual({ exists: false });
    expect(JSON.stringify(body)).not.toContain("private-test-marker");
    expect(JSON.stringify([...errorLog.mock.calls, ...warningLog.mock.calls])).not.toContain("private-test-marker");
  });
});
