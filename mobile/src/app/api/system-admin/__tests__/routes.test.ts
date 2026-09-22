/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET as getBranches } from "../branch-requests/route";
import { POST as approveSender } from "../branch-requests/[branchId]/message-sender-approval/approve/route";
import { PATCH as updateBranch } from "../branches/[branchId]/route";
import { GET as getUsers } from "../../users/route";
import { POST as approveUser } from "../../users/[id]/approve/route";
import { PATCH as updateAccount } from "../../users/[id]/account-assignment/route";

jest.mock("@/lib/api/server", () => ({
  serverAPIClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;

function request(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: init.method,
    headers: {
      ...(init.auth === false ? {} : { cookie: "auth_token=owner-token" }),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("mobile owner administration proxies", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("requires authentication before reading branches", async () => {
    const response = await getBranches(request("/api/system-admin/branch-requests", { auth: false }));
    expect(response.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("forwards branch reads with the owner bearer token", async () => {
    mockGet.mockResolvedValue({ status: 200, data: [{ id: "branch-1" }] });
    const response = await getBranches(request("/api/system-admin/branch-requests"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "branch-1" }]);
    expect(mockGet).toHaveBeenCalledWith("/system-admin/branch-requests", { headers: { Authorization: "Bearer owner-token" } });
  });

  it("preserves branch update path encoding and body", async () => {
    const body = { name: "새 지점", slug: "new-branch", isActive: true };
    mockPatch.mockResolvedValue({ status: 200, data: body });
    await updateBranch(request("/api/system-admin/branches/branch%2F1", { method: "PATCH", body }), { params: Promise.resolve({ branchId: "branch/1" }) });
    expect(mockPatch).toHaveBeenCalledWith("/system-admin/branches/branch%2F1", body, { headers: { Authorization: "Bearer owner-token" } });
  });

  it("uses the sender approval backend contract", async () => {
    mockPost.mockResolvedValue({ status: 200, data: { approvalStatus: "approved" } });
    await approveSender(request("/api/system-admin/branch-requests/branch-1/message-sender-approval/approve", { method: "POST" }), { params: Promise.resolve({ branchId: "branch-1" }) });
    expect(mockPost).toHaveBeenCalledWith("/settings/message-sender-approval/branch-1/approve", {}, { headers: { Authorization: "Bearer owner-token" } });
  });

  it("forwards account assignment and pending approval endpoints", async () => {
    mockGet.mockResolvedValue({ status: 200, data: [] });
    mockPost.mockResolvedValue({ status: 204, data: null });
    mockPatch.mockResolvedValue({ status: 204, data: null });
    const usersResponse = await getUsers(request("/api/users"));
    expect(usersResponse.status).toBe(200);
    await approveUser(request("/api/users/user%2F1/approve", { method: "POST", body: { role: "manager", branchId: "branch-1" } }), { params: Promise.resolve({ id: "user/1" }) });
    await updateAccount(request("/api/users/user%2F1/account-assignment", { method: "PATCH", body: { role: "manager", branchIds: ["branch-1"], expectedRole: "user", expectedBranchIds: [] } }), { params: Promise.resolve({ id: "user/1" }) });
    expect(mockPost).toHaveBeenCalledWith("/users/user%2F1/approve", { role: "manager", branchId: "branch-1" }, { headers: { Authorization: "Bearer owner-token" } });
    expect(mockPatch).toHaveBeenCalledWith("/users/user%2F1/account-assignment", { role: "manager", branchIds: ["branch-1"], expectedRole: "user", expectedBranchIds: [] }, { headers: { Authorization: "Bearer owner-token" } });
  });
});
