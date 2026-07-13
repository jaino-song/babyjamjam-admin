/**
 * @jest-environment node
 */
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

import { GET as getFeedbackList } from "../route";
import { GET as getFeedbackDetail } from "../[id]/route";
import { GET as getFeedbackStats } from "../stats/route";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

const mockCookies = cookies as jest.Mock;
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
    mockFetch.mockReset();
  });

  describe("auth rejection", () => {
    it("rejects feedback detail GET without an auth cookie before proxying", async () => {
      setAuthCookie();
      const response = await getFeedbackDetail(
        createRequest("/api/admin/feedback/fb-1"),
        { params: Promise.resolve({ id: "fb-1" }) },
      );
      expect(response.status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects feedback stats GET without an auth cookie before proxying", async () => {
      setAuthCookie();
      const response = await getFeedbackStats();
      expect(response.status).toBe(401);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it("proxies backend authorization denials when listing feedback", async () => {
    setAuthCookie("user-token");
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const response = await getFeedbackList(createRequest("/api/admin/feedback"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch feedback" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/feedback?page=1&limit=20"),
      {
        headers: {
          Authorization: "Bearer user-token",
        },
      },
    );
  });

  it("proxies backend authorization denials when reading feedback stats", async () => {
    setAuthCookie("user-token");
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const response = await getFeedbackStats();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch feedback stats" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/feedback/stats"),
      {
        headers: {
          Authorization: "Bearer user-token",
        },
      },
    );
  });

  it("proxies backend authorization denials when reading feedback details", async () => {
    setAuthCookie("user-token");
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const response = await getFeedbackDetail(
      createRequest("/api/admin/feedback/fb-1"),
      { params: Promise.resolve({ id: "fb-1" }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Failed to fetch feedback" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/feedback/fb-1"),
      {
        headers: {
          Authorization: "Bearer user-token",
        },
      },
    );
  });

  it("proxies feedback list requests with the auth token", async () => {
    setAuthCookie("owner-token");
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
