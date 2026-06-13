import { fireEvent, render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TriggerRulesManager } from "../TriggerRulesManager";
import {
  useAlimtalkTriggerRules,
  useAlimtalkTriggerTemplates,
  useCreateAlimtalkTriggerRule,
  useDeleteAlimtalkTriggerRule,
  useUpdateAlimtalkTriggerRule,
} from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
}));

jest.mock("@/components/app/v3", () => {
  const React = jest.requireActual("react");
  const actual = jest.requireActual("@/components/app/v3");

  return {
    ...actual,
    SplitLayout: ({
      children,
      hasSelection,
      onBack,
      onModeChange,
    }: {
      children: ReactNode;
      hasSelection?: boolean;
      onBack?: () => void;
      onModeChange?: (mode: "desktop" | "compact") => void;
    }) => {
      React.useLayoutEffect(() => {
        onModeChange?.("compact");
      }, [onModeChange]);

      return React.createElement(
        "div",
        {
          "data-component": "split-layout",
          "data-mode": "compact",
          "data-has-selection": hasSelection ? "true" : "false",
        },
        hasSelection
          ? React.createElement(
              "button",
              {
                type: "button",
                onClick: onBack,
              },
              "목록으로 돌아가기",
            )
          : null,
        children,
      );
    },
  };
});

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

jest.mock("@/features/alimtalk-triggers/hooks/use-alimtalk-triggers", () => ({
  useAlimtalkTriggerRules: jest.fn(),
  useAlimtalkTriggerTemplates: jest.fn(),
  useCreateAlimtalkTriggerRule: jest.fn(),
  useUpdateAlimtalkTriggerRule: jest.fn(),
  useDeleteAlimtalkTriggerRule: jest.fn(),
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseAlimtalkTriggerRules = jest.mocked(useAlimtalkTriggerRules);
const mockedUseAlimtalkTriggerTemplates = jest.mocked(useAlimtalkTriggerTemplates);
const mockedUseCreateAlimtalkTriggerRule = jest.mocked(useCreateAlimtalkTriggerRule);
const mockedUseUpdateAlimtalkTriggerRule = jest.mocked(useUpdateAlimtalkTriggerRule);
const mockedUseDeleteAlimtalkTriggerRule = jest.mocked(useDeleteAlimtalkTriggerRule);

type QueryOptions = {
  queryKey?: readonly unknown[];
};

interface SettingsQueryState {
  providerEnabled?: boolean;
  senderApproved?: boolean;
}

function useQueryResult<TData>(data: TData, isLoading = false): ReturnType<typeof useQuery> {
  return {
    data,
    isLoading,
  } as unknown as ReturnType<typeof useQuery>;
}

function mockSettingsQueries({
  providerEnabled = false,
  senderApproved = false,
}: SettingsQueryState = {}) {
  mockedUseQuery.mockImplementation((options: QueryOptions) => {
    const queryKey = options.queryKey ?? [];

    if (queryKey.includes("message-sender-approval")) {
      return useQueryResult({
        approvalStatus: senderApproved ? "approved" : "not_requested",
        isApproved: senderApproved,
        canRequest: !senderApproved,
        requestedAt: null,
        approvedAt: senderApproved ? "2026-06-05T00:00:00.000Z" : null,
      });
    }

    return useQueryResult({
      provider: "aligo",
      enabled: providerEnabled,
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1200,
  });

  mockSettingsQueries();

  mockedUseAlimtalkTriggerRules.mockReturnValue({
    data: [
      {
        id: "rule-1",
        branchId: "org-1",
        name: "서비스 시작 안내",
        isActive: true,
        eventType: "SERVICE_START",
        offsetType: "BEFORE_DAYS",
        offsetDays: 3,
        recipientType: "CLIENT",
        templateKey: "SERVICE_START_REMINDER",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useAlimtalkTriggerRules>);

  mockedUseAlimtalkTriggerTemplates.mockReturnValue({
    data: [
      {
        key: "SERVICE_START_REMINDER",
        name: "서비스 시작 리마인더",
        description: "서비스 시작 전에 안내합니다.",
        allowedEventTypes: ["SERVICE_START"],
        allowedRecipientTypes: ["CLIENT"],
        requiredVariables: [],
        providers: {
          aligo: { templateKey: "tmpl_1" },
        },
      },
    ],
  } as unknown as ReturnType<typeof useAlimtalkTriggerTemplates>);

  mockedUseCreateAlimtalkTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useCreateAlimtalkTriggerRule>);

  mockedUseUpdateAlimtalkTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useUpdateAlimtalkTriggerRule>);

  mockedUseDeleteAlimtalkTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useDeleteAlimtalkTriggerRule>);
});

describe("TriggerRulesManager", () => {
  it("keeps the trigger detail panel empty and blocks the rules list before approval", () => {
    const { container } = render(<TriggerRulesManager />);

    expect(screen.queryByRole("button", { name: "새 규칙" })).not.toBeInTheDocument();

    const activeTab = screen.getByRole("button", { name: "활성화" });
    expect(activeTab).toBeDisabled();

    fireEvent.click(activeTab);

    expect(container.querySelector('[data-component="list-panel-disabled-overlay"]')).toBeInTheDocument();
    expect(
      screen.getAllByText("메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요."),
    ).toHaveLength(2);
    expect(container.querySelector('[data-component="detail-panel-scroll-content"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "알림톡 발송 신청하기" })).not.toBeInTheDocument();
  });

  it("keeps trigger rules available when message sending is approved even if provider settings are disabled", () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });

    const { container } = render(<TriggerRulesManager />);

    expect(screen.getByRole("button", { name: "새 규칙" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "활성화" })).toBeEnabled();
    expect(container.querySelector('[data-component="list-panel-disabled-overlay"]')).not.toBeInTheDocument();
    expect(
      screen.queryByText("메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요."),
    ).not.toBeInTheDocument();
  });

  it("does not preselect the first rule in compact split layout", async () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });

    const { container } = render(<TriggerRulesManager />);
    window.dispatchEvent(new Event("resize"));

    expect(
      await screen.findByText("왼쪽 목록에서 규칙을 선택하거나 새 규칙을 만들어 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByText("규칙 활성화")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="split-layout"]')).toHaveAttribute("data-has-selection", "false");
  });
});
