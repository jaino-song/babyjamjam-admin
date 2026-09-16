/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/cookies";
import { getStatsView } from "@/lib/observability/stats-server";
import { GET } from "../[view]/route";

jest.mock("@/lib/auth/cookies", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/observability/stats-server", () => ({
  ...jest.requireActual("@/lib/observability/stats-server"),
  getStatsView: jest.fn(),
}));

const mockCurrentUser = getCurrentUser as jest.Mock;
const mockGetStatsView = getStatsView as jest.Mock;

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

describe("mobile stats authorization", () => {
  beforeEach(() => {
    mockCurrentUser.mockReset();
    mockGetStatsView.mockReset();
  });

  it("rejects anonymous stats reads", async () => {
    mockCurrentUser.mockResolvedValue(null);
    const response = await GET(request("/api/stats/inquiries"), { params: Promise.resolve({ view: "inquiries" }) });
    expect(response.status).toBe(401);
    expect(mockGetStatsView).not.toHaveBeenCalled();
  });

  it("fails closed for non-owner users without a branch slug", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user-1", role: "manager" });
    const response = await GET(request("/api/stats/inquiries"), { params: Promise.resolve({ view: "inquiries" }) });
    expect(response.status).toBe(403);
    expect(mockGetStatsView).not.toHaveBeenCalled();
  });

  it("fails closed for non-owner users with an invalid branch slug", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user-1", role: "manager", branchSlug: "gangnam' OR 1=1 --" });
    const response = await GET(request("/api/stats/inquiries"), { params: Promise.resolve({ view: "inquiries" }) });
    expect(response.status).toBe(403);
    expect(mockGetStatsView).not.toHaveBeenCalled();
  });

  it("keeps owner-only views behind the owner role", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user-1", role: "manager", branchSlug: "gangnam" });
    const response = await GET(request("/api/stats/traffic"), { params: Promise.resolve({ view: "traffic" }) });
    expect(response.status).toBe(403);
    expect(mockGetStatsView).not.toHaveBeenCalled();
  });

  it("passes the tenant branch scope to an inquiry read", async () => {
    mockCurrentUser.mockResolvedValue({ id: "user-1", role: "manager", branchSlug: "gangnam" });
    mockGetStatsView.mockResolvedValue({ view: "inquiries", state: "ready", availability: { posthog: "ready", sentry: "unavailable" }, data: null });
    const response = await GET(request("/api/stats/inquiries"), { params: Promise.resolve({ view: "inquiries" }) });
    expect(response.status).toBe(200);
    expect(mockGetStatsView).toHaveBeenCalledWith("inquiries", "gangnam");
  });
});
