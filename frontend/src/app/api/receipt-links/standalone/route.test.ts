/**
 * @jest-environment node
 */
import { AxiosError, AxiosHeaders } from "axios";
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { POST } from "./route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));

const post = jest.mocked(serverAPIClient.post);
const body = { clientId: 7, copaymentReceivedDate: "2026-11-21", requestId: "a9011111-b222-4333-9444-555555555555" };

function request({ cookie = "auth_token=test-session; selected_branch_id=qa", branch = "qa", payload = JSON.stringify(body) } = {}) {
  return new NextRequest("http://localhost/api/receipt-links/standalone", {
    method: "POST",
    headers: { cookie, "X-Expected-Branch-Id": branch, "Content-Type": "application/json" },
    body: payload,
  });
}

function upstreamRefusal(status: number, data: unknown) {
  return new AxiosError("rejected", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    data,
    statusText: "Rejected",
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

beforeEach(() => post.mockReset());

it("forwards only the standalone payload with the session JWT and returns the queue acknowledgement", async () => {
  const queued = { jobId: "job-1", queued: true };
  post.mockResolvedValue({ status: 200, data: queued });
  const response = await POST(request({ payload: JSON.stringify({ ...body, documentId: "ignored" }) }));

  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith("/receipt-links/standalone", body, {
    headers: { Authorization: "Bearer test-session" },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(queued);
});

it.each([
  [{ cookie: "" }, 401],
  [{ branch: "stale-branch" }, 403],
  [{ payload: "{" }, 400],
])("rejects an unusable session or request envelope before forwarding (%j)", async (options, status) => {
  expect((await POST(request(options))).status).toBe(status);
  expect(post).not.toHaveBeenCalled();
});

it.each([
  [400, "INVALID_RECEIVED_DATE"],
  [400, "MISSING_RECEIPT_FIELDS"],
  [403, "ACCESS_DENIED"],
  [404, "RESOURCE_NOT_FOUND"],
  [409, "REQUEST_ID_CONFLICT"],
])("preserves the public %s refusal code and detail", async (status, code) => {
  const detail = "영수증 발송 정보를 확인해 주세요.";
  post.mockRejectedValue(upstreamRefusal(status, { code, detail }));
  const response = await POST(request());
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ code, message: detail });
});

it("treats a malformed acceptance as an unknown outcome", async () => {
  post.mockResolvedValue({ status: 200, data: { queued: true } });
  expect((await POST(request())).status).toBe(502);
});

it("keeps transport failures ambiguous without returning upstream diagnostics", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    post.mockRejectedValue(upstreamRefusal(503, { message: "db.internal:5432 ECONNREFUSED" }));
    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("db.internal");
  } finally {
    log.mockRestore();
  }
});
