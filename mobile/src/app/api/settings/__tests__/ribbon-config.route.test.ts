/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET, PUT } from "../ribbon-config/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;
const validConfig = { enabled: true, message: "공지", backgroundColor: "#004AAD", textColor: "#FFFFFF", linkText: "자세히", linkHref: "/notice", linkColor: "#FFB27B" };

describe("ribbon config mobile proxy", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPut.mockReset();
  });

  it("keeps the public GET backend contract", async () => {
    mockGet.mockResolvedValue({ status: 200, data: validConfig });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(validConfig);
    expect(mockGet).toHaveBeenCalledWith("/settings/ribbon-config");
  });

  it("requires auth and validates colors before a write", async () => {
    const noAuth = await PUT(new NextRequest("http://localhost/api/settings/ribbon-config", { method: "PUT", body: JSON.stringify(validConfig) }));
    expect(noAuth.status).toBe(401);
    expect(mockPut).not.toHaveBeenCalled();

    const invalid = await PUT(new NextRequest("http://localhost/api/settings/ribbon-config", { method: "PUT", headers: { cookie: "auth_token=owner-token", "content-type": "application/json" }, body: JSON.stringify({ ...validConfig, textColor: "red" }) }));
    expect(invalid.status).toBe(400);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("forwards a validated owner write", async () => {
    mockPut.mockResolvedValue({ status: 200, data: validConfig });
    const response = await PUT(new NextRequest("http://localhost/api/settings/ribbon-config", { method: "PUT", headers: { cookie: "auth_token=owner-token", "content-type": "application/json" }, body: JSON.stringify(validConfig) }));
    expect(response.status).toBe(200);
    expect(mockPut).toHaveBeenCalledWith("/settings/ribbon-config", validConfig, { headers: { Authorization: "Bearer owner-token" } });
  });
});
