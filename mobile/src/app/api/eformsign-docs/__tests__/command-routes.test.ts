/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { POST as createEformsignDoc } from "../route";
import { POST as dispatchHeadless } from "../dispatch-headless/route";
import { POST as finalizeHeadless } from "../finalize-headless/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(path: string, body: BodyInit): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: "auth_token=auth-token",
    },
    body,
  });
}

describe("eformsign-docs command API routes", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("preserves backend status and payload when creating eformsign doc records", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { queued: true },
    });

    const response = await createEformsignDoc(
      createRequest("/api/eformsign-docs", JSON.stringify({ documentId: "doc-1" })),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ queued: true });
  });

  it("rejects malformed dispatch JSON before proxying", async () => {
    const response = await dispatchHeadless(
      createRequest("/api/eformsign-docs/dispatch-headless", "{bad-json"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON",
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("preserves backend status and payload when finalizing headless documents", async () => {
    mockPost.mockResolvedValue({
      status: 409,
      data: { error: "already finalized" },
    });

    const response = await finalizeHeadless(
      createRequest("/api/eformsign-docs/finalize-headless", JSON.stringify({ documentId: "doc-1" })),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "already finalized" });
  });
});
