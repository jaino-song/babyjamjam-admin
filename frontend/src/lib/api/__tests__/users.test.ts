import { api } from "@/lib/api/client";

import { approveUser, updateUserSmsAutomation } from "../users";

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

const mockPost = api.post as jest.Mock;
const mockPatch = api.patch as jest.Mock;

describe("users api sms automation", () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ data: {} });
    mockPatch.mockReset().mockResolvedValue({ data: {} });
  });

  it("posts the approval flag when it is provided", async () => {
    await approveUser("user-1", "manager", "branch-1", undefined, false);

    expect(mockPost).toHaveBeenCalledWith("/users/user-1/approve", {
      role: "manager",
      branchId: "branch-1",
      smsAutomationEnabled: false,
    });
  });

  it("sends no smsAutomationEnabled key when the argument is omitted", async () => {
    await approveUser("user-1", "manager", "branch-1");

    const body = mockPost.mock.calls[0][1];
    expect(body).toEqual({ role: "manager", branchId: "branch-1" });
    expect(body).not.toHaveProperty("smsAutomationEnabled");
  });

  it("patches the encoded sms-automation path with { enabled }", async () => {
    await updateUserSmsAutomation("a b", true);

    expect(mockPatch).toHaveBeenCalledWith("/users/a%20b/sms-automation", { enabled: true });
  });
});
