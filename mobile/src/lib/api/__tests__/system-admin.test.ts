import { api } from "@/lib/api/client";
import { createSystemAdminBranch, updateSystemAdminBranch } from "../system-admin";

jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn(), patch: jest.fn() } }));

const input = { name: "QA 지점", slug: "qa-test", ownerId: null, isActive: false };

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
});
