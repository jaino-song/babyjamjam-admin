/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { GET as getEvents } from "../events/route";
import { GET as getDispatchProgress } from "../dispatch-headless/progress/route";
import { GET as getFinalizeProgress } from "../finalize-headless/progress/route";

const mockFetch = jest.fn();
const originalFetch = global.fetch;

function createRequest(path: string, cookie = true): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: {
      ...(cookie ? { cookie: "auth_token=auth-token" } : {}),
    },
  });
}

async function readSsePayload(response: Response): Promise<Record<string, unknown>> {
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  const text = await response.text();
  expect(text.startsWith("event: error\ndata: ")).toBe(true);
  return JSON.parse(text.replace(/^event: error\ndata: /, "").trim()) as Record<string, unknown>;
}

describe("eformsign SSE proxy routes problem conversion (BJJ-319 6.1e)", () => {
  beforeAll(() => {
    global.fetch = mockFetch as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it.each([
    ["events", () => getEvents(createRequest("/api/eformsign-docs/events", false))],
    ["dispatch progress", () => getDispatchProgress(createRequest("/api/eformsign-docs/dispatch-headless/progress?progressId=p1", false))],
    ["finalize progress", () => getFinalizeProgress(createRequest("/api/eformsign-docs/finalize-headless/progress?progressId=p1", false))],
  ])("returns an AUTH_REQUIRED problem for %s without a token", async (_name, act) => {
    const response = await act();

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "AUTH_REQUIRED",
      status: 401,
      outcome: "NOT_APPLIED",
      error: "Unauthorized",
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["dispatch progress", () => getDispatchProgress(createRequest("/api/eformsign-docs/dispatch-headless/progress"))],
    ["finalize progress", () => getFinalizeProgress(createRequest("/api/eformsign-docs/finalize-headless/progress"))],
  ])("rejects a missing progressId for %s with a VALIDATION_FAILED query problem", async (_name, act) => {
    const response = await act();

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      code: "VALIDATION_FAILED",
      status: 400,
      outcome: "NOT_APPLIED",
      error: "progressId is required",
      errors: [{ pointer: "/progressId", code: "REQUIRED", detail: "필수 항목이에요.", location: "query" }],
    }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sanitizes an upstream events rejection into a Korean SSE problem with the status preserved", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "tenant blocked", diagnostics: "Bearer upstream-secret" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await getEvents(createRequest("/api/eformsign-docs/events"));

    expect(response.status).toBe(403);
    const payload = await readSsePayload(response);
    expect(payload).toMatchObject({ type: "error" });
    expect(typeof payload.error).toBe("string");
    expect(payload.error as string).toMatch(/[가-힣]/);
    expect(payload.code).not.toBe("UPSTREAM_ERROR");
    expect(JSON.stringify(payload)).not.toContain("upstream-secret");
    expect(JSON.stringify(payload)).not.toContain("tenant blocked");
  });

  it("emits an UPSTREAM_INVALID_RESPONSE SSE problem for events transport failures", async () => {
    mockFetch.mockRejectedValue(new Error("backend unavailable"));

    const response = await getEvents(createRequest("/api/eformsign-docs/events"));

    expect(response.status).toBe(502);
    const payload = await readSsePayload(response);
    expect(payload).toMatchObject({
      type: "error",
      code: "UPSTREAM_INVALID_RESPONSE",
      status: 502,
      outcome: "NOT_APPLIED",
    });
  });

  it("sanitizes an upstream dispatch progress rejection into a Korean SSE problem with the status preserved", async () => {
    mockFetch.mockResolvedValue(
      new Response("progress stream unavailable", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    const response = await getDispatchProgress(
      createRequest("/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1"),
    );

    expect(response.status).toBe(503);
    const payload = await readSsePayload(response);
    expect(payload).toMatchObject({ type: "error" });
    expect(payload.error as string).toMatch(/[가-힣]/);
    expect(payload.code).not.toBe("UPSTREAM_ERROR");
    expect(JSON.stringify(payload)).not.toContain("progress stream unavailable");
  });

  it("emits an UPSTREAM_INVALID_RESPONSE SSE problem for dispatch transport failures", async () => {
    mockFetch.mockRejectedValue(new Error("dispatch backend unavailable"));

    const response = await getDispatchProgress(
      createRequest("/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1"),
    );

    expect(response.status).toBe(502);
    const payload = await readSsePayload(response);
    expect(payload).toMatchObject({
      type: "error",
      code: "UPSTREAM_INVALID_RESPONSE",
      status: 502,
      outcome: "NOT_APPLIED",
    });
  });

  it("sanitizes an upstream finalize progress rejection into a Korean SSE problem with the status preserved", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "progress not found", diagnostics: "member@example.com" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await getFinalizeProgress(
      createRequest("/api/eformsign-docs/finalize-headless/progress?progressId=missing"),
    );

    expect(response.status).toBe(404);
    const payload = await readSsePayload(response);
    expect(payload).toMatchObject({ type: "error" });
    expect(payload.error as string).toMatch(/[가-힣]/);
    expect(payload.code).not.toBe("UPSTREAM_ERROR");
    expect(JSON.stringify(payload)).not.toContain("member@example.com");
  });

  it("emits an UPSTREAM_INVALID_RESPONSE SSE problem for finalize transport failures", async () => {
    mockFetch.mockRejectedValue(new Error("finalize backend unavailable"));

    const response = await getFinalizeProgress(
      createRequest("/api/eformsign-docs/finalize-headless/progress?progressId=progress-1"),
    );

    expect(response.status).toBe(502);
    const payload = await readSsePayload(response);
    expect(payload).toMatchObject({
      type: "error",
      code: "UPSTREAM_INVALID_RESPONSE",
      status: 502,
      outcome: "NOT_APPLIED",
    });
  });

  it("forwards a registered upstream problem body verbatim inside the SSE error envelope", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({
        type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#validation-failed",
        title: "Validation failed",
        status: 422,
        detail: "입력 정보가 처리 조건에 맞지 않아요.",
        code: "VALIDATION_FAILED",
        requestId: "req-progress-1",
        params: {},
      }), {
        status: 422,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );

    const response = await getDispatchProgress(
      createRequest("/api/eformsign-docs/dispatch-headless/progress?progressId=progress-1"),
    );

    expect(response.status).toBe(422);
    const payload = await readSsePayload(response);
    expect(payload).toMatchObject({
      type: "error",
      code: "VALIDATION_FAILED",
      status: 422,
      requestId: "req-progress-1",
    });
  });
});
