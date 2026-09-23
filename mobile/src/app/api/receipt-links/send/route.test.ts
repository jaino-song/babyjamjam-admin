/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    post: jest.fn(),
  },
}));

const mockPost = serverAPIClient.post as jest.Mock;

function createRequest(body: unknown, authenticated = true) {
  return new NextRequest("http://localhost/api/receipt-links/send", {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    body: JSON.stringify(body),
  });
}

function createRawRequest(rawBody: string, authenticated = true) {
  return new NextRequest("http://localhost/api/receipt-links/send", {
    method: "POST",
    headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    body: rawBody,
  });
}

describe("POST /api/receipt-links/send", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("forwards the prepared document with client identity pins", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { jobId: "job-1", clientName: "김산모" },
    });

    const response = await POST(createRequest({
      documentId: "doc-1",
      clientId: 7,
      recipientPhone: "01012345678",
    }));

    expect(response.status).toBe(202);
    expect(mockPost).toHaveBeenCalledWith(
      "/receipt-links/send",
      {
        documentId: "doc-1",
        clientId: 7,
        recipientPhone: "01012345678",
      },
      { headers: { Authorization: "Bearer token-1" } },
    );
  });

  it("rejects unauthenticated requests before forwarding", async () => {
    const response = await POST(createRequest({ documentId: "doc-1" }, false));

    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects invalid identity pins before forwarding", async () => {
    const response = await POST(createRequest({
      documentId: "doc-1",
      clientId: 0,
      recipientPhone: "",
    }));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with a 400 problem and never calls the backend", async () => {
    const response = await POST(createRawRequest("{not-valid-json"));

    expect(response.status).toBe(400);
    expect(mockPost).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.status).toBe(400);
    expect(body.error).toBe("Request body must be valid JSON");
  });
});
