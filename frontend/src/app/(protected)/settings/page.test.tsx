import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("SettingsPage account profile", () => {
  it("reads branch authority from the live auth query", () => {
    expect(source).toContain('import { useGetAuthUser } from "@/hooks/useGetAuthUser"');
    expect(source).toContain("const authUserQuery = useGetAuthUser()");
    expect(source).toContain("canManageBranchFromAuthQuery(authUserQuery)");
    expect(source).not.toContain("useGetAuthUser({ initialData:");
  });
});

// Source-level assertions, matching this file's existing convention (the page
// has no render harness here). These pin the client-side branch-management
// policy that decides what is offered; the API remains authoritative.
describe("SettingsPage call-ingest-token section gating", () => {
  it("offers the token section in the nav to branch managers", () => {
    expect(source).toContain('import { canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy"');
    expect(source).toContain(
      "const navSections = canManageBranchSettings\n    ? [...BASE_NAV_SECTIONS, ...BRANCH_MANAGER_NAV_SECTIONS]",
    );
    expect(source).toContain("const canManageBranchSettings = canManageBranchFromAuthQuery(authUserQuery)");
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

// Source-level assertions for the "알림 보내기" tab (BJJ-355), matching the
// call-ingest-tokens gating tests above: the page has no render harness here.
describe("SettingsPage send-notification tab gating", () => {
  it("offers the send-notification tab in the nav only to branch managers", () => {
    expect(source).toContain(
      'import { SendNotificationBranchRequired } from "@/components/app/notifications/SendNotificationBranchRequired"',
    );
    expect(source).toContain(
      'import { SendNotificationSection } from "@/components/app/notifications/SendNotificationSection"',
    );
    expect(source).toContain(
      "const navSections = canManageBranchSettings\n    ? [...BASE_NAV_SECTIONS, ...BRANCH_MANAGER_NAV_SECTIONS]",
    );
    expect(source).toContain('id: "send-notification"');
    expect(source).toContain('label: "알림 보내기"');
    // A plain user (canManageBranchSettings === false) never gets
    // BRANCH_MANAGER_NAV_SECTIONS merged in, so the "알림 보내기" nav entry -
    // and thus the send-notification section - is unreachable for them.
    expect(source).not.toContain('BASE_NAV_SECTIONS, "send-notification"');
  });

  it("renders the section only with a resolved branch, and explains itself without one", () => {
    expect(source).toContain('activeSection === "send-notification" && canManageBranchSettings');
    expect(source).toContain("<SendNotificationSection branchId={branchId} />");
    expect(source).toContain("<SendNotificationBranchRequired />");

    // Pin which arm is which, the same way the call-ingest-tokens test above
    // guards against an inverted ternary.
    const gate = source.slice(source.indexOf('activeSection === "send-notification" && canManageBranchSettings'));
    const truthyArm = gate.indexOf("<SendNotificationSection branchId={branchId} />");
    const falsyArm = gate.indexOf("<SendNotificationBranchRequired />");
    expect(gate).toContain("branchId ? (");
    expect(truthyArm).toBeGreaterThan(-1);
    expect(falsyArm).toBeGreaterThan(truthyArm);
  });
});
