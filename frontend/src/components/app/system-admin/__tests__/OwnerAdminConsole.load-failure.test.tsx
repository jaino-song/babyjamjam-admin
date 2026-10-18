import { fireEvent, render, screen, within } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { OwnerAdminConsole } from "../OwnerAdminConsole";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

const branch = {
  id: "branch-1", name: "테스트 지점", slug: "test", region: "서울", district: "강남구",
  address: null, phone: null, email: null, isActive: true,
  createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z",
  owner: null,
  messageSenderApproval: {
    approvalStatus: "not_requested", requestedAt: null, approvedAt: null, requestedBy: null,
  },
};
const account = {
  id: "account-1", name: "테스트 계정", email: "test@example.com", phone: "010-1234-5678",
  birthDate: "19900101", role: "owner", authProvider: "email", emailVerified: true,
  approvalStatus: "approved", requestedRole: "owner", branches: [],
  createdAt: "2026-06-01T00:00:00.000Z",
};

function success(data: unknown) {
  return {
    data, error: null as Error | null, isLoading: false, isPending: false,
    isError: false, isFetching: false, isPaused: false,
    status: "success", fetchStatus: "idle", refetch: jest.fn(),
  };
}

let queries: Record<string, ReturnType<typeof success>>;
const cases = [
  { section: "branches", key: "systemAdminBranchRequests", otherKey: "systemAdminUsers",
    title: "지점 정보를 불러오지 못했습니다", empty: "등록된 지점이 없습니다.",
    row: "테스트 지점", data: [branch], otherSectionLabel: "계정 관리", otherRow: "테스트 계정" },
  { section: "accounts", key: "systemAdminUsers", otherKey: "systemAdminBranchRequests",
    title: "계정 정보를 불러오지 못했습니다", empty: "등록된 계정이 없습니다.",
    row: "테스트 계정", data: [account], otherSectionLabel: "지점 관리", otherRow: "테스트 지점" },
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  queries = {
    systemAdminUsers: success([account]),
    systemAdminBranchRequests: success([branch]),
  };
  jest.mocked(useQuery).mockImplementation(({ queryKey }) =>
    queries[String(queryKey[0])] as unknown as ReturnType<typeof useQuery>);
  jest.mocked(useQueryClient).mockReturnValue({
    invalidateQueries: jest.fn(),
  } as unknown as ReturnType<typeof useQueryClient>);
  jest.mocked(useMutation).mockReturnValue({
    mutate: jest.fn(), isPending: false, reset: jest.fn(),
  } as unknown as ReturnType<typeof useMutation>);
});

function list(container: HTMLElement) {
  return container.querySelector('[data-component="desktop_system-admin_sections_split-layout_list-panel"]') as HTMLElement;
}

function stats(container: HTMLElement) {
  return within(container.querySelector('[data-component="desktop_system-admin_sections_sections_stats"]') as HTMLElement);
}

function expectUnknownStats(container: HTMLElement) {
  expect(stats(container).getAllByText("—")).toHaveLength(4);
  expect(stats(container).queryByText("0")).not.toBeInTheDocument();
}

describe.each(cases)("OwnerAdminConsole $section query states", (testCase) => {
  it("shows a no-data failure panel and retries only its own query", () => {
    queries[testCase.key] = {
      ...success(undefined), error: new Error("load failed"), isError: true, status: "error",
    };
    const { container, rerender } = render(<OwnerAdminConsole initialSectionId={testCase.section} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-size", "panel");
    expect(within(alert).getByText(testCase.title)).toBeInTheDocument();
    expect(screen.queryByText(testCase.empty)).not.toBeInTheDocument();
    expectUnknownStats(container);
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(queries[testCase.key].refetch).toHaveBeenCalledTimes(1);
    expect(queries[testCase.otherKey].refetch).not.toHaveBeenCalled();

    queries[testCase.key] = {
      ...success(undefined), isPending: true, isLoading: true, isFetching: true,
      status: "pending", fetchStatus: "fetching",
    };
    rerender(<OwnerAdminConsole initialSectionId={testCase.section} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(list(container).querySelectorAll('[data-component$="_text-skeleton"]')).toHaveLength(5);
    expectUnknownStats(container);

    fireEvent.click(screen.getAllByRole("button", { name: testCase.otherSectionLabel })[0]);
    expect(within(list(container)).getByText(testCase.otherRow)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(stats(container).getAllByText("1").length).toBeGreaterThan(0);
  });

  it.each(["loading", "paused"])("shows existing skeleton rows for a no-data %s query", (state) => {
    queries[testCase.key] = {
      ...success(undefined), isPending: true, status: "pending",
      isLoading: state === "loading", isFetching: state === "loading",
      isPaused: state === "paused", fetchStatus: state === "paused" ? "paused" : "fetching",
    };
    const { container } = render(<OwnerAdminConsole initialSectionId={testCase.section} />);
    expect(list(container).querySelectorAll('[data-component$="_text-skeleton"]')).toHaveLength(5);
    expect(screen.queryByText(testCase.empty)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expectUnknownStats(container);
  });

  it("shows successful empty data as empty with four real zero stats", () => {
    queries[testCase.key] = success([]);
    const { container } = render(<OwnerAdminConsole initialSectionId={testCase.section} />);
    expect(screen.getByText(testCase.empty)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(stats(container).getAllByText("0")).toHaveLength(4);
    expect(stats(container).queryByText("—")).not.toBeInTheDocument();
  });

  it("leaves an idle pending query's list behaviour unchanged (not paused)", () => {
    // Neither production query is disabled; exercise the idle flags to prevent an isPending-only guard.
    queries[testCase.key] = { ...success(undefined), isPending: true, status: "pending" };
    const { container } = render(<OwnerAdminConsole initialSectionId={testCase.section} />);
    expect(screen.getByText(testCase.empty)).toBeInTheDocument();
    expect(list(container).querySelector('[data-component$="_text-skeleton"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps successful records and stats (paused refetch=%s)", (paused) => {
    queries[testCase.key] = {
      ...success(testCase.data), isPaused: paused, fetchStatus: paused ? "paused" : "idle",
    };
    const { container } = render(<OwnerAdminConsole initialSectionId={testCase.section} />);
    expect(within(list(container)).getByText(testCase.row)).toBeInTheDocument();
    expect(list(container).querySelector('[data-component$="_text-skeleton"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(stats(container).getAllByText("1").length).toBeGreaterThan(0);
    expect(stats(container).queryByText("—")).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps cached data (empty=%s) with exactly one inline notice", (empty) => {
    queries[testCase.key] = {
      ...success(empty ? [] : testCase.data), error: new Error("refetch failed"),
      isError: true, status: "error",
    };
    const { container, rerender } = render(<OwnerAdminConsole initialSectionId={testCase.section} />);
    const alert = screen.getByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(within(alert).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();
    const content = within(list(container)).getByText(empty ? testCase.empty : testCase.row);
    expect(alert.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stats(container).getAllByText("0")).toHaveLength(empty ? 4 : testCase.section === "accounts" ? 2 : 3);
    expect(stats(container).queryByText("—")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(queries[testCase.key].refetch).toHaveBeenCalledTimes(1);
    expect(queries[testCase.otherKey].refetch).not.toHaveBeenCalled();

    queries[testCase.key].isFetching = true;
    queries[testCase.key].fetchStatus = "fetching";
    rerender(<OwnerAdminConsole initialSectionId={testCase.section} />);
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(within(list(container)).getByText(empty ? testCase.empty : testCase.row)).toBeInTheDocument();
  });
});
