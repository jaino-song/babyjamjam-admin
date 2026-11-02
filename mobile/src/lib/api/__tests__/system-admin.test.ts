import { api } from "@/lib/api/client";
import { approveSystemAdminUser, createSystemAdminBranch, updateSystemAdminBranch } from "../system-admin";

jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn(), patch: jest.fn() } }));

const input = { name: "QA 지점", slug: "qa-test", adminId: null, isActive: false };

describe("system admin branch email", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(api.post).mockResolvedValue({ data: { id: "qa-branch" } });
    jest.mocked(api.patch).mockResolvedValue({ data: { id: "qa-branch" } });
  });

  it.each(["", "   "])("creates a branch with blank optional email %j", async (email) => {
    await createSystemAdminBranch({ ...input, email });
    expect(api.post).toHaveBeenCalledWith("/system-admin/branches", { ...input, email: null });
  });

  it("clears an existing branch email instead of omitting the change", async () => {
    await updateSystemAdminBranch("qa-branch", { ...input, email: "" });
    expect(api.patch).toHaveBeenCalledWith("/system-admin/branches/qa-branch", { ...input, email: null });
  });

  it("trims a nonempty email without changing other fields", async () => {
    await updateSystemAdminBranch("qa-branch", { ...input, email: " qa@example.com " });
    expect(api.patch).toHaveBeenCalledWith("/system-admin/branches/qa-branch", { ...input, email: "qa@example.com" });
  });

  it("preserves an omitted email", async () => {
    await updateSystemAdminBranch("qa-branch", input);
    expect(api.patch).toHaveBeenCalledWith("/system-admin/branches/qa-branch", input);
  });

  it("sends adminBranchId (not the retired owner-named field) when approving a branch admin", async () => {
    await approveSystemAdminUser("user/1", "admin", "branch-1", "branch-2");
    expect(api.post).toHaveBeenCalledWith("/users/user%2F1/approve", {
      role: "admin",
      branchId: "branch-1",
      adminBranchId: "branch-2",
    });
  });

  it("omits adminBranchId when no branch is designated", async () => {
    await approveSystemAdminUser("user/1", "manager", "branch-1");
    expect(api.post).toHaveBeenCalledWith("/users/user%2F1/approve", { role: "manager", branchId: "branch-1" });
  });
});
