/** @jest-environment node */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { patch: jest.fn() } }));
const mockPatch = jest.mocked(serverAPIClient.patch);
const request = (authenticated = true) => new NextRequest("http://localhost/api/clients/75/confirm-booking", {
  method: "PATCH",
  headers: authenticated ? { cookie: "auth_token=access-token" } : {},
});

describe("PATCH /api/clients/[id]/confirm-booking", () => {
  beforeEach(() => jest.clearAllMocks());
  it("rejects unauthenticated confirmation", async () => {
    const response = await PATCH(request(false), { params: Promise.resolve({ id: "75" }) });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
    expect(mockPatch).not.toHaveBeenCalled();
  });
  it("forwards a bodyless patch and returns the raw confirmed client", async () => {
    const client = { id: 75, bookingConfirmedAt: "2026-10-13T00:00:00.000Z", serviceStatus: "waiting" };
    mockPatch.mockResolvedValue({ data: client } as never);
    const response = await PATCH(request(), { params: Promise.resolve({ id: "75" }) });
    expect(mockPatch).toHaveBeenCalledWith("/clients/75/confirm-booking", {}, {
      headers: { Authorization: "Bearer access-token" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(client);
  });
  it("sanitizes upstream failures", async () => {
    mockPatch.mockRejectedValue({ response: { status: 500, data: { message: "private shard exploded" } } });
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await PATCH(request(), { params: Promise.resolve({ id: "75" }) });
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("private shard");
    } finally { spy.mockRestore(); }
  });
});
