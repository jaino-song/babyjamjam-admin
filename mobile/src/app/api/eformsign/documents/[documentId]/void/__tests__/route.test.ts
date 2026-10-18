/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "../route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));

const mockPost = jest.mocked(serverAPIClient.post);
const params = { params: Promise.resolve({ documentId: "doc/1" }) };
const request = (authenticated = true) => new NextRequest("http://localhost/api/eformsign/documents/doc%2F1/void", {
  method: "POST",
  headers: authenticated ? { cookie: "auth_token=auth-token" } : {},
});

describe("POST /api/eformsign/documents/[documentId]/void", () => {
  beforeEach(() => mockPost.mockReset());

  it("forwards auth and the encoded ID without a body and passes through 200", async () => {
    const body = { documentId: "doc/1", voidedAt: "2026-10-14T01:02:00Z", voidedByName: "담당자", displayStatus: "voided" };
    mockPost.mockResolvedValue({ data: body, status: 200 });
    const response = await POST(request(), params);
    expect(mockPost).toHaveBeenCalledWith("/api/documents/doc%2F1/void", undefined, {
      headers: expect.objectContaining({ Authorization: "Bearer auth-token" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
  });

  it.each([false, true])("passes through the 409 problem body (thrown=%s)", async (thrown) => {
    const body = {
      type: "https://github.com/jaino-song/babyjamjam-admin/blob/main/docs/error-management.md#request-conflict",
      title: "요청을 완료할 수 없어요",
      status: 409,
      code: "REQUEST_CONFLICT",
      detail: "현재 데이터 상태와 요청이 충돌해 처리할 수 없어요.",
      error: "현재 데이터 상태와 요청이 충돌해 처리할 수 없어요.",
      outcome: "NOT_APPLIED",
      requestId: "req-void-1",
      params: {},
    };
    const upstream = { status: 409, data: body };
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      if (thrown) mockPost.mockRejectedValue({ response: upstream });
      else mockPost.mockResolvedValue(upstream);
      const response = await POST(request(), params);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual(body);
    } finally {
      log.mockRestore();
    }
  });

  it("requires auth without calling the backend", async () => {
    const response = await POST(request(false), params);
    expect(response.status).toBe(401);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
