import fs from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { settingsApi } from "@/services/api";

import SettingsPage from "./page";

let mockDocumentJobsActive = false;
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => {
  const actual = jest.requireActual("@/features/document-jobs/DocumentJobsProvider");
  return {
    ...actual,
    useDocumentJobs: () => ({
      ...actual.useDocumentJobs(),
      summary: { activeCount: mockDocumentJobsActive ? 1 : 0, unresolvedCount: 0 },
      total: mockDocumentJobsActive ? 1 : 0,
      unresolvedCount: 0,
    }),
  };
});

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

describe("SettingsPage profile query states", () => {
  const refetch = jest.fn();
  function renderProfile(overrides: Record<string, unknown>) {
    mockedUseGetAuthUser.mockReturnValue({
      data: undefined, isLoading: false, isPending: false, isPaused: false,
      isError: false, isFetching: false, status: "success", fetchStatus: "idle", refetch,
      ...overrides,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { ...render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>), client };
  }
  beforeEach(() => refetch.mockClear());

  it.each([false, true])("renders a first-child jobs-only row only when active: %s", (active) => {
    mockDocumentJobsActive = active;
    const { container, unmount } = renderProfile({ data: { id: "user-1", name: "테스터" } });
    const row = container.querySelector('[data-component="desktop_settings_sections_stats"]');
    if (active) {
      expect(row?.parentElement?.firstElementChild).toBe(row);
      expect(row?.firstElementChild).toBe(screen.getByRole("button", { name: "전자문서 처리중 작업 보기" }));
      expect(row?.children).toHaveLength(1);
    } else {
      expect(row).not.toBeInTheDocument();
    }
    unmount();
    mockDocumentJobsActive = false;
  });

  it.each([
    { isLoading: true, isPending: true, status: "pending", isFetching: true, fetchStatus: "fetching" },
    { isLoading: false, isPending: true, isPaused: true, isError: false, isFetching: false, status: "pending", fetchStatus: "paused" },
  ])("shows the profile skeleton without placeholders: %j", (state) => {
    const { container } = renderProfile(state);
    expect(container.querySelector('[data-component$="_profile-summary-loading"]')).toBeInTheDocument();
    expect(screen.queryByText("사용자")).not.toBeInTheDocument();
    expect(screen.queryByText("-")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces failed unknown profile placeholders with an inline retry", () => {
    renderProfile({ isError: true, status: "error" });
    expect(screen.getByRole("alert")).toHaveTextContent("내 정보를 불러오지 못했습니다");
    expect(screen.queryByText("사용자")).not.toBeInTheDocument();
    expect(screen.queryByText("-")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { isError: true, status: "error" }, { isPaused: true, fetchStatus: "paused" }])("keeps loaded profile without a notice: %j", (state) => {
    renderProfile({ data: { name: "직원", email: "staff@example.test", phone: "010-0000-0000", branchName: "지점", role: "user" }, ...state });
    expect(screen.getByText("직원", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("staff@example.test")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    { data: null },
    { data: null, isError: true, status: "error" },
    { data: null, isPaused: true, fetchStatus: "paused" },
    { data: undefined, isPending: true, status: "pending", fetchStatus: "idle" },
  ])("keeps successful null and disabled placeholders unchanged: %j", (state) => {
    renderProfile(state);
    expect(screen.getByText("사용자")).toBeInTheDocument();
    expect(screen.getAllByText("-")).toHaveLength(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps flag-off email disabled without a load-failure alert", async () => {
    jest.mocked(settingsApi.getNotificationPreferences).mockRejectedValueOnce(new Error("load failed"));
    const { client } = renderProfile({ data: { name: "직원", role: "user" } });
    fireEvent.click(screen.getAllByRole("button", { name: "알림" })[0]);
    await waitFor(() => expect(screen.getByRole("switch", { name: "이메일 알림" })).toBeDisabled());
    // Wait for the query to settle, not merely the build-time disabled switch.
    await waitFor(() => expect(client.getQueryState(["settings", "notification-preferences"])?.status).toBe("error"));
    expect(screen.getByRole("switch", { name: "이메일 알림" })).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("이메일 알림은 현재 비활성화되어 있습니다.")).toBeInTheDocument();
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
