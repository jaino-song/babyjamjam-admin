import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("SettingsPage account profile", () => {
  it("seeds the auth query from the protected layout user", () => {
    expect(source).toContain('import { useInitialUser } from "@/providers/UserProvider"');
    expect(source).toContain("const initialUser = useInitialUser()");
    expect(source).toContain("useGetAuthUser({ initialData: initialUser })");
  });
});

// Source-level assertions, matching this file's existing convention (the page
// has no render harness here). These pin the client-side branch-management
// policy that decides what is offered; the API remains authoritative.
describe("SettingsPage call-ingest-token section gating", () => {
  it("offers the token section in the nav to branch managers", () => {
    expect(source).toContain('import { canManageBranch } from "@/lib/auth/branch-role-policy"');
    expect(source).toContain(
      "const navSections = canManageBranchSettings\n    ? [...BASE_NAV_SECTIONS, ...BRANCH_MANAGER_NAV_SECTIONS]",
    );
    expect(source).toContain("const canManageBranchSettings = canManageBranch(user)");
    expect(source).toContain('id: "call-ingest-tokens"');
  });

  it("renders the section only with a resolved branch, and explains itself without one", () => {
    expect(source).toContain('activeSection === "call-ingest-tokens" && canManageBranchSettings');
    expect(source).toContain("<CallIngestTokenSection branchId={branchId} />");
    // An owner with no selected branch reaches the section (the nav entry is
    // owner-gated, not branch-gated) and must get an explanation, not a blank
    // panel. The copy itself lives in CallIngestTokenBranchRequired — the page
    // must not carry visual styling (ui-architecture/no-visual-tailwind-in-pages).
    expect(source).toContain("<CallIngestTokenBranchRequired />");

    // Pin which arm is which. Every assertion above still holds if the ternary's
    // arms are swapped — i.e. if the section renders when branchId is ABSENT and
    // the "select a branch first" component shows when it is present. Assert the
    // order the arms actually appear in, so an inversion fails here.
    const gate = source.slice(source.indexOf('activeSection === "call-ingest-tokens" && canManageBranchSettings'));
    const truthyArm = gate.indexOf("<CallIngestTokenSection branchId={branchId} />");
    const falsyArm = gate.indexOf("<CallIngestTokenBranchRequired />");
    expect(gate).toContain("branchId ? (");
    expect(truthyArm).toBeGreaterThan(-1);
    expect(falsyArm).toBeGreaterThan(truthyArm);
  });
});
