/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as listCategories, POST as createCategory } from "../route";

async function expectCanonicalValidationResponse(
  response: Response,
  legacyError: string,
): Promise<void> {
  expect(response.status).toBe(400);
  const requestId = response.headers.get("X-Request-Id");
  expect(requestId).toEqual(expect.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/));
  expect(response.headers.get("Content-Type")).toBe("application/problem+json");
  expect(response.headers.get("Content-Language")).toBe("ko-KR");
  expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");

  const body = await response.json();
  expect(body).toMatchObject({
    code: "VALIDATION_FAILED",
    outcome: "NOT_APPLIED",
    error: legacyError,
    requestId,
  });
  expect(Array.isArray(body.errors)).toBe(true);
}

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      cookie: "auth_token=auth-token",
      ...init.headers,
    },
    body: init.body,
  });
}

describe("document category API route", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("preserves backend error status and sanitizes payload when listing categories", async () => {
    mockGet.mockRejectedValue({
      response: {
        status: 403,
        data: { error: "category access denied" },
      },
    });

    const response = await listCategories(createRequest("/api/document-categories"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: expect.stringMatching(/[가-힣].*요[.!]?$/) });
  });

  it("preserves backend status and forwards the validated body when creating categories", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const payload = { value: "contracts", label: "Contracts", color: "#ff0000" };

    const response = await createCategory(
      createRequest("/api/document-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
    expect(mockPost).toHaveBeenCalledWith("/document-categories", payload, expect.any(Object));
  });

  it("rejects create bodies missing required fields before proxying", async () => {
    const response = await createCategory(
      createRequest("/api/document-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // missing the required label/color strings
        body: JSON.stringify({ value: "contracts" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects malformed create JSON before proxying", async () => {
    const response = await createCategory(
      createRequest("/api/document-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{bad-json",
      }),
    );

    await expectCanonicalValidationResponse(response, "Request body must be valid JSON");
    expect(mockPost).not.toHaveBeenCalled();
  });
});
