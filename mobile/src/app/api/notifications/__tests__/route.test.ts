/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getNotifications } from "../route";
import { POST as subscribeNotifications } from "../subscribe/route";
import { POST as unsubscribeNotifications } from "../unsubscribe/route";
import { GET as getVapidKey } from "../vapid-key/route";
import { PATCH as markAllRead } from "../read-all/route";
import { GET as getUnreadCount } from "../unread/count/route";
import { POST as testBroadcast } from "../test-broadcast/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock("@/lib/e2e", () => ({
  E2E_VAPID_PUBLIC_KEY: "e2e-public-key",
  isE2ETest: () => false,
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;

interface TestRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

function createRequest(path: string, init: TestRequestInit = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      cookie: "auth_token=auth-token",
      ...init.headers,
    },
    body: init.body,
  });
}

describe("notification API routes", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  function noCookieRequest(path: string, method = "GET"): NextRequest {
    return new NextRequest(`http://localhost${path}`, { method });
  }

  it("requires auth before listing notifications", async () => {
    const response = await getNotifications(noCookieRequest("/api/notifications"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("requires auth before marking all notifications read", async () => {
    const response = await markAllRead(noCookieRequest("/api/notifications/read-all", "PATCH"));
    expect(response.status).toBe(401);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("requires auth before subscribing to notifications", async () => {
    const response = await subscribeNotifications(noCookieRequest("/api/notifications/subscribe", "POST"));
    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("requires auth before unsubscribing from notifications", async () => {
    const response = await unsubscribeNotifications(noCookieRequest("/api/notifications/unsubscribe", "POST"));
    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("requires auth before fetching the unread count", async () => {
    const response = await getUnreadCount(noCookieRequest("/api/notifications/unread/count"));
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("requires auth before sending a test broadcast", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(new Response("{}"));
    const response = await testBroadcast(noCookieRequest("/api/notifications/test-broadcast", "POST"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("preserves backend status and payload when listing notifications", async () => {
    mockGet.mockResolvedValue({
      status: 403,
      data: { error: "branch access denied" },
    });

    const response = await getNotifications(createRequest("/api/notifications?limit=10&offset=20"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "branch access denied" });
    expect(mockGet).toHaveBeenCalledWith("/notifications", {
      params: { limit: "10", offset: "20" },
      headers: { Authorization: "Bearer auth-token" },
    });
  });

  it("rejects malformed subscribe JSON before proxying", async () => {
    const response = await subscribeNotifications(
      createRequest("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects subscribe payloads missing required push keys before proxying", async () => {
    const response = await subscribeNotifications(
      createRequest("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example/abc" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards validated subscribe payload to the backend", async () => {
    mockPost.mockResolvedValue({ status: 201, data: { success: true } });

    const subscribeBody = {
      endpoint: "https://push.example/abc",
      p256dh: "p256dh-key",
      auth: "auth-key",
      userAgent: "jest",
    };

    const response = await subscribeNotifications(
      createRequest("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscribeBody),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockPost).toHaveBeenCalledWith(
      "/notifications/subscribe",
      subscribeBody,
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("rejects unsubscribe payloads missing endpoint before proxying", async () => {
    const response = await unsubscribeNotifications(
      createRequest("/api/notifications/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("forwards validated unsubscribe payload to the backend", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { success: true } });

    const unsubscribeBody = { endpoint: "https://push.example/abc" };

    const response = await unsubscribeNotifications(
      createRequest("/api/notifications/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(unsubscribeBody),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockPost).toHaveBeenCalledWith(
      "/notifications/unsubscribe",
      unsubscribeBody,
      { headers: { Authorization: "Bearer auth-token" } },
    );
  });

  it("preserves backend status and payload when fetching the VAPID key", async () => {
    mockGet.mockResolvedValue({
      status: 503,
      data: { error: "push service unavailable" },
    });

    const response = await getVapidKey();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "push service unavailable" });
  });
});
