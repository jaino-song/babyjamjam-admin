/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { PATCH as markInquiryRead } from "../[id]/read/route";
import { GET as listInquiries } from "../route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;

function createRequest(path: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { cookie: "auth_token=auth-token" },
  });
}

describe("consultation inquiry API routes", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("preserves backend error status and sanitizes payload when listing inquiries", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "inquiry access denied" },
      },
    });

    const response = await listInquiries(
      createRequest("/api/consultation-inquiries?page=1&limit=20"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch consultation inquiries" });
  });

  it("rejects unsafe inquiry IDs before proxying read updates", async () => {
    const response = await markInquiryRead(
      createRequest("/api/consultation-inquiries/bad%2Fid/read", "PATCH"),
      { params: Promise.resolve({ id: "bad%2Fid" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid inquiry id" });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("preserves backend read-update error status and sanitizes payload", async () => {
    mockPatch.mockRejectedValue({
      response: {
        status: 404,
        data: { error: "inquiry not found" },
      },
    });

    const response = await markInquiryRead(
      createRequest("/api/consultation-inquiries/inquiry_123/read", "PATCH"),
      { params: Promise.resolve({ id: "inquiry_123" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Failed to mark consultation inquiry as read" });
  });

  describe("auth rejection", () => {
    it("rejects mark-read without auth_token", async () => {
      const request = new NextRequest("http://localhost/api/consultation-inquiries/inquiry_123/read", {
        method: "PATCH",
      });
      const response = await markInquiryRead(request, {
        params: Promise.resolve({ id: "inquiry_123" }),
      });
      expect(response.status).toBe(401);
      expect(mockPatch).not.toHaveBeenCalled();
    });
  });
});
