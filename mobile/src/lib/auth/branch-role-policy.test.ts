import { canManageBranch } from "./branch-role-policy";

describe("canManageBranch", () => {
  it.each([
    [{ role: "owner", branchRole: null }, true],
    [{ role: "owner", branchRole: "user" }, true],
    [{ role: "admin", branchRole: "admin" }, true],
    [{ role: "user", branchRole: "admin" }, true],
    [{ role: "user", branchRole: "manager" }, true],
  ])("allows %j when the active branch role is authoritative", (user, expected) => {
    expect(canManageBranch(user)).toBe(expected);
  });

  it.each([
    { role: "admin", branchRole: "user" },
    { role: "manager", branchRole: "user" },
    { role: "admin" },
    { role: "manager" },
    { role: "user" },
    null,
    undefined,
  ])("denies %j without an allowed active branch role", (user) => {
    expect(canManageBranch(user)).toBe(false);
  });
});
