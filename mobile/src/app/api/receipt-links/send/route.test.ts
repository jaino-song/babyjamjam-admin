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

function createRequest(body: unknown) {
  return new NextRequest("http://localhost/api/receipt-links/send", {
    method: "POST",
    headers: { cookie: "auth_token=token-1" },
    body: JSON.stringify(body),
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
});
