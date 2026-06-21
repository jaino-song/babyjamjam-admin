import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AlimtalkTriggerList } from "../AlimtalkTriggerList";
import {
  useAlimtalkTriggerRules,
  useUpdateAlimtalkTriggerRule,
} from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import type { AlimtalkTriggerRule } from "@/features/alimtalk-triggers/types";
import { fetchAllAlimtalkLogs } from "@/lib/alimtalk/logs";

jest.mock("@/features/alimtalk-triggers/hooks/use-alimtalk-triggers", () => ({
  useAlimtalkTriggerRules: jest.fn(),
  useUpdateAlimtalkTriggerRule: jest.fn(),
}));

jest.mock("@/lib/alimtalk/logs", () => ({
  fetchAllAlimtalkLogs: jest.fn(),
}));

const mockUseAlimtalkTriggerRules = useAlimtalkTriggerRules as jest.Mock;
const mockUseUpdateAlimtalkTriggerRule = useUpdateAlimtalkTriggerRule as jest.Mock;
const mockFetchAllAlimtalkLogs = fetchAllAlimtalkLogs as jest.Mock;

function createRule(overrides: Partial<AlimtalkTriggerRule> = {}): AlimtalkTriggerRule {
  return {
    id: "rule-start",
    branchId: "branch-1",
    name: "실제 서비스 시작 규칙",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 1,
    recipientType: "CLIENT",
    templateKey: "SERVICE_START_REMINDER",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function currentMonthIso(day = 5) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day, 9, 0, 0).toISOString();
}

function previousMonthIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 5, 9, 0, 0).toISOString();
}

function monthLabel() {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric" }).format(new Date());
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AlimtalkTriggerList />
    </QueryClientProvider>,
  );
}

describe("AlimtalkTriggerList", () => {
  const updateMutate = jest.fn();

  beforeEach(() => {
    updateMutate.mockClear();
    mockFetchAllAlimtalkLogs.mockResolvedValue([]);
    mockUseUpdateAlimtalkTriggerRule.mockReturnValue({
      isPending: false,
      mutate: updateMutate,
    });
    mockUseAlimtalkTriggerRules.mockReturnValue({
      data: [],
      isError: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders only actual trigger rules instead of fallback rows", async () => {
    mockUseAlimtalkTriggerRules.mockReturnValue({
      data: [createRule()],
      isError: false,
      isLoading: false,
    });
    mockFetchAllAlimtalkLogs.mockResolvedValue([
      {
        id: 1,
        templateKey: "SERVICE_START_REMINDER",
        status: "sent",
        createdAt: currentMonthIso(5),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
      {
        id: 2,
        templateKey: "SERVICE_START_REMINDER",
        status: "failed",
        createdAt: currentMonthIso(6),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
      {
        id: 3,
        templateKey: "CLIENT_WELCOME",
        status: "sent",
        createdAt: currentMonthIso(6),
        ruleId: "rule-client",
        ruleName: "다른 규칙",
        eventType: "CLIENT_CREATED",
      },
      {
        id: 4,
        templateKey: "SERVICE_START_REMINDER",
        status: "sent",
        createdAt: previousMonthIso(),
        ruleId: "rule-start",
        ruleName: "실제 서비스 시작 규칙",
        eventType: "SERVICE_START",
      },
    ]);

    renderPage();

    expect(screen.getByText("신규 고객 인사 SMS")).toBeInTheDocument();
    expect(screen.getByText("실제 서비스 시작 규칙")).toBeInTheDocument();
    expect(screen.queryByText("고객 등록 환영")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(`${monthLabel()} 2건`)).toBeInTheDocument();
    });
    expect(screen.getByText("서비스 시작 1일 전 · 고객")).toBeInTheDocument();
  });

  it("updates the selected real rule when the toggle row is pressed", async () => {
    mockUseAlimtalkTriggerRules.mockReturnValue({
      data: [createRule({ isActive: true })],
      isError: false,
      isLoading: false,
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /실제 서비스 시작 규칙/ }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: "rule-start",
      dto: { isActive: false },
    });
  });

  it("renders the service information trigger seven days before service start", async () => {
    mockUseAlimtalkTriggerRules.mockReturnValue({
      data: [
        createRule({
          id: "rule-service-info",
          name: "서비스 시작 7일 전 서비스 안내",
          offsetDays: 7,
          templateKey: "SERVICE_INFO",
        }),
      ],
      isError: false,
      isLoading: false,
    });

    renderPage();

    expect(screen.getByText("서비스 시작 7일 전 서비스 안내")).toBeInTheDocument();
    expect(screen.getByText("서비스 시작 7일 전 · 고객")).toBeInTheDocument();
    const serviceInfoRow = screen.getByRole("button", { name: /서비스 시작 7일 전 서비스 안내/ });
    expect(serviceInfoRow).toHaveAttribute("data-trigger-channel", "SMS");
    expect(serviceInfoRow.querySelector('[data-component="alimtalk-trigger-icon"]'))
      .toHaveClass("trigger-icon-primary");
    expect(serviceInfoRow.querySelector("svg")).toHaveClass("lucide-message-square-text");
  });

  it("shows the UI-only SMS greeting trigger when no real trigger rule exists", () => {
    renderPage();

    expect(screen.getByText("신규 고객 인사 SMS")).toBeInTheDocument();
    expect(screen.getByText("고객 등록 즉시 · 고객 번호")).toBeInTheDocument();
    expect(screen.queryByText("서비스 종료 안내")).not.toBeInTheDocument();
  });

  it("does not call the live rule mutation when the UI-only SMS trigger is pressed", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /신규 고객 인사 SMS/ }));

    expect(updateMutate).not.toHaveBeenCalled();
  });
});
