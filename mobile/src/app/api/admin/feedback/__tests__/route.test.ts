/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { jwtDecode } from "jwt-decode";
import { NextRequest } from "next/server";

import { GET as getFeedbackList } from "../route";
import { GET as getFeedbackDetail } from "../[id]/route";
import { GET as getFeedbackStats } from "../stats/route";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

jest.mock("jwt-decode", () => ({
  jwtDecode: jest.fn(),
}));

const mockCookies = cookies as jest.Mock;
const mockJwtDecode = jwtDecode as jest.Mock;
const mockFetch = jest.fn();
const originalFetch = global.fetch;

function setAuthCookie(token?: string): void {
  mockCookies.mockResolvedValue({
    get: jest.fn((name: string) => {
      if (name === "auth_token" && token) {
        return { value: token };
      }

      return undefined;
    }),
  });
}

function createRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

describe("admin feedback API authorization", () => {
  beforeAll(() => {
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockCookies.mockReset();
    mockJwtDecode.mockReset();
    mockFetch.mockReset();
  });

  it("rejects non-admin users before listing feedback", async () => {
    setAuthCookie("user-token");
    mockJwtDecode.mockReturnValue({ role: "manager" });

    const response = await getFeedbackList(createRequest("/api/admin/feedback"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects non-admin users before reading feedback stats", async () => {
    setAuthCookie("user-token");
    mockJwtDecode.mockReturnValue({ role: "manager" });

    const response = await getFeedbackStats();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects non-admin users before reading feedback details", async () => {
    setAuthCookie("user-token");
    mockJwtDecode.mockReturnValue({ role: "manager" });

    const response = await getFeedbackDetail(
      createRequest("/api/admin/feedback/fb-1"),
      { params: Promise.resolve({ id: "fb-1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("allows owner users to proxy feedback list requests", async () => {
    setAuthCookie("owner-token");
    mockJwtDecode.mockReturnValue({ role: "owner" });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    const response = await getFeedbackList(createRequest("/api/admin/feedback?page=2&limit=5&type=bug"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/feedback?page=2&limit=5&type=bug"),
      {
        headers: {
          Authorization: "Bearer owner-token",
        },
      },
    );
  });
});
