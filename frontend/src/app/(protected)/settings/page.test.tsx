import fs from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";

import SettingsPage from "./page";

jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: jest.fn() }));
jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({
    isSupported: false,
    isSubscribed: false,
    permission: "default",
    isLoading: false,
    error: null,
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  }),
}));
jest.mock("@/services/api", () => ({
  settingsApi: {
    getNotificationPreferences: jest.fn().mockResolvedValue({ emailNotificationsEnabled: true }),
    updateNotificationPreferences: jest.fn(),
  },
}));
jest.mock("@/features/auth/settings/kakao-link-result-modal", () => ({
  KakaoLinkResultModal: () => null,
}));
jest.mock("@/components/app/call-ingest-tokens/CallIngestTokenSection", () => ({
  CallIngestTokenSection: () => <div>call-ingest-section</div>,
}));
jest.mock("@/components/app/notifications/SendNotificationSection", () => ({
  SendNotificationSection: () => <div>send-notification-section</div>,
}));
jest.mock("@/components/app/holidays/HolidaySettingsSection", () => ({
  HolidaySettingsSection: ({ branchId, branchName }: { branchId: string; branchName?: string | null }) => (
    <div>{`holiday-section ${branchId} ${branchName ?? ""}`}</div>
  ),
}));

const mockedUseGetAuthUser = useGetAuthUser as jest.Mock;

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
    // key={branchId} forces a remount (and thus a draft reset) on branch
    // switch — see SendNotificationSection's own key={branchId} contract.
    expect(source).toContain("<SendNotificationSection key={branchId} branchId={branchId} />");
    expect(source).toContain("<SendNotificationBranchRequired />");

    // Pin which arm is which, the same way the call-ingest-tokens test above
    // guards against an inverted ternary.
    const gate = source.slice(source.indexOf('activeSection === "send-notification" && canManageBranchSettings'));
    const truthyArm = gate.indexOf("<SendNotificationSection key={branchId} branchId={branchId} />");
    const falsyArm = gate.indexOf("<SendNotificationBranchRequired />");
    expect(gate).toContain("branchId ? (");
    expect(truthyArm).toBeGreaterThan(-1);
    expect(falsyArm).toBeGreaterThan(truthyArm);
  });
});

// Behavioral check of the 공휴일 nav entry: shown to branch managers (admin,
// manager, global owner), hidden from a plain member.
describe("SettingsPage holidays section", () => {
  function renderPage(user: Record<string, unknown>) {
    mockedUseGetAuthUser.mockReturnValue({ data: user, isPending: false, isLoading: false, isFetching: false, isError: false });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>,
    );
  }

  it.each([
    ["branch manager", { role: "user", branchRole: "manager" }],
    ["branch admin", { role: "user", branchRole: "admin" }],
    ["global owner", { role: "owner", branchRole: null }],
  ])("offers 공휴일 to a %s and opens the section for the active branch", (_label, authority) => {
    renderPage({ ...authority, name: "관리자", branchId: "branch-1", branchName: "인천 남동지점" });

    const navButtons = screen.getAllByRole("button", { name: "공휴일" });
    expect(navButtons.length).toBeGreaterThan(0);

    fireEvent.click(navButtons[0]);
    expect(screen.getByText("holiday-section branch-1 인천 남동지점")).toBeInTheDocument();
  });

  it("explains itself instead of an empty panel when the manager has no branch", () => {
    renderPage({ role: "owner", branchRole: null, name: "대표", branchId: null });

    fireEvent.click(screen.getAllByRole("button", { name: "공휴일" })[0]);
    expect(screen.getByText(/상단에서 지점을 먼저 선택해 주세요/)).toBeInTheDocument();
    expect(screen.queryByText(/holiday-section/)).not.toBeInTheDocument();
  });

  it("hides 공휴일 from a plain branch member", () => {
    renderPage({ role: "user", branchRole: "member", name: "직원", branchId: "branch-1", branchName: "인천 남동지점" });

    expect(screen.queryByRole("button", { name: "공휴일" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "통화 수집 토큰" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "계정" }).length).toBeGreaterThan(0);
  });
});
