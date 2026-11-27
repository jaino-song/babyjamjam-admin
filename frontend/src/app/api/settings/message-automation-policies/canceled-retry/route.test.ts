/** @jest-environment node */
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { PUT } from "./[id]/route";
import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { get: jest.fn(), put: jest.fn() } }));
const api = jest.mocked(serverAPIClient);
const path = "/settings/message-automation-policies/canceled-retry";
const context = { params: Promise.resolve({ id: "system:service_record_link" }) };

function request(method: "GET" | "PUT", body?: unknown, authenticated = true) {
  return new NextRequest(`http://localhost/api${path}?expectedBranchId=A&branchId=B`, {
    method,
    headers: authenticated ? { cookie: "auth_token=test-token" } : {},
    body: JSON.stringify(body),
  });
}

beforeEach(() => jest.resetAllMocks());

it("forwards the authenticated catalog read with only the expected branch fence", async () => {
  const data = { routines: [], canManageActivation: false };
  api.get.mockResolvedValue({ status: 200, data });

  const response = await GET(request("GET"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  await expect(response.json()).resolves.toEqual(data);
  expect(api.get).toHaveBeenCalledWith(path, {
    headers: { Authorization: "Bearer test-token" }, params: { expectedBranchId: "A" },
  });
});

it("forwards the same fence and literal false for a persisted system rule", async () => {
  const data = { id: "system:service_record_link", enabled: false, enabledAt: null };
  api.put.mockResolvedValue({ status: 200, data });

  const response = await PUT(request("PUT", { enabled: false }), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  await expect(response.json()).resolves.toEqual(data);
  expect(api.put).toHaveBeenCalledWith(`${path}/system%3Aservice_record_link`, { enabled: false }, {
    headers: { Authorization: "Bearer test-token" }, params: { expectedBranchId: "A" },
  });
});

it("preserves the upstream rejection status for a changed branch", async () => {
  api.put.mockRejectedValue({ response: { status: 409, data: { code: "BRANCH_CONTEXT_CHANGED" } } });
  const response = await PUT(request("PUT", { enabled: true }), context);
  expect(response.status).toBe(409);
});

it("requires authentication and rejects branch data and invalid rule ids", async () => {
  expect((await GET(request("GET", undefined, false))).status).toBe(401);
  expect((await PUT(request("PUT", { enabled: true }, false), context)).status).toBe(401);
  expect((await PUT(request("PUT", { enabled: "true" }), context)).status).toBe(400);
  expect((await PUT(request("PUT", { enabled: true, branchId: "B" }), context)).status).toBe(400);
  expect((await PUT(request("PUT", { enabled: true }), { params: Promise.resolve({ id: "../config" }) })).status).toBe(400);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
});
