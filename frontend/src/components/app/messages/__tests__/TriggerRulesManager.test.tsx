import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TriggerRulesManager } from "../TriggerRulesManager";
import {
  useMessageTriggerRules,
  useMessageTriggerTemplates,
  useCreateMessageTriggerRule,
  useDeleteMessageTriggerRule,
  useUpdateMessageTriggerRule,
  useUpdateMessageTriggerRuleBranchActivation,
  useActivateMessageTriggerRuleWithParent,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { settingsApi, type MessageAutomationPoliciesResponse } from "@/services/api";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: jest.fn(),
    getMessageAutomationPolicies: jest.fn(),
    getClientRegistrationPolicy: jest.fn(),
    updateClientRegistrationPolicy: jest.fn(),
  },
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
          "data-component": "desktop_v3_tests_split-layout",
          "data-slot": "split-layout",
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

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerRules: jest.fn(),
  useMessageTriggerTemplates: jest.fn(),
  useCreateMessageTriggerRule: jest.fn(),
  useUpdateMessageTriggerRule: jest.fn(),
  useDeleteMessageTriggerRule: jest.fn(),
  useUpdateMessageTriggerRuleBranchActivation: jest.fn(),
  useActivateMessageTriggerRuleWithParent: jest.fn(),
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseMutation = jest.mocked(useMutation);
const mockedUseQueryClient = jest.mocked(useQueryClient);
const mockedUseMessageTriggerRules = jest.mocked(useMessageTriggerRules);
const mockedUseMessageTriggerTemplates = jest.mocked(useMessageTriggerTemplates);
const mockedUseCreateMessageTriggerRule = jest.mocked(useCreateMessageTriggerRule);
const mockedUseUpdateMessageTriggerRule = jest.mocked(useUpdateMessageTriggerRule);
const mockedUseDeleteMessageTriggerRule = jest.mocked(useDeleteMessageTriggerRule);
const mockedUseUpdateMessageTriggerRuleBranchActivation = jest.mocked(useUpdateMessageTriggerRuleBranchActivation);
const mockedUseActivateMessageTriggerRuleWithParent = jest.mocked(useActivateMessageTriggerRuleWithParent);
const mockedSettingsApi = jest.mocked(settingsApi);

const mockInvalidateQueries = jest.fn();
const mockSetQueryData = jest.fn();
const mockCancelQueries = jest.fn();
const mockGetQueryData = jest.fn();
const mockRefetchClientRegistrationPolicy = jest.fn();

// A query that is paused before its first load (device offline): not loading, not failed, no data.
const PAUSED_QUERY_RESULT = {
  data: undefined,
  isPending: true,
  isLoading: false,
  isError: false,
  isFetching: false,
  isPaused: true,
  status: "pending",
  fetchStatus: "paused",
};

type QueryOptions = {
  queryKey?: readonly unknown[];
};

interface SettingsQueryState {
  providerEnabled?: boolean;
  senderApproved?: boolean;
  senderApprovalState?: "failed" | "paused";
  clientRegistrationPolicy?: {
    clientAutoRegistration: boolean;
    greetingOnAutoRegistration: boolean;
  };
  clientRegistrationPolicyLoading?: boolean;
  clientRegistrationPolicyError?: boolean;
  clientRegistrationPolicyPaused?: boolean;
  messageAutomationPolicies?: MessageAutomationPoliciesResponse;
  messageAutomationPoliciesPaused?: boolean;
  messageAutomationPoliciesLoading?: boolean;
  messageAutomationPoliciesError?: boolean;
  messageAutomationPoliciesRefetch?: jest.Mock;
  systemTemplate?: {
    id: string;
    templateKey: string;
    content: string;
    customVariables: Array<{ key: string; label: string; required: boolean }>;
    requiredVariables: Array<{ key: string; label: string; required: boolean; type: string }>;
    updatedAt: string;
  };
}

const allSmsTriggerTemplates = [
  {
    key: "REMINDER",
    name: "리마인드",
    description: "고객에게 일정 리마인드를 SMS로 발송합니다.",
    allowedEventTypes: ["CLIENT_CREATED"],
    allowedRecipientTypes: ["PRIMARY_EMPLOYEE"],
    requiredVariables: [],
    providers: { sms: { templateKey: "REMINDER" } },
  },
  {
    key: "SERVICE_INFO",
    name: "서비스 안내",
    description: "서비스 시작 전에 안내합니다.",
    allowedEventTypes: ["SERVICE_START"],
    allowedRecipientTypes: ["CLIENT"],
    requiredVariables: [],
    providers: { sms: { templateKey: "SERVICE_INFO" } },
  },
  {
    key: "CLIENT_GREETING",
    name: "인사 메시지",
    description: "고객 등록 인사 메시지입니다.",
    allowedEventTypes: ["CLIENT_CREATED"],
    allowedRecipientTypes: ["CLIENT"],
    requiredVariables: [],
    providers: { sms: { templateKey: "CLIENT_GREETING" } },
  },
  {
    key: "PRICE_INFO",
    name: "비용 안내",
    description: "고객에게 비용과 입금 계좌를 안내합니다.",
    allowedEventTypes: ["SERVICE_START"],
    allowedRecipientTypes: ["PRIMARY_EMPLOYEE"],
    requiredVariables: [],
    providers: { sms: { templateKey: "PRICE_INFO" } },
  },
  {
    key: "THANKS",
    name: "예약 완료(입금 확인)",
    description: "예약 완료 메시지입니다.",
    allowedEventTypes: ["SERVICE_START"],
    allowedRecipientTypes: ["CLIENT"],
    requiredVariables: [],
    providers: { sms: { templateKey: "THANKS" } },
  },
  {
    key: "SURVEY",
    name: "모니터링 설문",
    description: "모니터링 설문 안내입니다.",
    allowedEventTypes: ["SERVICE_START"],
    allowedRecipientTypes: ["CLIENT"],
    requiredVariables: [],
    providers: { sms: { templateKey: "SURVEY" } },
  },
  {
    key: "INFO",
    name: "정보 요청",
    description: "정보 안내 메시지입니다.",
    allowedEventTypes: ["SERVICE_START"],
    allowedRecipientTypes: ["CLIENT"],
    requiredVariables: [],
    providers: { sms: { templateKey: "INFO" } },
  },
  {
    key: "SERVICE_RECORD_LINK",
    name: "제공기록지 작성 링크",
    description: "제공기록지 작성 링크입니다.",
    allowedEventTypes: ["SERVICE_START"],
    allowedRecipientTypes: ["PRIMARY_EMPLOYEE"],
    requiredVariables: [],
    providers: { sms: { templateKey: "SERVICE_RECORD_LINK" } },
  },
  {
    key: "SERVICE_END_NOTICE",
    name: "수동 영수증 안내",
    description: "수동 발송으로만 사용하는 영수증 안내입니다.",
    allowedEventTypes: ["SERVICE_END"],
    allowedRecipientTypes: ["CLIENT"],
    requiredVariables: [],
    providers: { sms: { templateKey: "SERVICE_END_NOTICE" } },
  },
] as const;

function automationPoliciesWithTriggerDispatch(active: boolean): MessageAutomationPoliciesResponse {
  return {
    canManageActivation: true,
    pastTriggerConfig: { sendIntervalMinutes: 1, ruleOrder: [] },
    policies: [{
      id: "trigger-dispatch",
      title: "메시지 자동 발송",
      description: "지점의 메시지를 자동으로 발송합니다.",
      active,
      requiresApproval: true,
      rows: [],
    }],
    policyActivations: { "trigger-dispatch": active },
  };
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
  senderApprovalState,
  clientRegistrationPolicy = {
    clientAutoRegistration: true,
    greetingOnAutoRegistration: false,
  },
  clientRegistrationPolicyLoading = false,
  clientRegistrationPolicyError = false,
  clientRegistrationPolicyPaused = false,
  messageAutomationPolicies = {
    canManageActivation: true,
    pastTriggerConfig: { sendIntervalMinutes: 1, ruleOrder: [] },
    policies: [{
      id: "trigger-dispatch",
      title: "메시지 자동 발송",
      description: "지점의 메시지를 자동으로 발송합니다.",
      active: true,
      requiresApproval: true,
      rows: [],
    }],
    policyActivations: { "trigger-dispatch": true },
  },
  messageAutomationPoliciesLoading = false,
  messageAutomationPoliciesError = false,
  messageAutomationPoliciesPaused = false,
  messageAutomationPoliciesRefetch = jest.fn(),
  systemTemplate,
}: SettingsQueryState = {}) {
  mockedUseQuery.mockImplementation((options: QueryOptions) => {
    const queryKey = options.queryKey ?? [];

    if (queryKey.includes("message-sender-approval")) {
      if (senderApprovalState === "paused") {
        return { ...PAUSED_QUERY_RESULT, refetch: jest.fn() } as unknown as ReturnType<typeof useQuery>;
      }

      if (senderApprovalState === "failed") {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          isFetching: false,
          isPaused: false,
          refetch: jest.fn(),
        } as unknown as ReturnType<typeof useQuery>;
      }

      return useQueryResult({
        approvalStatus: senderApproved ? "approved" : "not_requested",
        isApproved: senderApproved,
        canRequest: !senderApproved,
        requestedAt: null,
        approvedAt: senderApproved ? "2026-06-05T00:00:00.000Z" : null,
      });
    }

    if (queryKey.includes("client-registration-policy")) {
      if (clientRegistrationPolicyPaused) {
        return { ...PAUSED_QUERY_RESULT, refetch: mockRefetchClientRegistrationPolicy } as unknown as ReturnType<typeof useQuery>;
      }

      return {
        data: clientRegistrationPolicyLoading || clientRegistrationPolicyError
          ? undefined
          : clientRegistrationPolicy,
        isLoading: clientRegistrationPolicyLoading,
        isError: clientRegistrationPolicyError,
        refetch: mockRefetchClientRegistrationPolicy,
      } as unknown as ReturnType<typeof useQuery>;
    }

    if (queryKey.includes("message-automation-policies")) {
      if (messageAutomationPoliciesPaused) {
        return { ...PAUSED_QUERY_RESULT, refetch: messageAutomationPoliciesRefetch } as unknown as ReturnType<typeof useQuery>;
      }

      return {
        data: messageAutomationPoliciesLoading || messageAutomationPoliciesError
          ? undefined
          : messageAutomationPolicies,
        isLoading: messageAutomationPoliciesLoading,
        isError: messageAutomationPoliciesError,
        refetch: messageAutomationPoliciesRefetch,
      } as unknown as ReturnType<typeof useQuery>;
    }

    if (queryKey.includes("system-templates")) {
      return useQueryResult(systemTemplate);
    }

    return useQueryResult({
      provider: "sms",
      enabled: providerEnabled,
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // useSystemTemplate은 지점 컨텍스트가 정렬돼야 데이터를 내려주므로(브랜치 스코프 기본값),
  // 지점 규칙 화면 테스트에 선택된 지점 쿠키를 심는다.
  document.cookie = "selected_branch_id=branch-test; path=/";
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1200,
  });

  mockSettingsQueries();
  mockedUseQueryClient.mockReturnValue({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
    cancelQueries: mockCancelQueries,
    getQueryData: mockGetQueryData,
  } as unknown as ReturnType<typeof useQueryClient>);
  mockedSettingsApi.updateClientRegistrationPolicy.mockImplementation(async (patch) => ({
    clientAutoRegistration: true,
    greetingOnAutoRegistration: false,
    ...patch,
  }));
  mockedUseMutation.mockImplementation(((options: {
    mutationFn?: (variables?: unknown) => unknown;
    onMutate?: (variables: unknown) => unknown;
    onSuccess?: (data: unknown, variables: unknown, context: unknown) => unknown;
    onError?: (error: unknown, variables: unknown, context: unknown) => unknown;
    onSettled?: (...args: unknown[]) => unknown;
  }) => ({
    mutate: (variables?: unknown) => {
      Promise.resolve(options.onMutate?.(variables))
        .then((context) => Promise.resolve(options.mutationFn?.(variables))
          .then((data) => options.onSuccess?.(data, variables, context))
          .catch((error) => options.onError?.(error, variables, context))
          .finally(() => options.onSettled?.(undefined, undefined, variables, context)));
    },
    isPending: false,
  })) as unknown as typeof useMutation);

  mockedUseMessageTriggerRules.mockReturnValue({
    data: [
      {
        id: "rule-1",
        branchId: "org-1",
        name: "서비스 시작 안내",
        isActive: true,
        eventType: "SERVICE_START",
        offsetType: "BEFORE_DAYS",
        offsetDays: 3,
        sendTime: "09:00",
        recipientType: "CLIENT",
        templateKey: "SERVICE_INFO",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useMessageTriggerRules>);

  mockedUseMessageTriggerTemplates.mockReturnValue({
    data: [
      {
        key: "SERVICE_INFO",
        name: "서비스 안내",
        description: "서비스 시작 전에 안내합니다.",
        allowedEventTypes: ["SERVICE_START"],
        allowedRecipientTypes: ["CLIENT"],
        requiredVariables: [],
        providers: {
          sms: { templateKey: "SERVICE_INFO" },
        },
      },
    ],
  } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

  mockedUseCreateMessageTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useCreateMessageTriggerRule>);

  mockedUseUpdateMessageTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);

  mockedUseDeleteMessageTriggerRule.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useDeleteMessageTriggerRule>);

  mockedUseUpdateMessageTriggerRuleBranchActivation.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useUpdateMessageTriggerRuleBranchActivation>);
  mockedUseActivateMessageTriggerRuleWithParent.mockReturnValue({
    isPending: false,
    mutateAsync: jest.fn(),
  } as unknown as ReturnType<typeof useActivateMessageTriggerRuleWithParent>);
});

describe("TriggerRulesManager", () => {
  it("keeps the trigger detail panel empty and blocks the rules list before approval", () => {
    const { container } = render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    expect(screen.queryByRole("button", { name: "새 규칙" })).not.toBeInTheDocument();

    const activeTab = screen.getByRole("button", { name: "활성화" });
    expect(activeTab).toBeDisabled();

    fireEvent.click(activeTab);

    expect(container.querySelector('[data-slot="list-panel-disabled-overlay"]')).toBeInTheDocument();
    expect(
      screen.getAllByText("메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요."),
    ).toHaveLength(2);
    expect(container.querySelector('[data-slot="detail-panel-scroll-content"]')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "알림톡 발송 신청하기" })).not.toBeInTheDocument();
  });

  it("keeps trigger rules available when message sending is approved even if provider settings are disabled", () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });

    const { container } = render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    expect(screen.getByRole("button", { name: "새 규칙" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "활성화" })).toBeEnabled();
    expect(container.querySelector('[data-slot="list-panel-disabled-overlay"]')).not.toBeInTheDocument();
    expect(
      screen.queryByText("메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요."),
    ).not.toBeInTheDocument();
  });

  it("does not preselect the first rule in compact split layout", async () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });

    const { container } = render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(
      await screen.findByText("왼쪽 목록에서 SMS 규칙을 선택하거나 새 규칙을 만들어 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByText("규칙 활성화")).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="split-layout"]')).toHaveAttribute("data-has-selection", "false");
  });

  it("renders only automatic SMS template routines in the message auto-send channel", () => {
    mockSettingsQueries({ providerEnabled: false, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
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
        {
          id: "sms-rule-1",
          branchId: "org-1",
          name: "서비스 안내 자동 전송",
          isActive: true,
          eventType: "SERVICE_START",
          offsetType: "BEFORE_DAYS",
          offsetDays: 7,
          recipientType: "CLIENT",
          templateKey: "SERVICE_INFO",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [
        {
          key: "SERVICE_START_REMINDER",
          name: "서비스 시작 리마인더",
          description: "서비스 시작 전에 안내합니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: {
            sms: { templateKey: "SERVICE_START_REMINDER" },
          },
        },
        {
          key: "SERVICE_INFO",
          name: "서비스 안내",
          description: "서비스 정보를 SMS로 안내합니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: {
            sms: { templateKey: "SERVICE_INFO" },
          },
        },
      ],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" channel="sms" />);

    expect(screen.getByText("자동 전송 루틴")).toBeInTheDocument();
    expect(screen.getByText("메시지 템플릿을 자동으로 보내는 루틴만 관리합니다.")).toBeInTheDocument();
    expect(screen.getByText("서비스 안내 자동 전송")).toBeInTheDocument();
    expect(screen.queryByText("서비스 시작 안내")).not.toBeInTheDocument();
    expect(screen.queryByText("제공기록지 전송 자동화 규칙")).not.toBeInTheDocument();
    expect(screen.queryByText("SMS 재시도 규칙")).not.toBeInTheDocument();

    expect(screen.getByRole("switch", { name: "서비스 안내 자동 전송 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("hides the manual receipt-send system rule while listing branch SERVICE_END_NOTICE routines", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [
        {
          id: "system:service_end_notice",
          branchId: null,
          name: "서비스 종료 안내 (수동 발송)",
          isActive: true,
          eventType: "SERVICE_END",
          offsetType: "AFTER_DAYS",
          offsetDays: 1,
          recipientType: "CLIENT",
          templateKey: "SERVICE_END_NOTICE",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "branch-service-end-notice",
          branchId: "org-1",
          name: "수동 영수증 안내",
          isActive: true,
          eventType: "SERVICE_END",
          offsetType: "AFTER_DAYS",
          offsetDays: 1,
          recipientType: "CLIENT",
          templateKey: "SERVICE_END_NOTICE",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "system:service_record_link",
          branchId: null,
          name: "제공기록지 작성 링크",
          isActive: true,
          eventType: "SERVICE_START",
          offsetType: "SAME_DAY",
          offsetDays: 0,
          recipientType: "PRIMARY_EMPLOYEE",
          templateKey: "SERVICE_RECORD_LINK",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [
        {
          key: "SERVICE_END_NOTICE",
          name: "서비스 종료 안내",
          description: "서비스 종료 안내입니다.",
          allowedEventTypes: ["SERVICE_END"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: { sms: { templateKey: "SERVICE_END_NOTICE" } },
        },
      ],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    expect(screen.queryByText("서비스 종료 안내 (수동 발송)")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "서비스 종료 안내 (수동 발송) 활성화" })).not.toBeInTheDocument();
    expect(screen.getByText("수동 영수증 안내")).toBeInTheDocument();
    fireEvent.click(screen.getByText("수동 영수증 안내"));
    await waitFor(() => expect(screen.getByLabelText("규칙 이름")).toHaveValue("수동 영수증 안내"));
    expect(screen.getByLabelText("규칙 이름")).toBeEnabled();
    expect(screen.getByRole("switch", { name: "제공기록지 작성 링크 활성화" })).toBeInTheDocument();
  });

  it("allows SERVICE_END_NOTICE for a compatible automatic rule and preserves its create payload", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    const mutateAsync = jest.fn().mockResolvedValue({ id: "service-end-notice-rule" });
    mockedUseCreateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useCreateMessageTriggerRule>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [
        {
          key: "SERVICE_INFO",
          name: "서비스 안내",
          description: "서비스 시작 전에 안내합니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: { sms: { templateKey: "SERVICE_INFO" } },
        },
        {
          key: "SERVICE_END_NOTICE",
          name: "수동 영수증 안내",
          description: "수동 발송으로만 사용하는 영수증 안내입니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: { sms: { templateKey: "SERVICE_END_NOTICE" } },
        },
      ],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    const createTemplateTrigger = screen.getByLabelText("발송 템플릿");
    fireEvent.click(createTemplateTrigger);
    const serviceEndNoticeOption = screen.getByRole("option", {
      name: "수동 영수증 안내",
    });
    expect(serviceEndNoticeOption).not.toHaveAttribute("aria-disabled");
    fireEvent.click(serviceEndNoticeOption);
    expect(createTemplateTrigger).toHaveTextContent("수동 영수증 안내");

    fireEvent.change(screen.getByLabelText("규칙 이름"), {
      target: { value: "서비스 종료 영수증 안내" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      name: "서비스 종료 영수증 안내",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
      sendTime: "09:00",
      recipientType: "CLIENT",
      templateKey: "SERVICE_END_NOTICE",
      targetClientStatus: "all",
      retryOnFailure: true,
    });
  });

  it("renders every backend SMS template in order with deterministic compatibility labels", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: allSmsTriggerTemplates,
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    const templateTrigger = screen.getByLabelText("발송 템플릿");
    fireEvent.click(templateTrigger);
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "리마인드 · 선택한 이벤트·수신 대상과 맞지 않음",
      "서비스 안내",
      "인사 메시지 · 선택한 이벤트와 맞지 않음",
      "비용 안내 · 선택한 수신 대상과 맞지 않음",
      "예약 완료(입금 확인)",
      "모니터링 설문",
      "정보 요청",
      "제공기록지 작성 링크 · 제공기록지 전용 자동화에서 관리",
      "수동 영수증 안내 · 선택한 이벤트와 맞지 않음",
    ]);
    expect(screen.getByRole("option", { name: "서비스 안내" })).not.toHaveAttribute("aria-disabled");
    for (const name of [
      "리마인드 · 선택한 이벤트·수신 대상과 맞지 않음",
      "인사 메시지 · 선택한 이벤트와 맞지 않음",
      "비용 안내 · 선택한 수신 대상과 맞지 않음",
      "제공기록지 작성 링크 · 제공기록지 전용 자동화에서 관리",
      "수동 영수증 안내 · 선택한 이벤트와 맞지 않음",
    ]) {
      expect(screen.getByRole("option", { name })).toHaveAttribute("aria-disabled", "true");
    }

    fireEvent.keyDown(templateTrigger, { key: "Escape" });
    fireEvent.click(screen.getByText("서비스 시작 안내"));
    const editTemplateTrigger = screen.getByLabelText("발송 템플릿");
    fireEvent.click(editTemplateTrigger);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "리마인드 · 선택한 이벤트·수신 대상과 맞지 않음",
      "서비스 안내",
      "인사 메시지 · 선택한 이벤트와 맞지 않음",
      "비용 안내 · 선택한 수신 대상과 맞지 않음",
      "예약 완료(입금 확인)",
      "모니터링 설문",
      "정보 요청",
      "제공기록지 작성 링크 · 제공기록지 전용 자동화에서 관리",
      "수동 영수증 안내 · 선택한 이벤트와 맞지 않음",
    ]);
  });

  it("adds the dedicated service-record template when the configurable catalog omits it", () => {
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      systemTemplate: {
        id: "service-info-template",
        templateKey: "SERVICE_INFO",
        content: "서비스 안내 본문",
        customVariables: [],
        requiredVariables: [],
        updatedAt: "2026-03-01T00:00:00.000Z",
        name: "서비스 안내",
        description: "서비스 시작 전에 안내합니다.",
      } as SettingsQueryState["systemTemplate"],
    });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: allSmsTriggerTemplates.filter((template) => template.key !== "SERVICE_RECORD_LINK"),
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    const templateTrigger = screen.getByLabelText("발송 템플릿");
    fireEvent.click(templateTrigger);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(9);
    expect(options.map((option) => option.textContent)).toEqual([
      "리마인드 · 선택한 이벤트·수신 대상과 맞지 않음",
      "서비스 안내",
      "제공기록지 작성 링크 · 제공기록지 전용 자동화에서 관리",
      "인사 메시지 · 선택한 이벤트와 맞지 않음",
      "비용 안내 · 선택한 수신 대상과 맞지 않음",
      "예약 완료(입금 확인)",
      "모니터링 설문",
      "정보 요청",
      "수동 영수증 안내 · 선택한 이벤트와 맞지 않음",
    ]);

    const dedicatedOption = screen.getByRole("option", {
      name: "제공기록지 작성 링크 · 제공기록지 전용 자동화에서 관리",
    });
    expect(dedicatedOption).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(dedicatedOption);
    expect(templateTrigger).toHaveTextContent("서비스 안내");
  });

  it("recomputes disabled template options when event or recipient changes without removing options", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: allSmsTriggerTemplates,
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    const eventTrigger = screen.getByLabelText("이벤트 기준");
    fireEvent.click(eventTrigger);
    fireEvent.click(screen.getByRole("option", { name: "고객 등록" }));

    const recipientTrigger = screen.getByLabelText("수신 대상");
    fireEvent.click(recipientTrigger);
    fireEvent.click(screen.getByRole("option", { name: "주 담당 직원" }));

    const templateTrigger = screen.getByLabelText("발송 템플릿");
    fireEvent.click(templateTrigger);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(allSmsTriggerTemplates.length);
    expect(screen.getByRole("option", { name: "리마인드" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("option", { name: "서비스 안내 · 선택한 이벤트·수신 대상과 맞지 않음" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "수동 영수증 안내 · 선택한 이벤트·수신 대상과 맞지 않음" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("reconciles an incompatible selected template while keeping the full catalog visible", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: allSmsTriggerTemplates,
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    const recipientTrigger = screen.getByLabelText("수신 대상");
    fireEvent.click(recipientTrigger);
    fireEvent.click(screen.getByRole("option", { name: "주 담당 직원" }));

    await waitFor(() => {
      expect(screen.getByLabelText("발송 템플릿")).toHaveTextContent("비용 안내");
    });

    fireEvent.click(screen.getByLabelText("발송 템플릿"));
    expect(screen.getAllByRole("option")).toHaveLength(allSmsTriggerTemplates.length);
    expect(screen.getByRole("option", { name: "비용 안내" })).not.toHaveAttribute("aria-disabled");
  });

  it("keeps a selected dedicated template displayed with its disabled reason while editing", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [{
        id: "service-record-rule",
        branchId: "org-1",
        name: "제공기록지 자동화",
        isActive: true,
        eventType: "SERVICE_START",
        offsetType: "SAME_DAY",
        offsetDays: 0,
        recipientType: "PRIMARY_EMPLOYEE",
        templateKey: "SERVICE_RECORD_LINK",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: allSmsTriggerTemplates,
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByText("제공기록지 자동화"));

    expect(screen.getByLabelText("발송 템플릿")).toBeDisabled();
    expect(screen.getByLabelText("발송 템플릿")).toHaveTextContent(
      "제공기록지 작성 링크 · 제공기록지 전용 자동화에서 관리",
    );
  });

  it("does not change the selected template when a disabled option is clicked", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: allSmsTriggerTemplates,
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    const templateTrigger = screen.getByLabelText("발송 템플릿");
    fireEvent.click(templateTrigger);

    fireEvent.click(screen.getByRole("option", {
      name: "제공기록지 작성 링크 · 제공기록지 전용 자동화에서 관리",
    }));

    expect(templateTrigger).toHaveTextContent("서비스 안내");
  });

  it("does not invent template options while the backend catalog is loading or empty", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    // No picker is offered for a catalog that has not loaded (the loading wording stands in).
    expect(screen.queryByLabelText("발송 템플릿")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByText("제공기록지 작성 링크")).not.toBeInTheDocument();
    expect(screen.getByText("템플릿 정보를 불러오는 중이에요.")).toBeInTheDocument();
  });

  it("shows the client registration greeting condition on the existing CLIENT_GREETING rule", () => {
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      clientRegistrationPolicy: {
        clientAutoRegistration: false,
        greetingOnAutoRegistration: false,
      },
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [{
        id: "client-greeting-rule",
        branchId: "org-1",
        name: "인사 메시지",
        isActive: true,
        eventType: "CLIENT_CREATED",
        offsetType: "IMMEDIATE",
        offsetDays: 0,
        recipientType: "CLIENT",
        templateKey: "CLIENT_GREETING",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [{
        key: "CLIENT_GREETING",
        name: "인사 메시지",
        description: "고객 등록 인사 메시지입니다.",
        allowedEventTypes: ["CLIENT_CREATED"],
        allowedRecipientTypes: ["CLIENT"],
        requiredVariables: [],
        providers: { sms: { templateKey: "CLIENT_GREETING" } },
      }],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getAllByText("인사 메시지")[0]);

    const conditionSwitch = screen.getByRole("switch", { name: "전자문서 자동 등록 고객에게도 발송" });
    expect(conditionSwitch).toBeEnabled();
    expect(screen.getByText(/고객 자동 등록이 꺼져 있어도 미리 설정할 수 있어요/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "인사 메시지 활성화" })).toBeChecked();
  });

  it("persists the greeting condition through the shared client-registration policy API", async () => {
    const previousPolicy = {
      clientAutoRegistration: false,
      greetingOnAutoRegistration: false,
    };
    mockGetQueryData.mockReturnValue(previousPolicy);
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      clientRegistrationPolicy: previousPolicy,
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [{
        id: "client-greeting-rule",
        branchId: "org-1",
        name: "인사 메시지",
        isActive: true,
        eventType: "CLIENT_CREATED",
        offsetType: "IMMEDIATE",
        offsetDays: 0,
        recipientType: "CLIENT",
        templateKey: "CLIENT_GREETING",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [{
        key: "CLIENT_GREETING",
        name: "인사 메시지",
        description: "고객 등록 인사 메시지입니다.",
        allowedEventTypes: ["CLIENT_CREATED"],
        allowedRecipientTypes: ["CLIENT"],
        requiredVariables: [],
        providers: { sms: { templateKey: "CLIENT_GREETING" } },
      }],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getAllByText("인사 메시지")[0]);
    fireEvent.click(screen.getByRole("switch", { name: "전자문서 자동 등록 고객에게도 발송" }));

    await waitFor(() => {
      expect(mockedSettingsApi.updateClientRegistrationPolicy).toHaveBeenCalledWith({
        greetingOnAutoRegistration: true,
      });
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ["settings", "client-registration-policy"],
        expect.objectContaining({ greetingOnAutoRegistration: true }),
      );
    });
  });

  it("rolls back the greeting condition when the client-registration policy save fails", async () => {
    const previousPolicy = {
      clientAutoRegistration: false,
      greetingOnAutoRegistration: false,
    };
    mockGetQueryData.mockReturnValue(previousPolicy);
    mockedSettingsApi.updateClientRegistrationPolicy.mockRejectedValueOnce(new Error("failed"));
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      clientRegistrationPolicy: previousPolicy,
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [{
        id: "client-greeting-rule",
        branchId: "org-1",
        name: "인사 메시지",
        isActive: true,
        eventType: "CLIENT_CREATED",
        offsetType: "IMMEDIATE",
        offsetDays: 0,
        recipientType: "CLIENT",
        templateKey: "CLIENT_GREETING",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [{
        key: "CLIENT_GREETING",
        name: "인사 메시지",
        description: "고객 등록 인사 메시지입니다.",
        allowedEventTypes: ["CLIENT_CREATED"],
        allowedRecipientTypes: ["CLIENT"],
        requiredVariables: [],
        providers: { sms: { templateKey: "CLIENT_GREETING" } },
      }],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getAllByText("인사 메시지")[0]);
    fireEvent.click(screen.getByRole("switch", { name: "전자문서 자동 등록 고객에게도 발송" }));

    await waitFor(() => {
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ["settings", "client-registration-policy"],
        previousPolicy,
      );
    });
  });

  it("shows loading and retry states for the client registration greeting condition", () => {
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      clientRegistrationPolicyLoading: true,
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [{
        id: "client-greeting-rule",
        branchId: "org-1",
        name: "인사 메시지",
        isActive: true,
        eventType: "CLIENT_CREATED",
        offsetType: "IMMEDIATE",
        offsetDays: 0,
        recipientType: "CLIENT",
        templateKey: "CLIENT_GREETING",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [{
        key: "CLIENT_GREETING",
        name: "인사 메시지",
        description: "고객 등록 인사 메시지입니다.",
        allowedEventTypes: ["CLIENT_CREATED"],
        allowedRecipientTypes: ["CLIENT"],
        requiredVariables: [],
        providers: { sms: { templateKey: "CLIENT_GREETING" } },
      }],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    const view = render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getAllByText("인사 메시지")[0]);
    expect(screen.getAllByText("고객 자동 등록 설정을 불러오는 중이에요.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("switch", { name: "전자문서 자동 등록 고객에게도 발송" })).not.toBeInTheDocument();

    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      clientRegistrationPolicyError: true,
    });
    view.rerender(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(mockRefetchClientRegistrationPolicy).toHaveBeenCalledTimes(1);
  });

  it("preserves a dedicated service-record rule while editing its name", async () => {
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      systemTemplate: {
        id: "template-service-record-link",
        templateKey: "SERVICE_RECORD_LINK",
        content: "{{employeeName}}님 {{serviceRecordUrl}} {{buttonUrl}} {{serviceEndDate}}",
        customVariables: [
          { key: "buttonUrl", label: "버튼 링크", required: true },
          { key: "serviceEndDate", label: "서비스 종료일", required: true },
        ],
        requiredVariables: [
          { key: "employeeName", label: "제공인력명", required: true, type: "string" },
          { key: "serviceRecordUrl", label: "제공기록지 링크", required: true, type: "string" },
        ],
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    });
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockedUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [
        {
          id: "system:service-record-link",
          branchId: "org-1",
          name: "제공기록지 전송 자동화 규칙",
          isActive: true,
          eventType: "SERVICE_START",
          offsetType: "SAME_DAY",
          offsetDays: 0,
          recipientType: "PRIMARY_EMPLOYEE",
          templateKey: "SERVICE_RECORD_LINK",
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [
        {
          key: "SERVICE_INFO",
          name: "서비스 안내",
          description: "서비스 시작 전에 안내합니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: { sms: { templateKey: "SERVICE_INFO" } },
        },
      ],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByText("제공기록지 전송 자동화 규칙"));

    const nameInput = await screen.findByLabelText("규칙 이름");
    expect(screen.getByLabelText("이벤트 기준")).toBeDisabled();
    expect(screen.getByLabelText("발송 시점")).toBeDisabled();
    expect(screen.getByLabelText("수신 대상")).toBeDisabled();
    expect(screen.getByLabelText("발송 템플릿")).toBeDisabled();
    expect(screen.getByLabelText("이벤트 기준")).toHaveTextContent("서비스 시작");
    expect(screen.getByLabelText("발송 시점")).toHaveTextContent("시작 당일");
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("주 담당 직원");
    expect(screen.getByLabelText("발송 템플릿")).toHaveTextContent("제공기록지 작성 링크");
    expect(screen.getByText("제공인력명")).toBeInTheDocument();
    expect(screen.getByText("제공기록지 링크")).toBeInTheDocument();
    expect(screen.getByText("버튼 링크")).toBeInTheDocument();
    expect(screen.getByText("서비스 종료일")).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: "제공기록지 링크 발송" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "system:service-record-link",
      dto: {
        name: "제공기록지 링크 발송",
        isActive: true,
        eventType: "SERVICE_START",
        offsetType: "SAME_DAY",
        offsetDays: 0,
        sendTime: "09:00",
        recipientType: "PRIMARY_EMPLOYEE",
        templateKey: "SERVICE_RECORD_LINK",
        targetClientStatus: "all",
        retryOnFailure: true,
      },
    });
  });

  it("keeps global service-record content read-only while allowing branch activation", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [
        {
          id: "system:service_record_link",
          branchId: null,
          name: "제공기록지 작성 링크",
          isActive: true,
          eventType: "SERVICE_START",
          offsetType: "SAME_DAY",
          offsetDays: 0,
          recipientType: "PRIMARY_EMPLOYEE",
          templateKey: "SERVICE_RECORD_LINK",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);

    const branchActivationMutation = jest.fn().mockResolvedValue(undefined);
    const contentMutation = jest.fn();
    mockedUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync: contentMutation,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);
    mockedUseUpdateMessageTriggerRuleBranchActivation.mockReturnValue({
      isPending: false,
      mutateAsync: branchActivationMutation,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRuleBranchActivation>);
    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    expect(screen.getByText("제공기록지 작성 링크")).toBeInTheDocument();
    expect(screen.getByText("시스템 자동화 · 서비스 시작 1일 전 12:00 (한국 시간) · 늦게 등록되면 즉시 발송 · 주 담당 직원")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "제공기록지 작성 링크 활성화" })).toBeEnabled();
    fireEvent.click(screen.getByRole("switch", { name: "제공기록지 작성 링크 활성화" }));
    expect(branchActivationMutation).toHaveBeenCalledWith({
      id: "system:service_record_link",
      dto: { isActive: false },
    });
    expect(contentMutation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("제공기록지 작성 링크"));
    expect(await screen.findByLabelText("규칙 이름")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
  });

  it("disables a global rule toggle when globally locked", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [{
        id: "system:locked",
        branchId: null,
        name: "잠긴 시스템 규칙",
        isActive: true,
        isLockedByGlobal: true,
        eventType: "SERVICE_START",
        offsetType: "SAME_DAY",
        offsetDays: 0,
        sendTime: "09:00",
        recipientType: "PRIMARY_EMPLOYEE",
        templateKey: "SERVICE_RECORD_LINK",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    expect(screen.getByRole("switch", { name: "잠긴 시스템 규칙 활성화" })).toBeDisabled();
  });

  it("uses the existing update mutation for branch-owned activation", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockedUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("switch", { name: "서비스 시작 안내 활성화" }));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "rule-1",
      dto: {
        name: "서비스 시작 안내",
        isActive: false,
        eventType: "SERVICE_START",
        offsetType: "BEFORE_DAYS",
        offsetDays: 3,
        sendTime: "09:00",
        recipientType: "CLIENT",
        templateKey: "SERVICE_INFO",
        targetClientStatus: "all",
        retryOnFailure: true,
      },
    });
  });

  it("shows every required auto-filled variable for the selected template", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: [
        {
          key: "PRICE_INFO",
          name: "비용 안내",
          description: "고객에게 비용과 입금 계좌를 안내합니다.",
          allowedEventTypes: ["SERVICE_START"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [
            { key: "name", label: "산모님 성함" },
            { key: "weeks", label: "주수" },
            { key: "duration", label: "이용일수" },
            { key: "type", label: "바우처 유형" },
            { key: "fullPrice", label: "총 금액" },
            { key: "grant", label: "정부지원금" },
            { key: "actualPrice", label: "본인부담금" },
            { key: "bankName", label: "입금 은행" },
            { key: "accNum", label: "계좌번호" },
          ],
          providers: { sms: { templateKey: "PRICE_INFO" } },
        },
      ],
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    expect(await screen.findByText("필수 자동 입력 정보")).toBeInTheDocument();
    for (const label of [
      "산모님 성함",
      "주수",
      "이용일수",
      "바우처 유형",
      "총 금액",
      "정부지원금",
      "본인부담금",
      "입금 은행",
      "계좌번호",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/고객 정보에서 자동으로 입력/)).toBeInTheDocument();
    expect(screen.getByText(/관할 지역과 계좌 정보/)).toBeInTheDocument();
  });

  it("creates a valid catalog-backed rule from the new-rule form", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    const mutateAsync = jest.fn().mockResolvedValue({ id: "rule-created" });
    mockedUseCreateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useCreateMessageTriggerRule>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    fireEvent.change(screen.getByLabelText("규칙 이름"), {
      target: { value: "서비스 시작 7일 전 안내" },
    });
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("09:00");
    fireEvent.change(screen.getByLabelText("발송 시각 (한국 시간)"), { target: { value: "14:37" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      name: "서비스 시작 7일 전 안내",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
      sendTime: "14:37",
      recipientType: "CLIENT",
      templateKey: "SERVICE_INFO",
      targetClientStatus: "all",
      retryOnFailure: true,
    });
  });

  it("blocks an automation rule when a required custom variable has no automatic source", async () => {
    mockSettingsQueries({
      providerEnabled: true,
      senderApproved: true,
      systemTemplate: {
        id: "template-service-info",
        templateKey: "SERVICE_INFO",
        content: "{{name}} 산모님 예약번호 {{reservationCode}}",
        customVariables: [{ key: "reservationCode", label: "예약번호", required: true }],
        requiredVariables: [{ key: "name", label: "산모님 성함", required: true, type: "string" }],
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    });

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    fireEvent.change(screen.getByLabelText("규칙 이름"), {
      target: { value: "예약번호가 필요한 규칙" },
    });

    expect(await screen.findByText(/자동 입력 출처가 없는 필수 변수/)).toHaveTextContent("예약번호");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("opens the parent confirmation for an inactive child while parent is off, and cancel performs no write", () => {
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
    });
    const inactiveRule = {
      id: "rule-off",
      branchId: "org-1",
      name: "꺼진 서비스 안내",
      isActive: false,
      eventType: "SERVICE_START" as const,
      offsetType: "BEFORE_DAYS" as const,
      offsetDays: 3,
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const parentMutation = jest.fn();
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [inactiveRule],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    mockedUseActivateMessageTriggerRuleWithParent.mockReturnValue({
      isPending: false,
      mutateAsync: parentMutation,
    } as unknown as ReturnType<typeof useActivateMessageTriggerRuleWithParent>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    fireEvent.click(screen.getByRole("switch", { name: "꺼진 서비스 안내 활성화" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("이 지점의 메시지 자동 발송을 켤까요?")).toBeInTheDocument();
    expect(screen.getByText(/메시지 자동 발송과 선택한 “꺼진 서비스 안내” 규칙을 함께 켭니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(parentMutation).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses exactly one aggregate activation call and follows the refreshed server state", async () => {
    const inactiveRule = {
      id: "rule-off",
      branchId: "org-1",
      name: "꺼진 서비스 안내",
      isActive: false,
      eventType: "SERVICE_START" as const,
      offsetType: "BEFORE_DAYS" as const,
      offsetDays: 3,
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const activatedRule = { ...inactiveRule, isActive: true };
    const parentRefetch = jest.fn().mockResolvedValue({
      data: automationPoliciesWithTriggerDispatch(true),
    });
    const rulesRefetch = jest.fn().mockResolvedValue({ data: [activatedRule] });
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
      messageAutomationPoliciesRefetch: parentRefetch,
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [inactiveRule],
      isLoading: false,
      refetch: rulesRefetch,
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    const parentMutation = jest.fn().mockResolvedValue(activatedRule);
    const ordinaryMutation = jest.fn();
    const ordinaryBranchMutation = jest.fn();
    mockedUseActivateMessageTriggerRuleWithParent.mockReturnValue({
      isPending: false,
      mutateAsync: parentMutation,
    } as unknown as ReturnType<typeof useActivateMessageTriggerRuleWithParent>);
    mockedUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync: ordinaryMutation,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);
    mockedUseUpdateMessageTriggerRuleBranchActivation.mockReturnValue({
      isPending: false,
      mutateAsync: ordinaryBranchMutation,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRuleBranchActivation>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    fireEvent.click(screen.getByRole("switch", { name: "꺼진 서비스 안내 활성화" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(parentMutation).toHaveBeenCalledTimes(1));
    expect(parentMutation).toHaveBeenCalledWith("rule-off");
    expect(ordinaryMutation).not.toHaveBeenCalled();
    expect(ordinaryBranchMutation).not.toHaveBeenCalled();
    expect(rulesRefetch).toHaveBeenCalledTimes(1);
    expect(parentRefetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["message-triggers"] });
  });

  it("does not resurrect a child when the authoritative refresh reports parent off", async () => {
    const inactiveRule = {
      id: "rule-off",
      branchId: "org-1",
      name: "꺼진 서비스 안내",
      isActive: false,
      eventType: "SERVICE_START" as const,
      offsetType: "BEFORE_DAYS" as const,
      offsetDays: 3,
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const parentRefetch = jest.fn().mockResolvedValue({
      data: automationPoliciesWithTriggerDispatch(false),
    });
    const rulesRefetch = jest.fn().mockResolvedValue({ data: [inactiveRule] });
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
      messageAutomationPoliciesRefetch: parentRefetch,
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [inactiveRule],
      isLoading: false,
      refetch: rulesRefetch,
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    const parentMutation = jest.fn().mockResolvedValue({ ...inactiveRule, isActive: true });
    mockedUseActivateMessageTriggerRuleWithParent.mockReturnValue({
      isPending: false,
      mutateAsync: parentMutation,
    } as unknown as ReturnType<typeof useActivateMessageTriggerRuleWithParent>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    fireEvent.click(screen.getByRole("switch", { name: "꺼진 서비스 안내 활성화" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("switch", { name: "꺼진 서비스 안내 활성화" })).not.toBeChecked();
  });

  it("keeps the confirmation open when the authoritative refresh fails", async () => {
    const inactiveRule = {
      id: "rule-off",
      branchId: "org-1",
      name: "꺼진 서비스 안내",
      isActive: false,
      eventType: "SERVICE_START" as const,
      offsetType: "BEFORE_DAYS" as const,
      offsetDays: 3,
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const parentRefetch = jest.fn().mockResolvedValue({ isError: true, data: undefined });
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
      messageAutomationPoliciesRefetch: parentRefetch,
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [inactiveRule],
      isLoading: false,
      refetch: jest.fn().mockResolvedValue({ data: [inactiveRule] }),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    const parentMutation = jest.fn().mockResolvedValue({ ...inactiveRule, isActive: true });
    mockedUseActivateMessageTriggerRuleWithParent.mockReturnValue({
      isPending: false,
      mutateAsync: parentMutation,
    } as unknown as ReturnType<typeof useActivateMessageTriggerRuleWithParent>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    fireEvent.click(screen.getByRole("switch", { name: "꺼진 서비스 안내 활성화" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이 지점의 메시지 자동 발송이 꺼져 있어요. 설정을 새로고침한 뒤 다시 시도해 주세요.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(parentMutation).toHaveBeenCalledTimes(1);
  });

  it("locks modal controls while the authoritative refresh is pending", async () => {
    const inactiveRule = {
      id: "rule-off",
      branchId: "org-1",
      name: "꺼진 서비스 안내",
      isActive: false,
      eventType: "SERVICE_START" as const,
      offsetType: "BEFORE_DAYS" as const,
      offsetDays: 3,
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const refreshPending = new Promise<never>(() => {});
    const parentRefetch = jest.fn().mockReturnValue(refreshPending);
    const rulesRefetch = jest.fn().mockReturnValue(refreshPending);
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
      messageAutomationPoliciesRefetch: parentRefetch,
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [inactiveRule],
      isLoading: false,
      refetch: rulesRefetch,
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    const parentMutation = jest.fn().mockResolvedValue({ ...inactiveRule, isActive: true });
    mockedUseActivateMessageTriggerRuleWithParent.mockReturnValue({
      isPending: false,
      mutateAsync: parentMutation,
    } as unknown as ReturnType<typeof useActivateMessageTriggerRuleWithParent>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    const childSwitch = screen.getByRole("switch", { name: "꺼진 서비스 안내 활성화" });
    fireEvent.click(childSwitch);
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(parentMutation).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "처리 중..." })).toBeDisabled();
    expect(childSwitch).toBeDisabled();
  });

  it("keeps the confirmation open after a mutation failure and permits retry without duplicate calls", async () => {
    const inactiveRule = {
      id: "rule-off",
      branchId: "org-1",
      name: "꺼진 서비스 안내",
      isActive: false,
      eventType: "SERVICE_START" as const,
      offsetType: "BEFORE_DAYS" as const,
      offsetDays: 3,
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [inactiveRule],
      isLoading: false,
      refetch: jest.fn().mockResolvedValue({ data: [inactiveRule] }),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    const parentMutation = jest.fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ ...inactiveRule, isActive: true });
    mockedUseActivateMessageTriggerRuleWithParent.mockReturnValue({
      isPending: false,
      mutateAsync: parentMutation,
    } as unknown as ReturnType<typeof useActivateMessageTriggerRuleWithParent>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    fireEvent.click(screen.getByRole("switch", { name: "꺼진 서비스 안내 활성화" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("규칙을 켜지 못했어요. 잠시 후 다시 시도해 주세요");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(parentMutation).toHaveBeenCalledTimes(2));
  });

  it("does not treat unrelated coded 409 conflicts as parent-disabled races", async () => {
    const inactiveRule = {
      id: "rule-off",
      branchId: "org-1",
      name: "꺼진 서비스 안내",
      isActive: false,
      eventType: "SERVICE_START" as const,
      offsetType: "BEFORE_DAYS" as const,
      offsetDays: 3,
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
    });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [inactiveRule],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    const conflict = Object.assign(new Error("global lock"), {
      response: { status: 409, data: { code: "GLOBAL_RULE_DISABLED" } },
    });
    const parentMutation = jest.fn().mockRejectedValue(conflict);
    mockedUseActivateMessageTriggerRuleWithParent.mockReturnValue({
      isPending: false,
      mutateAsync: parentMutation,
    } as unknown as ReturnType<typeof useActivateMessageTriggerRuleWithParent>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    fireEvent.click(screen.getByRole("switch", { name: "꺼진 서비스 안내 활성화" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("현재 데이터 상태와 요청이 충돌해 처리할 수 없어요.");
    expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["message-triggers"] });
  });

  it("creates a new rule inactive when the known parent is off", async () => {
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
    });
    const createMutation = jest.fn().mockResolvedValue({ id: "rule-created", isActive: false });
    mockedUseCreateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync: createMutation,
    } as unknown as ReturnType<typeof useCreateMessageTriggerRule>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "부모가 꺼진 새 규칙" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(createMutation).toHaveBeenCalledWith(expect.objectContaining({
      name: "부모가 꺼진 새 규칙",
      isActive: false,
    })));
  });

  it("preserves an unsaved new-rule draft when the parent state changes", () => {
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(false),
    });
    const view = render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    const nameInput = screen.getByLabelText("규칙 이름");
    fireEvent.change(nameInput, { target: { value: "작성 중인 규칙" } });

    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(true),
    });
    view.rerender(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    expect(screen.getByLabelText("규칙 이름")).toHaveValue("작성 중인 규칙");
  });

  it("allows a member to use the ordinary child toggle while the parent is on", () => {
    mockSettingsQueries({
      senderApproved: true,
      messageAutomationPolicies: automationPoliciesWithTriggerDispatch(true),
    });
    const ordinaryMutation = jest.fn().mockResolvedValue(undefined);
    mockedUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync: ordinaryMutation,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    const childSwitch = screen.getByRole("switch", { name: "서비스 시작 안내 활성화" });
    expect(childSwitch).toBeEnabled();
    fireEvent.click(childSwitch);
    expect(ordinaryMutation).toHaveBeenCalledTimes(1);
  });
});

describe("TriggerRulesManager unknown loads (BJJ-434)", () => {
  const DC = "desktop_messages_sections_section-content_triggers-section_trigger-rules";
  const RULE_NAME = "서비스 시작 안내";
  const APPROVAL_MESSAGE =
    "메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요.";
  const ACTIVE_EMPTY_TEXT = "활성화된 발송 규칙이 없습니다.";
  const INACTIVE_EMPTY_TEXT = "비활성화된 발송 규칙이 없습니다.";
  const RULE = {
    id: "rule-1",
    branchId: "org-1",
    name: RULE_NAME,
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 3,
    sendTime: "09:00",
    recipientType: "CLIENT",
    templateKey: "SERVICE_INFO",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };

  function mockRules(result: Record<string, unknown>) {
    mockedUseMessageTriggerRules.mockReturnValue(result as unknown as ReturnType<typeof useMessageTriggerRules>);
  }

  describe("unknown sender approval", () => {
    it("failed approval with no data fails closed: no alert, no approval notice, editing stays closed", () => {
      mockSettingsQueries({ senderApproved: true, senderApprovalState: "failed" });
      const updateMutation = jest.fn().mockResolvedValue(undefined);
      const deleteMutation = jest.fn().mockResolvedValue(undefined);
      mockedUseUpdateMessageTriggerRule.mockReturnValue({
        isPending: false,
        mutateAsync: updateMutation,
      } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);
      mockedUseDeleteMessageTriggerRule.mockReturnValue({
        isPending: false,
        mutateAsync: deleteMutation,
      } as unknown as ReturnType<typeof useDeleteMessageTriggerRule>);

      const { container } = render(<TriggerRulesManager dataComponent={DC} />);

      // The gate owns the failure panel; this component adds none and does not claim "not approved".
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(APPROVAL_MESSAGE)).not.toBeInTheDocument();
      expect(container.querySelector('[data-slot="list-panel-disabled-overlay"]')).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "새 규칙" })).not.toBeInTheDocument();

      const ruleSwitch = screen.getByRole("switch", { name: `${RULE_NAME} 활성화` });
      expect(ruleSwitch).toBeDisabled();
      fireEvent.click(ruleSwitch);
      expect(updateMutation).not.toHaveBeenCalled();

      fireEvent.click(screen.getAllByText(RULE_NAME)[0]);
      fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "바뀐 이름" } });
      expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "삭제" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      fireEvent.click(screen.getByRole("button", { name: "삭제" }));
      expect(updateMutation).not.toHaveBeenCalled();
      expect(deleteMutation).not.toHaveBeenCalled();
    });

    it("an approved answer still lets the same screen edit and delete", async () => {
      mockSettingsQueries({ senderApproved: true });
      const updateMutation = jest.fn().mockResolvedValue(undefined);
      const deleteMutation = jest.fn().mockResolvedValue(undefined);
      mockedUseUpdateMessageTriggerRule.mockReturnValue({
        isPending: false,
        mutateAsync: updateMutation,
      } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);
      mockedUseDeleteMessageTriggerRule.mockReturnValue({
        isPending: false,
        mutateAsync: deleteMutation,
      } as unknown as ReturnType<typeof useDeleteMessageTriggerRule>);

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.getByRole("button", { name: "새 규칙" })).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: `${RULE_NAME} 활성화` })).toBeEnabled();

      fireEvent.click(screen.getAllByText(RULE_NAME)[0]);
      fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "바뀐 이름" } });
      expect(screen.getByRole("button", { name: "삭제" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await waitFor(() => expect(updateMutation).toHaveBeenCalledTimes(1));
    });

    it("paused approval with no data is rendered like loading: not locked", () => {
      mockSettingsQueries({ senderApproved: true, senderApprovalState: "paused" });

      const { container } = render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.getByRole("button", { name: "새 규칙" })).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: `${RULE_NAME} 활성화` })).toBeEnabled();
      expect(screen.queryByText(APPROVAL_MESSAGE)).not.toBeInTheDocument();
      expect(container.querySelector('[data-slot="list-panel-disabled-overlay"]')).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("rules list", () => {
    beforeEach(() => {
      mockSettingsQueries({ senderApproved: true });
    });

    it("failed with no data: failure panel with retry, neither empty text", () => {
      const refetch = jest.fn();
      mockRules({
        data: undefined,
        isLoading: false,
        isError: true,
        isFetching: false,
        isPaused: false,
        refetch,
      });

      render(<TriggerRulesManager dataComponent={DC} />);

      const alert = screen.getByRole("alert");
      expect(within(alert).getByText("불러오지 못했습니다")).toBeInTheDocument();
      expect(screen.queryByText(ACTIVE_EMPTY_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByText(INACTIVE_EMPTY_TEXT)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByText(INACTIVE_EMPTY_TEXT)).not.toBeInTheDocument();

      fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("paused with no data: reads as loading, neither empty text nor an alert", () => {
      mockRules({ ...PAUSED_QUERY_RESULT, refetch: jest.fn() });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.queryByText(ACTIVE_EMPTY_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByText(INACTIVE_EMPTY_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      // The loading state hides the new-rule action, exactly as a loading query does.
      expect(screen.queryByRole("button", { name: "새 규칙" })).not.toBeInTheDocument();
    });

    it("successful empty load: the empty text for each tab and no alert", () => {
      mockRules({
        data: [],
        isLoading: false,
        isError: false,
        isFetching: false,
        isPaused: false,
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.getByText(ACTIVE_EMPTY_TEXT)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
      expect(screen.getByText(INACTIVE_EMPTY_TEXT)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("cached rules and a failed refetch: rows stay with exactly one inline notice that retries", () => {
      const refetch = jest.fn();
      mockRules({
        data: [RULE],
        isLoading: false,
        isError: true,
        isFetching: false,
        isPaused: false,
        refetch,
      });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.getByText(RULE_NAME)).toBeInTheDocument();
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(within(alerts[0]).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();

      fireEvent.click(within(alerts[0]).getByRole("button", { name: "다시 시도" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("cached rules and a refetch in flight: the notice's retry is disabled", () => {
      mockRules({
        data: [RULE],
        isLoading: false,
        isError: true,
        isFetching: true,
        isPaused: false,
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeDisabled();
    });

    it("an earlier successful empty load and a failed refetch: the empty text plus the inline notice, not the failure panel", () => {
      mockRules({
        data: [],
        isLoading: false,
        isError: true,
        isFetching: false,
        isPaused: false,
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.getByText(ACTIVE_EMPTY_TEXT)).toBeInTheDocument();
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(within(alerts[0]).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();
    });

    it("cached rules with a paused refetch change nothing", () => {
      mockRules({
        data: [RULE],
        isLoading: false,
        isError: false,
        isFetching: false,
        isPaused: true,
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.getByText(RULE_NAME)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "새 규칙" })).toBeInTheDocument();
    });

    it("the unapproved screen keeps its overlay and shows no list failure of its own", () => {
      mockSettingsQueries({ senderApproved: false });
      mockRules({
        data: undefined,
        isLoading: false,
        isError: true,
        isFetching: false,
        isPaused: false,
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getAllByText(APPROVAL_MESSAGE)).toHaveLength(2);
    });
  });

  describe("automation policy and client-registration policy queries", () => {
    it("paused automation policies with no data show the loading card, not the failure card", () => {
      mockSettingsQueries({ senderApproved: true, messageAutomationPoliciesPaused: true });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.getByText("이 지점의 메시지 자동 발송 설정을 불러오는 중이에요.")).toBeInTheDocument();
      expect(screen.queryByText("설정 정보를 불러오지 못했어요.")).not.toBeInTheDocument();
      expect(screen.queryByText("이 지점의 메시지 자동 발송 설정을 확인할 수 없어요.")).not.toBeInTheDocument();
    });

    it("a failed automation policies load keeps the existing failure card with its retry", () => {
      const messageAutomationPoliciesRefetch = jest.fn();
      mockSettingsQueries({
        senderApproved: true,
        messageAutomationPoliciesError: true,
        messageAutomationPoliciesRefetch,
      });

      render(<TriggerRulesManager dataComponent={DC} />);

      expect(screen.getByText("설정 정보를 불러오지 못했어요.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(messageAutomationPoliciesRefetch).toHaveBeenCalledTimes(1);
    });

    it("paused client-registration policy with no data shows the loading state, not a default toggle", () => {
      mockSettingsQueries({ senderApproved: true, clientRegistrationPolicyPaused: true });
      mockRules({
        data: [{ ...RULE, id: "client-greeting-rule", name: "인사 메시지", eventType: "CLIENT_CREATED", offsetType: "IMMEDIATE", offsetDays: 0, templateKey: "CLIENT_GREETING" }],
        isLoading: false,
        isError: false,
        isFetching: false,
        isPaused: false,
        refetch: jest.fn(),
      });
      mockedUseMessageTriggerTemplates.mockReturnValue({
        data: [{
          key: "CLIENT_GREETING",
          name: "인사 메시지",
          description: "고객 등록 인사 메시지입니다.",
          allowedEventTypes: ["CLIENT_CREATED"],
          allowedRecipientTypes: ["CLIENT"],
          requiredVariables: [],
          providers: { sms: { templateKey: "CLIENT_GREETING" } },
        }],
      } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

      render(<TriggerRulesManager dataComponent={DC} />);
      fireEvent.click(screen.getAllByText("인사 메시지")[0]);

      expect(screen.getAllByText("고객 자동 등록 설정을 불러오는 중이에요.").length).toBeGreaterThan(0);
      expect(screen.queryByRole("switch", { name: "전자문서 자동 등록 고객에게도 발송" })).not.toBeInTheDocument();
    });
  });

  describe("template catalog", () => {
    const NO_REQUIREMENTS_TEXT = "이 템플릿은 추가 정보 없이 발송할 수 있습니다.";
    const CATALOG_ERROR_TITLE = "템플릿 정보를 불러오지 못했습니다";
    const CATALOG_LOADING_TEXT = "템플릿 정보를 불러오는 중이에요.";
    const SERVICE_INFO_TEMPLATE = {
      key: "SERVICE_INFO",
      name: "서비스 안내",
      description: "서비스 시작 전에 안내합니다.",
      allowedEventTypes: ["SERVICE_START"],
      allowedRecipientTypes: ["CLIENT"],
      requiredVariables: [] as Array<{ key: string; label: string }>,
      providers: { sms: { templateKey: "SERVICE_INFO" } },
    };

    function mockCatalog(result: Record<string, unknown>) {
      mockedUseMessageTriggerTemplates.mockReturnValue(
        result as unknown as ReturnType<typeof useMessageTriggerTemplates>,
      );
    }

    function openExistingRuleAndEdit() {
      fireEvent.click(screen.getAllByText(RULE_NAME)[0]);
      fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "바뀐 이름" } });
    }

    beforeEach(() => {
      mockSettingsQueries({ senderApproved: true });
    });

    it("failed with no data: inline alert whose retry refetches the catalog, no requirements claim, save closed", () => {
      const refetch = jest.fn();
      mockCatalog({
        data: undefined,
        isLoading: false,
        isError: true,
        isFetching: false,
        isPaused: false,
        status: "error",
        fetchStatus: "idle",
        refetch,
      });

      render(<TriggerRulesManager dataComponent={DC} />);
      openExistingRuleAndEdit();

      const alert = screen.getByRole("alert");
      expect(within(alert).getByText(CATALOG_ERROR_TITLE)).toBeInTheDocument();
      expect(alert).toHaveAttribute("data-component", `${DC}_trigger-rules-template-catalog-error`);
      expect(screen.queryByText(NO_REQUIREMENTS_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByText("필수 자동 입력 정보")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("발송 템플릿")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
      // Rule rows do not depend on the catalog.
      expect(screen.getByRole("switch", { name: `${RULE_NAME} 활성화` })).toBeEnabled();
      expect(screen.getByRole("button", { name: "삭제" })).toBeEnabled();

      fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("paused with no data: loading wording, no alert, no requirements claim, save closed", () => {
      mockCatalog({ ...PAUSED_QUERY_RESULT, refetch: jest.fn() });

      render(<TriggerRulesManager dataComponent={DC} />);
      openExistingRuleAndEdit();

      expect(screen.getByText(CATALOG_LOADING_TEXT)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(CATALOG_ERROR_TITLE)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_REQUIREMENTS_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByLabelText("발송 템플릿")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
      expect(screen.getByRole("switch", { name: `${RULE_NAME} 활성화` })).toBeEnabled();
      expect(screen.getByRole("button", { name: "삭제" })).toBeEnabled();
    });

    it("loading with no data reads like paused: loading wording, save closed", () => {
      mockCatalog({
        data: undefined,
        isLoading: true,
        isError: false,
        isFetching: true,
        isPaused: false,
        status: "pending",
        fetchStatus: "fetching",
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);
      openExistingRuleAndEdit();

      expect(screen.getByText(CATALOG_LOADING_TEXT)).toBeInTheDocument();
      expect(screen.queryByText(NO_REQUIREMENTS_TEXT)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    });

    it("a loaded catalog whose template has no requirements says so and keeps save open", () => {
      mockCatalog({
        data: [SERVICE_INFO_TEMPLATE],
        isLoading: false,
        isError: false,
        isFetching: false,
        isPaused: false,
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);
      openExistingRuleAndEdit();

      expect(screen.getAllByText(NO_REQUIREMENTS_TEXT).length).toBeGreaterThan(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(CATALOG_LOADING_TEXT)).not.toBeInTheDocument();
      expect(screen.getByLabelText("발송 템플릿")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    });

    it("a loaded catalog whose template has requirements renders them", () => {
      mockCatalog({
        data: [{
          ...SERVICE_INFO_TEMPLATE,
          requiredVariables: [{ key: "name", label: "산모님 성함" }],
        }],
        isLoading: false,
        isError: false,
        isFetching: false,
        isPaused: false,
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);
      openExistingRuleAndEdit();

      expect(screen.getByText("산모님 성함")).toBeInTheDocument();
      expect(screen.getByText(/고객 정보에서 자동으로 입력/)).toBeInTheDocument();
      expect(screen.queryByText(NO_REQUIREMENTS_TEXT)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    });

    it("cached catalog data with a failed refetch keeps the editor exactly as loaded", () => {
      mockCatalog({
        data: [SERVICE_INFO_TEMPLATE],
        isLoading: false,
        isError: true,
        isFetching: false,
        isPaused: false,
        refetch: jest.fn(),
      });

      render(<TriggerRulesManager dataComponent={DC} />);
      openExistingRuleAndEdit();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getAllByText(NO_REQUIREMENTS_TEXT).length).toBeGreaterThan(0);
      expect(screen.getByLabelText("발송 템플릿")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    });
  });

  describe("editing handlers refuse an unknown approval (called without the disabled DOM control)", () => {
    // The disabled controls swallow DOM clicks, so a DOM click cannot tell a guarded handler from an
    // unguarded one. These tests call the control's own React onClick prop, which is the handler the
    // component wired in; React's disabled filter sits in front of it and is bypassed here.
    function reactPropsOf(element: Element): { onClick: (event: unknown) => void } {
      const key = Object.keys(element).find((name) => name.startsWith("__reactProps$"));
      if (!key) throw new Error("element has no React props");
      return (element as unknown as Record<string, { onClick: (event: unknown) => void }>)[key];
    }

    function callHandler(element: HTMLElement) {
      const event = {
        defaultPrevented: false,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
        isPropagationStopped: () => false,
      };
      act(() => {
        reactPropsOf(element).onClick(event);
      });
    }

    function mockMutations() {
      const updateMutation = jest.fn().mockResolvedValue(undefined);
      const deleteMutation = jest.fn().mockResolvedValue(undefined);
      const createMutation = jest.fn().mockResolvedValue(undefined);
      mockedUseUpdateMessageTriggerRule.mockReturnValue({
        isPending: false,
        mutateAsync: updateMutation,
      } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);
      mockedUseDeleteMessageTriggerRule.mockReturnValue({
        isPending: false,
        mutateAsync: deleteMutation,
      } as unknown as ReturnType<typeof useDeleteMessageTriggerRule>);
      mockedUseCreateMessageTriggerRule.mockReturnValue({
        isPending: false,
        mutateAsync: createMutation,
      } as unknown as ReturnType<typeof useCreateMessageTriggerRule>);
      return { updateMutation, deleteMutation, createMutation };
    }

    function openRuleForEditing() {
      fireEvent.click(screen.getAllByText(RULE_NAME)[0]);
      fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "바뀐 이름" } });
    }

    it("toggle: unknown approval calls no mutation; an approved answer toggles through the same route", async () => {
      mockSettingsQueries({ senderApproved: true, senderApprovalState: "failed" });
      const unknown = mockMutations();

      const { unmount } = render(<TriggerRulesManager dataComponent={DC} />);
      const blockedSwitch = screen.getByRole("switch", { name: `${RULE_NAME} 활성화` });
      expect(blockedSwitch).toBeDisabled();
      callHandler(blockedSwitch);
      await act(async () => {
        await Promise.resolve();
      });
      expect(unknown.updateMutation).not.toHaveBeenCalled();
      unmount();

      mockSettingsQueries({ senderApproved: true });
      const approved = mockMutations();
      render(<TriggerRulesManager dataComponent={DC} />);
      callHandler(screen.getByRole("switch", { name: `${RULE_NAME} 활성화` }));
      await waitFor(() => expect(approved.updateMutation).toHaveBeenCalledTimes(1));
      expect(approved.updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rule-1", dto: expect.objectContaining({ isActive: false }) }),
      );
    });

    it("save: unknown approval calls no mutation; an approved answer saves through the same route", async () => {
      mockSettingsQueries({ senderApproved: true, senderApprovalState: "failed" });
      const unknown = mockMutations();

      const { unmount } = render(<TriggerRulesManager dataComponent={DC} />);
      openRuleForEditing();
      const blockedSave = screen.getByRole("button", { name: "저장" });
      expect(blockedSave).toBeDisabled();
      callHandler(blockedSave);
      await act(async () => {
        await Promise.resolve();
      });
      expect(unknown.updateMutation).not.toHaveBeenCalled();
      expect(unknown.createMutation).not.toHaveBeenCalled();
      unmount();

      mockSettingsQueries({ senderApproved: true });
      const approved = mockMutations();
      render(<TriggerRulesManager dataComponent={DC} />);
      openRuleForEditing();
      callHandler(screen.getByRole("button", { name: "저장" }));
      await waitFor(() => expect(approved.updateMutation).toHaveBeenCalledTimes(1));
      expect(approved.updateMutation).toHaveBeenCalledWith(
        expect.objectContaining({ id: "rule-1", dto: expect.objectContaining({ name: "바뀐 이름" }) }),
      );
    });

    it("delete: unknown approval calls no mutation; an approved answer deletes through the same route", async () => {
      mockSettingsQueries({ senderApproved: true, senderApprovalState: "failed" });
      const unknown = mockMutations();

      const { unmount } = render(<TriggerRulesManager dataComponent={DC} />);
      fireEvent.click(screen.getAllByText(RULE_NAME)[0]);
      const blockedDelete = screen.getByRole("button", { name: "삭제" });
      expect(blockedDelete).toBeDisabled();
      callHandler(blockedDelete);
      await act(async () => {
        await Promise.resolve();
      });
      expect(unknown.deleteMutation).not.toHaveBeenCalled();
      unmount();

      mockSettingsQueries({ senderApproved: true });
      const approved = mockMutations();
      render(<TriggerRulesManager dataComponent={DC} />);
      fireEvent.click(screen.getAllByText(RULE_NAME)[0]);
      callHandler(screen.getByRole("button", { name: "삭제" }));
      await waitFor(() => expect(approved.deleteMutation).toHaveBeenCalledWith("rule-1"));
    });

    it("create: unknown approval offers no 새 규칙 control; an approved answer opens the new-rule editor", () => {
      // handleCreateNew is wired only to the 새 규칙 header button, which is not rendered while editing is
      // blocked, so its guard cannot be reached from a prop (reported, not exported for a test).
      mockSettingsQueries({ senderApproved: true, senderApprovalState: "failed" });
      mockMutations();

      const { unmount } = render(<TriggerRulesManager dataComponent={DC} />);
      expect(screen.queryByRole("button", { name: "새 규칙" })).not.toBeInTheDocument();
      expect(screen.queryByText("새 발송 규칙")).not.toBeInTheDocument();
      unmount();

      mockSettingsQueries({ senderApproved: true });
      mockMutations();
      render(<TriggerRulesManager dataComponent={DC} />);
      callHandler(screen.getByRole("button", { name: "새 규칙" }));
      expect(screen.getByText("새 발송 규칙")).toBeInTheDocument();
    });
  });
});

describe("TriggerRulesManager target client status and retry (BJJ-444)", () => {
  const DC = "desktop_messages_sections_section-content_triggers-section_trigger-rules";
  const baseRule = {
    id: "rule-1",
    branchId: "org-1",
    name: "서비스 시작 안내",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 3,
    sendTime: "09:00",
    recipientType: "CLIENT",
    templateKey: "SERVICE_INFO",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };

  function mockRules(rule: Record<string, unknown>) {
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [rule],
      isLoading: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
  }

  function mockUpdate() {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockedUseUpdateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useUpdateMessageTriggerRule>);
    return mutateAsync;
  }

  beforeEach(() => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
  });

  it("opens a new rule with 전체 and 실패 시 재전송 on, and offers the four statuses in order", () => {
    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    const statusTrigger = screen.getByLabelText("대상 고객 상태");
    expect(statusTrigger).toHaveTextContent("전체");
    expect(screen.getByText("일시적인 발송 실패를 5분 간격으로 최대 3번 다시 보냅니다.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "실패 시 재전송" })).toBeChecked();

    fireEvent.click(statusTrigger);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "전체",
      "예약 전",
      "대기",
      "진행",
    ]);
  });

  it("submits the changed status and retry switch when creating a rule", () => {
    const mutateAsync = jest.fn().mockResolvedValue({ id: "rule-created" });
    mockedUseCreateMessageTriggerRule.mockReturnValue({
      isPending: false,
      mutateAsync,
    } as unknown as ReturnType<typeof useCreateMessageTriggerRule>);

    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "대기 고객 안내" } });
    fireEvent.click(screen.getByLabelText("대상 고객 상태"));
    fireEvent.click(screen.getByRole("option", { name: "대기" }));
    fireEvent.click(screen.getByRole("switch", { name: "실패 시 재전송" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "대기 고객 안내",
        targetClientStatus: "waiting",
        retryOnFailure: false,
      }),
    );
  });

  it("submits the changed status and retry switch when updating a rule", () => {
    mockRules(baseRule);
    const mutateAsync = mockUpdate();

    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getAllByText("서비스 시작 안내")[0]);
    fireEvent.click(screen.getByLabelText("대상 고객 상태"));
    fireEvent.click(screen.getByRole("option", { name: "예약 전" }));
    fireEvent.click(screen.getByRole("switch", { name: "실패 시 재전송" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "rule-1",
      dto: expect.objectContaining({
        targetClientStatus: "pre_booking",
        retryOnFailure: false,
      }),
    });
  });

  it("shows the stored values when editing a rule", () => {
    mockRules({ ...baseRule, targetClientStatus: "active", retryOnFailure: false });

    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getAllByText("서비스 시작 안내")[0]);

    expect(screen.getByLabelText("대상 고객 상태")).toHaveTextContent("진행");
    expect(screen.getByRole("switch", { name: "실패 시 재전송" })).not.toBeChecked();
  });

  it("does not treat a rule lacking both fields as changed on open", () => {
    mockRules(baseRule);

    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getAllByText("서비스 시작 안내")[0]);

    expect(screen.getByLabelText("대상 고객 상태")).toHaveTextContent("전체");
    expect(screen.getByRole("switch", { name: "실패 시 재전송" })).toBeChecked();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("enables Save after changing only the status", () => {
    mockRules({ ...baseRule, targetClientStatus: "all", retryOnFailure: true });

    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getAllByText("서비스 시작 안내")[0]);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("대상 고객 상태"));
    fireEvent.click(screen.getByRole("option", { name: "진행" }));

    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("enables Save after changing only the retry switch", () => {
    mockRules({ ...baseRule, targetClientStatus: "all", retryOnFailure: true });

    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getAllByText("서비스 시작 안내")[0]);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();

    fireEvent.click(screen.getByRole("switch", { name: "실패 시 재전송" }));

    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("shows both controls disabled on a system rule", async () => {
    mockRules({
      ...baseRule,
      id: "system:service_record_link",
      branchId: null,
      name: "제공기록지 작성 링크",
      offsetType: "SAME_DAY",
      offsetDays: 0,
      recipientType: "PRIMARY_EMPLOYEE",
      templateKey: "SERVICE_RECORD_LINK",
      targetClientStatus: "waiting",
      retryOnFailure: false,
    });

    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText("제공기록지 작성 링크"));

    const statusTrigger = await screen.findByLabelText("대상 고객 상태");
    expect(statusTrigger).toBeDisabled();
    expect(statusTrigger).toHaveTextContent("대기");
    const retrySwitch = screen.getByRole("switch", { name: "실패 시 재전송" });
    expect(retrySwitch).toBeDisabled();
    expect(retrySwitch).not.toBeChecked();
  });
});
