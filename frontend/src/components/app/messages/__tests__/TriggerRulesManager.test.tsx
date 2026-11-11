import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MessageTriggerRuleGroupView, MessageTriggerRuleGroupPreviewRecipient, MessageTriggerRecipientMode } from "@babyjamjam/shared/types/message";
import { messageDeliveryApi } from "@/services/message-delivery";
import type { ReactNode } from "react";
import { TriggerRulesManager } from "../TriggerRulesManager";
import {
  useMessageTriggerRules,
  useMessageTriggerRuleGroups,
  useMessageTriggerGroupMutations,
  useMessageTriggerTemplates,
  useCreateMessageTriggerRule,
  useDeleteMessageTriggerRule,
  useUpdateMessageTriggerRule,
  useUpdateMessageTriggerRuleBranchActivation,
  useActivateMessageTriggerRuleWithParent,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { settingsApi, type MessageAutomationPoliciesResponse } from "@/services/api";

jest.mock("@/services/message-delivery", () => ({ messageDeliveryApi: { sendSms: jest.fn() } }));
jest.mock("@/features/system-templates/branch-context", () => ({ useActiveBranchId: () => "org-1", isBranchContextAligned: () => true }));
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
  useMessageTriggerRuleGroups: jest.fn(),
  useMessageTriggerGroupMutations: jest.fn(),
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
  systemTemplates?: Record<string, NonNullable<SettingsQueryState["systemTemplate"]>>;
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
  systemTemplates,
}: SettingsQueryState = {}) {
  mockedUseQuery.mockImplementation((options: QueryOptions) => {
    const queryKey = options.queryKey ?? [];

    if (queryKey.includes("message-automation-config")) return useQueryResult({ version: null, configuration: { defaultRuleSendTime: "09:00" }, permissions: { canRead: true, canWrite: true } });
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
      return useQueryResult(systemTemplates
        ? systemTemplates[String(queryKey[queryKey.length - 1])]
        : systemTemplate);
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
  const envelopeCache = new WeakMap<object, object>();
  jest.mocked(useMessageTriggerRuleGroups).mockImplementation(() => {
    const legacy = mockedUseMessageTriggerRules();
    let data: object | undefined;
    if (legacy.data) {
      data = envelopeCache.get(legacy.data);
      if (!data) { data = { groups: [], standaloneRules: legacy.data }; envelopeCache.set(legacy.data, data); }
    }
    return { ...legacy, data, refetch: async (...args: unknown[]) => {
      const result = await (legacy.refetch as (...args: unknown[]) => Promise<{ data?: unknown }> | undefined)?.(...args);
      return result && { ...result, data: result.data ? { groups: [], standaloneRules: result.data } : undefined };
    } } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>;
  });
  jest.mocked(useMessageTriggerGroupMutations).mockImplementation(() => ({
    create: mockedUseCreateMessageTriggerRule(),
    update: mockedUseUpdateMessageTriggerRule(),
    remove: mockedUseDeleteMessageTriggerRule(),
    preview: { isPending: false, mutateAsync: jest.fn() },
  }) as unknown as ReturnType<typeof useMessageTriggerGroupMutations>);
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
      recipientMode: "CLIENT",
      recipientTemplates: { CLIENT: "SERVICE_END_NOTICE" },
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
    expect(screen.getByRole("option", { name: "고객" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "주제공인력" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "고객" }));
    fireEvent.click(eventTrigger);
    fireEvent.click(screen.getByRole("option", { name: "서비스 시작" }));
    fireEvent.click(recipientTrigger);
    fireEvent.click(screen.getByRole("option", { name: "주제공인력" }));

    const templateTrigger = screen.getByLabelText("발송 템플릿");
    fireEvent.click(templateTrigger);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(allSmsTriggerTemplates.length);
    expect(screen.getByRole("option", { name: "비용 안내" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("option", { name: "리마인드 · 선택한 이벤트와 맞지 않음" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "서비스 안내 · 선택한 수신 대상과 맞지 않음" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "수동 영수증 안내 · 선택한 이벤트·수신 대상과 맞지 않음" }))
      .toHaveAttribute("aria-disabled", "true");
  });

  it("requires a compatible recipient mapping while keeping the full common catalog visible", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerTemplates.mockReturnValue({
      data: allSmsTriggerTemplates,
    } as unknown as ReturnType<typeof useMessageTriggerTemplates>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));

    const recipientTrigger = screen.getByLabelText("수신 대상");
    fireEvent.click(recipientTrigger);
    fireEvent.click(screen.getByRole("option", { name: "주제공인력" }));

    expect(screen.getByLabelText("주제공인력 템플릿")).not.toHaveTextContent("비용 안내");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("발송 템플릿"));
    expect(screen.getAllByRole("option")).toHaveLength(allSmsTriggerTemplates.length);
    expect(screen.getByRole("option", { name: "비용 안내" })).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("option", { name: "비용 안내" }));
    expect(screen.getByLabelText("발송 템플릿")).toHaveTextContent("비용 안내");
    expect(screen.getByLabelText("주제공인력 템플릿")).toHaveTextContent("비용 안내");
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
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("주 담당 제공인력");
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

  it("hides default rule deletion while keeping its activation toggle available", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [{ id: "default-rule", branchId: "branch-1", name: "기본 안내", isDefault: true, isActive: true,
        eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 7,
        recipientType: "CLIENT", templateKey: "SERVICE_INFO", targetClientStatus: "all", retryOnFailure: true,
        createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
      isLoading: false, refetch: jest.fn(),
    } as unknown as ReturnType<typeof useMessageTriggerRules>);
    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);
    expect(screen.getByRole("switch", { name: "기본 안내 활성화" })).toBeEnabled();
    fireEvent.click(screen.getByText("기본 안내"));
    expect(await screen.findByLabelText("규칙 이름")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
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
    expect(screen.getByText("시스템 자동화 · 서비스 시작 1일 전 12:00 (한국 시간) · 늦게 등록되면 즉시 발송 · 주 담당 제공인력")).toBeInTheDocument();
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
    // The legacy form reconciles to PRICE_INFO, but the group still needs an
    // explicit recipient mapping before its requirements should be displayed.
    expect(screen.queryByText("산모님 성함")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("고객 템플릿"));
    fireEvent.click(screen.getByRole("option", { name: "비용 안내" }));

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
      recipientMode: "CLIENT",
      recipientTemplates: { CLIENT: "SERVICE_INFO" },
      targetClientStatus: "all",
      retryOnFailure: true,
    });
  });

  it.each(["new", "standalone"])("blocks a %s automation rule when a required custom variable has no automatic source", async (mode) => {
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
    fireEvent.click(mode === "new"
      ? screen.getByRole("button", { name: "새 규칙" })
      : screen.getByText("서비스 시작 안내"));
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

describe("canonical recipient groups and read-only preview", () => {
  const DC = "desktop_messages_sections_section-content_triggers-section_trigger-rules";
  const baseGroup: MessageTriggerRuleGroupView = {
    id: "group-a", branchId: "org-1", name: "배정 시작 안내", recipientMode: "BOTH_EMPLOYEES", version: 4,
    createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", deletedAt: null,
    eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "09:20", targetClientStatus: "all", retryOnFailure: true, isActive: true,
    recipientTemplates: { PRIMARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE", SECONDARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE" },
    rules: [{ id: "child-primary", groupId: "group-a", branchId: "org-1", name: "배정 시작 안내 주", eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "09:20", targetClientStatus: "all", retryOnFailure: true, isActive: true, recipientType: "PRIMARY_EMPLOYEE", templateKey: "CAREGIVER_SERVICE_START_NOTICE", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" },
      { id: "child-secondary", groupId: "group-a", branchId: "org-1", name: "배정 시작 안내 보조", eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "09:20", targetClientStatus: "all", retryOnFailure: true, isActive: true, recipientType: "SECONDARY_EMPLOYEE", templateKey: "CAREGIVER_SERVICE_START_NOTICE", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z" }],
  };
  const primary: MessageTriggerRuleGroupPreviewRecipient = {
    ruleId: "child-primary", recipientType: "PRIMARY_EMPLOYEE", employeeId: 41, employeeScheduleId: 301,
    recipientName: "김주연", recipientPhone: "01011112222", templateKey: "CAREGIVER_SERVICE_START_NOTICE",
    body: "김주연님, 이고객님 배정은 11월 9일 시작합니다.", count: 1, scheduledFor: "2026-11-09T00:20:00.000Z",
    anchorSource: "employee_schedule.startDate", anchorDate: "2026-11-09", outcome: "ready", reason: null,
  };
  const secondary: MessageTriggerRuleGroupPreviewRecipient = {
    ruleId: "child-secondary", recipientType: "SECONDARY_EMPLOYEE", employeeId: 42, employeeScheduleId: 301,
    recipientName: "박보조", recipientPhone: "01033334444", templateKey: "CAREGIVER_SERVICE_START_NOTICE",
    body: "박보조님, 이고객님 배정은 11월 9일 시작합니다.", count: 1, scheduledFor: "2026-11-09T00:20:00.000Z",
    anchorSource: "employee_schedule.startDate", anchorDate: "2026-11-09", outcome: "ready", reason: null,
  };
  const client: MessageTriggerRuleGroupPreviewRecipient = {
    ruleId: "child-client", recipientType: "CLIENT", employeeId: null, employeeScheduleId: null,
    recipientName: "이고객", recipientPhone: "01055556666", templateKey: "SERVICE_INFO", body: "이고객님, 서비스는 11월 8일 시작합니다.", count: 1,
    scheduledFor: "2026-11-08T00:20:00.000Z", anchorSource: "client.startDate", anchorDate: "2026-11-08", outcome: "ready", reason: null,
  };
  function configure(group: MessageTriggerRuleGroupView = baseGroup, recipients: MessageTriggerRuleGroupPreviewRecipient[] = [primary, secondary]) {
    mockSettingsQueries({ senderApproved: true });
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [group], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    mockedUseMessageTriggerTemplates.mockReturnValue({ data: [
      { key: "SERVICE_INFO", name: "고객 서비스 안내", description: "고객 안내", allowedEventTypes: ["SERVICE_START"], allowedRecipientTypes: ["CLIENT"], requiredVariables: [], providers: { sms: { templateKey: "SERVICE_INFO" } } },
      { key: "CAREGIVER_SERVICE_START_NOTICE", name: "제공 시작 안내", description: "배정 안내", allowedEventTypes: ["SERVICE_START"], allowedRecipientTypes: ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"], requiredVariables: [], providers: { sms: { templateKey: "CAREGIVER_SERVICE_START_NOTICE" } } },
      { key: "CLIENT_GREETING", name: "고객 인사", description: "등록 인사", allowedEventTypes: ["CLIENT_CREATED"], allowedRecipientTypes: ["CLIENT"], requiredVariables: [], providers: { sms: { templateKey: "CLIENT_GREETING" } } },
    ] } as unknown as ReturnType<typeof useMessageTriggerTemplates>);
    const create = jest.fn().mockResolvedValue(group);
    const update = jest.fn().mockResolvedValue(group);
    const remove = jest.fn().mockResolvedValue(undefined);
    const preview = jest.fn().mockResolvedValue({ complete: true, count: recipients.reduce((sum, row) => sum + row.count, 0), recipients });
    jest.mocked(useMessageTriggerGroupMutations).mockReturnValue({ create: { isPending: false, mutateAsync: create }, update: { isPending: false, mutateAsync: update }, remove: { isPending: false, mutateAsync: remove }, preview: { isPending: false, mutateAsync: preview } } as unknown as ReturnType<typeof useMessageTriggerGroupMutations>);
    return { create, update, remove, preview };
  }
  function openGroup() {
    render(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getAllByText("배정 시작 안내")).toHaveLength(1);
    expect(screen.queryByText("배정 시작 안내 주")).not.toBeInTheDocument();
    expect(screen.queryByText("배정 시작 안내 보조")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("배정 시작 안내"));
  }
  async function previewGroup() {
    fireEvent.click(screen.getByRole("tab", { name: "미리보기" }));
    fireEvent.click(screen.getByRole("button", { name: "수신자 미리보기" }));
    await waitFor(() => expect(screen.getByText(/미리보기 완료/)).toBeInTheDocument());
  }
  it("validates the actual client template after replacing a template with unsupported requirements", async () => {
    const actions = configure();
    const catalog = mockedUseMessageTriggerTemplates({}).data!;
    mockedUseMessageTriggerTemplates.mockReturnValue({ data: catalog.map((template) => template.key === "CLIENT_GREETING"
      ? { ...template, allowedEventTypes: ["SERVICE_START"], requiredVariables: [{ key: "name", label: "인사 고객명" }] }
      : template) } as unknown as ReturnType<typeof useMessageTriggerTemplates>);
    mockSettingsQueries({ senderApproved: true, systemTemplates: {
      SERVICE_INFO: {
        id: "service-info", templateKey: "SERVICE_INFO", content: "예약번호 {{reservationCode}}",
        customVariables: [{ key: "reservationCode", label: "예약번호", required: true }],
        requiredVariables: [], updatedAt: "2026-11-01T00:00:00.000Z",
      },
      CLIENT_GREETING: {
        id: "client-greeting", templateKey: "CLIENT_GREETING", content: "안녕하세요",
        customVariables: [], requiredVariables: [], updatedAt: "2026-11-01T00:00:00.000Z",
      },
    } });
    render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "고객 인사 규칙" } });
    expect(screen.getByText(/자동 입력 출처가 없는 필수 변수/)).toHaveTextContent("예약번호");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("고객 템플릿"));
    fireEvent.click(screen.getByRole("option", { name: "고객 인사" }));
    expect(screen.queryByText(/자동 입력 출처가 없는 필수 변수/)).not.toBeInTheDocument();
    expect(screen.getByText("인사 고객명")).toBeInTheDocument();
    expect(screen.queryByText("예약번호")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledWith(expect.objectContaining({
      recipientMode: "CLIENT", recipientTemplates: { CLIENT: "CLIENT_GREETING" },
    })));
  });
  it.each([
    ["PRIMARY_EMPLOYEE", "주제공인력 템플릿"],
    ["SECONDARY_EMPLOYEE", "보조제공인력 템플릿"],
  ] as const)("checks requirements for the actual %s template in a mixed group", async (role, label) => {
    const actions = configure();
    const catalog = mockedUseMessageTriggerTemplates({}).data!;
    mockedUseMessageTriggerTemplates.mockReturnValue({ data: catalog.map((template) => template.key === "SERVICE_INFO"
      ? { ...template, allowedRecipientTypes: ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"], requiredVariables: [{ key: "name", label: "안내 고객명" }] }
      : template.key === "CAREGIVER_SERVICE_START_NOTICE"
        ? { ...template, requiredVariables: [{ key: "employeeName", label: "제공인력 이름" }] }
        : template) } as unknown as ReturnType<typeof useMessageTriggerTemplates>);
    mockSettingsQueries({ senderApproved: true, systemTemplates: {
      SERVICE_INFO: {
        id: "service-info", templateKey: "SERVICE_INFO", content: "예약번호 {{reservationCode}}",
        customVariables: [{ key: "reservationCode", label: "예약번호", required: true }],
        requiredVariables: [], updatedAt: "2026-11-01T00:00:00.000Z",
      },
      CAREGIVER_SERVICE_START_NOTICE: {
        id: "caregiver-start", templateKey: "CAREGIVER_SERVICE_START_NOTICE", content: "배정 안내",
        customVariables: [], requiredVariables: [], updatedAt: "2026-11-01T00:00:00.000Z",
      },
    } });
    openGroup();
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "혼합 템플릿 규칙" } });
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole("option", { name: "고객 서비스 안내" }));
    expect(screen.getByText(/자동 입력 출처가 없는 필수 변수/)).toHaveTextContent("예약번호");
    expect(screen.getByText("안내 고객명")).toBeInTheDocument();
    expect(screen.getByText("제공인력 이름")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(actions.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole("option", { name: "제공 시작 안내" }));
    expect(screen.queryByText(/자동 입력 출처가 없는 필수 변수/)).not.toBeInTheDocument();
    expect(screen.queryByText("안내 고객명")).not.toBeInTheDocument();
    expect(screen.getAllByText("제공인력 이름")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith({ id: baseGroup.id, draft: expect.objectContaining({
      recipientMode: "BOTH_EMPLOYEES", recipientTemplates: { ...baseGroup.recipientTemplates, [role]: "CAREGIVER_SERVICE_START_NOTICE" },
    }) }));
  });
  it.each([
    ["PRIMARY_EMPLOYEE", "주제공인력 템플릿"],
    ["SECONDARY_EMPLOYEE", "보조제공인력 템플릿"],
  ] as const)("validates the retained %s draft mapping across status refetches and 409", async (role, label) => {
    const actions = configure();
    actions.update.mockRejectedValue({ response: { status: 409 } });
    const catalog = mockedUseMessageTriggerTemplates({}).data!;
    mockedUseMessageTriggerTemplates.mockReturnValue({ data: catalog.map((template) => template.key === "SERVICE_INFO"
      ? { ...template, allowedRecipientTypes: ["CLIENT", "PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"], requiredVariables: [{ key: "name", label: "안내 고객명" }] }
      : template) } as unknown as ReturnType<typeof useMessageTriggerTemplates>);
    mockSettingsQueries({ senderApproved: true, systemTemplates: {
      SERVICE_INFO: {
        id: "service-info", templateKey: "SERVICE_INFO", content: "예약번호 {{reservationCode}}",
        customVariables: [{ key: "reservationCode", label: "예약번호", required: true }],
        requiredVariables: [], updatedAt: "2026-11-01T00:00:00.000Z",
      },
      CAREGIVER_SERVICE_START_NOTICE: {
        id: "caregiver-start", templateKey: "CAREGIVER_SERVICE_START_NOTICE", content: "배정 안내",
        customVariables: [], requiredVariables: [], updatedAt: "2026-11-01T00:00:00.000Z",
      },
    } });
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText(baseGroup.name));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "남길 혼합 초안" } });
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole("option", { name: "고객 서비스 안내" }));

    const remote: MessageTriggerRuleGroupView = {
      ...baseGroup, version: 5, name: "원격 비활성 규칙", isActive: false,
      recipientMode: "CLIENT", recipientTemplates: { CLIENT: "SERVICE_INFO" },
      rules: baseGroup.rules.map((rule) => ({ ...rule, isActive: false })),
    };
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [remote], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("남길 혼합 초안");
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("주보조 모두");
    expect(screen.getByLabelText(label)).toHaveTextContent("고객 서비스 안내");
    expect(screen.getByText("안내 고객명")).toBeInTheDocument();
    expect(screen.getByText(/자동 입력 출처가 없는 필수 변수/)).toHaveTextContent("예약번호");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(actions.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole("option", { name: "제공 시작 안내" }));
    expect(screen.queryByText("안내 고객명")).not.toBeInTheDocument();
    expect(screen.queryByText(/자동 입력 출처가 없는 필수 변수/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));

    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [{ ...remote, version: 6 }], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("남길 혼합 초안");
    expect(screen.getByLabelText(label)).toHaveTextContent("제공 시작 안내");
    expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존");
    expect(screen.queryByText(/자동 입력 출처가 없는 필수 변수/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(2));
    expect(actions.update).toHaveBeenNthCalledWith(1, { id: baseGroup.id, draft: expect.objectContaining({
      expectedVersion: 4, name: "남길 혼합 초안", isActive: true, recipientMode: "BOTH_EMPLOYEES",
      recipientTemplates: baseGroup.recipientTemplates,
    }) });
    expect(actions.update).toHaveBeenNthCalledWith(2, { id: baseGroup.id, draft: expect.objectContaining({
      expectedVersion: 4, recipientTemplates: baseGroup.recipientTemplates,
    }) });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
  });
  it("shows all four catalog modes, requires per-role templates and fills common compatible templates", () => {
    const actions = configure(); openGroup();
    expect(screen.getByText("제공인력 발송은 배정 일정 기준입니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("수신 대상"));
    for (const label of ["고객", "주제공인력", "보조제공인력", "주보조 모두"]) expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "고객" }));
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(actions.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("발송 템플릿"));
    fireEvent.click(screen.getByRole("option", { name: "고객 서비스 안내" }));
    expect(screen.getByLabelText("고객 템플릿")).toHaveTextContent("고객 서비스 안내");
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("이벤트 기준"));
    fireEvent.click(screen.getByRole("option", { name: "고객 등록" }));
    fireEvent.click(screen.getByLabelText("수신 대상"));
    expect(screen.getByRole("option", { name: "고객" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "주보조 모두" })).not.toBeInTheDocument();
    expect(actions.preview).not.toHaveBeenCalled();
  });
  it("updates the parent with its literal version and all required role mappings", async () => {
    const actions = configure(); openGroup();
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "배정 시작 변경" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith({ id: "group-a", draft: {
      expectedVersion: 4, name: "배정 시작 변경", recipientMode: "BOTH_EMPLOYEES", recipientTemplates: { PRIMARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE", SECONDARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE" },
      eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "09:20", targetClientStatus: "all", retryOnFailure: true, isActive: true,
    } }));
  });
  it.each([
    ["CLIENT", [client], ["이고객님, 서비스는 11월 8일 시작합니다."], 1],
    ["PRIMARY_EMPLOYEE", [primary], ["김주연님, 이고객님 배정은 11월 9일 시작합니다."], 1],
    ["SECONDARY_EMPLOYEE", [secondary], ["박보조님, 이고객님 배정은 11월 9일 시작합니다."], 1],
    ["BOTH_EMPLOYEES", [primary, secondary], ["김주연님, 이고객님 배정은 11월 9일 시작합니다.", "박보조님, 이고객님 배정은 11월 9일 시작합니다."], 2],
  ] as const)("renders literal %s identities/bodies/counts from the server", async (mode, recipients, bodies, count) => {
    const role = mode === "BOTH_EMPLOYEES" ? "PRIMARY_EMPLOYEE" : mode;
    const group = { ...baseGroup, recipientMode: mode as MessageTriggerRecipientMode, recipientTemplates: mode === "BOTH_EMPLOYEES" ? baseGroup.recipientTemplates : { [role]: mode === "CLIENT" ? "SERVICE_INFO" : "CAREGIVER_SERVICE_START_NOTICE" } };
    const actions = configure(group, [...recipients]); openGroup(); await previewGroup();
    expect(screen.getByText(`미리보기 완료 · 발송 가능 ${count}건`)).toBeInTheDocument();
    for (const body of bodies) expect(screen.getByText(body)).toBeInTheDocument();
    const result = document.querySelector(`[data-component="${DC}_trigger-rules-server-preview_result"]`)!;
    expect(result.querySelectorAll('[data-source-component="InfoCard"]')).toHaveLength(count);
    expect(result).toHaveTextContent(mode === "CLIENT" ? "고객 서비스 시작일 · 2026-11-08" : "배정 시작일 · 2026-11-09");
    expect(result).toHaveTextContent(mode === "CLIENT" ? "01055556666" : mode === "SECONDARY_EMPLOYEE" ? "01033334444" : "01011112222");
    expect(result).toHaveTextContent(mode === "CLIENT" ? "2026. 11. 08. 09:20 (한국 시간)" : "2026. 11. 09. 09:20 (한국 시간)");
    expect(actions.preview).toHaveBeenCalledWith({ draft: { name: "배정 시작 안내", recipientMode: mode, recipientTemplates: group.recipientTemplates, eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "09:20", targetClientStatus: "all", retryOnFailure: true, isActive: true } });
    expect(actions.create).not.toHaveBeenCalled(); expect(actions.update).not.toHaveBeenCalled();
    expect(messageDeliveryApi.sendSms).not.toHaveBeenCalled();
  });
  it.each([
    ["보조 없음", [primary, { ...secondary, employeeId: null, recipientName: null, recipientPhone: null, body: null, count: 0, outcome: "skip", reason: "배정 없음" }], 1, "배정 없음"],
    ["같은 직원", [primary, { ...secondary, employeeId: 41, recipientName: "김주연", recipientPhone: "01011112222", body: null, count: 0, outcome: "skip", reason: "동일 제공인력 중복 제외" }], 1, "같은 제공인력이므로 중복 대상에서 제외합니다."],
    ["같은 번호 다른 본문", [{ ...primary, recipientPhone: "01099990000", count: 0, outcome: "needs_setup", reason: "recipient_phone_conflict" }, { ...secondary, recipientPhone: "01099990000", count: 0, outcome: "needs_setup", reason: "recipient_phone_conflict" }], 0, "recipient_phone_conflict"],
  ] as const)("preserves the server outcome for %s without a send", async (_label, recipients, count, reason) => {
    configure(baseGroup, recipients as unknown as MessageTriggerRuleGroupPreviewRecipient[]); openGroup(); await previewGroup();
    const result = document.querySelector(`[data-component="${DC}_trigger-rules-server-preview_result"]`)!;
    expect(result).toHaveTextContent(`발송 가능 ${count}건`); expect(result).toHaveTextContent(reason === "recipient_phone_conflict" ? "같은 전화번호에 서로 다른 본문이 있어 확인이 필요합니다." : reason === "배정 없음" ? "배정 일정이 없습니다." : reason);
    expect(result.querySelectorAll('[data-source-component="InfoCard"]')).toHaveLength(recipients.length);
    expect(messageDeliveryApi.sendSms).not.toHaveBeenCalled();
  });
  it("blocks save and read-only preview with an empty required mapping", () => {
    const actions = configure(); openGroup();
    fireEvent.click(screen.getByLabelText("수신 대상"));
    fireEvent.click(screen.getByRole("option", { name: "주제공인력" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(actions.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "미리보기" }));
    expect(screen.getByRole("button", { name: "수신자 미리보기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "수신자 미리보기" }));
    expect(actions.preview).not.toHaveBeenCalled();
    expect(messageDeliveryApi.sendSms).not.toHaveBeenCalled();
  });
  it.each(["create", "update"] as const)("locks every group editor control while %s is pending and unlocks after settlement", async (operation) => {
    const group: MessageTriggerRuleGroupView = { ...baseGroup, offsetType: "BEFORE_DAYS", offsetDays: 2, rules: baseGroup.rules.map((rule) => ({ ...rule, offsetType: "BEFORE_DAYS", offsetDays: 2 })) };
    const actions = configure(group);
    const mutationState = {
      create: { isPending: false, mutateAsync: actions.create }, update: { isPending: false, mutateAsync: actions.update },
      remove: { isPending: false, mutateAsync: actions.remove }, preview: { isPending: false, mutateAsync: actions.preview },
    };
    let settle!: (value: MessageTriggerRuleGroupView) => void;
    actions[operation].mockImplementation(() => {
      mutationState[operation].isPending = true;
      return new Promise((resolve) => { settle = resolve; });
    });
    jest.mocked(useMessageTriggerGroupMutations).mockReturnValue(mutationState as unknown as ReturnType<typeof useMessageTriggerGroupMutations>);
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    if (operation === "create") fireEvent.click(screen.getByRole("button", { name: "새 규칙" }));
    else fireEvent.click(screen.getByText("배정 시작 안내"));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "저장할 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(actions[operation]).toHaveBeenCalledTimes(1);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    const labels = ["규칙 이름", "이벤트 기준", "발송 시점", "발송 시각 (한국 시간)", "수신 대상", "대상 고객 상태", "기준 일수", "발송 템플릿", ...(operation === "create" ? ["고객 템플릿"] : ["주제공인력 템플릿", "보조제공인력 템플릿"])];
    for (const label of labels) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByRole("switch", { name: "실패 시 재전송" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장 중..." })).toBeDisabled();
    const saved: MessageTriggerRuleGroupView = operation === "create"
      ? { ...group, id: "group-created", name: "저장할 초안", version: 1, recipientMode: "CLIENT", recipientTemplates: { CLIENT: "SERVICE_INFO" }, offsetDays: 7, sendTime: "09:00", rules: [{ ...group.rules[0], id: "created-child", groupId: "group-created", recipientType: "CLIENT", templateKey: "SERVICE_INFO", offsetDays: 7, sendTime: "09:00" }] }
      : { ...group, name: "저장할 초안", version: 5 };
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [saved], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    await act(async () => { mutationState[operation].isPending = false; settle(saved); });
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    for (const label of labels) expect(screen.getByLabelText(label)).toBeEnabled();
    expect(screen.getByRole("switch", { name: "실패 시 재전송" })).toBeEnabled();
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("저장할 초안");
  });
  it("preserves idle local edits when an unrelated group list refetch replaces the selected object", () => {
    const actions = configure();
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText("배정 시작 안내"));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "아직 저장하지 않은 이름" } });
    fireEvent.click(screen.getByLabelText("수신 대상"));
    fireEvent.click(screen.getByRole("option", { name: "보조제공인력" }));
    fireEvent.click(screen.getByLabelText("보조제공인력 템플릿"));
    fireEvent.click(screen.getByRole("option", { name: "제공 시작 안내" }));
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [{ ...baseGroup, recipientTemplates: { ...baseGroup.recipientTemplates }, rules: [...baseGroup.rules] }, { ...baseGroup, id: "unrelated-group", name: "다른 규칙" }], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("아직 저장하지 않은 이름");
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("보조제공인력");
    expect(screen.getByLabelText("보조제공인력 템플릿")).toHaveTextContent("제공 시작 안내");
    expect(screen.queryByLabelText("주제공인력 템플릿")).not.toBeInTheDocument();
    expect(actions.update).not.toHaveBeenCalled();
    expect(actions.create).not.toHaveBeenCalled();
  });
  it("keeps the group draft after stale409 and never retries an overwrite", async () => {
    const actions = configure(); actions.update.mockRejectedValue({ response: { status: 409 } }); openGroup();
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "남길 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("새로고침"));
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("남길 초안"); expect(actions.update).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["name edits", true, false, false],
    ["recipient mapping edits", false, true, false],
    ["name and mapping edits", true, true, false],
    ["a draft retained after 409", true, true, true],
  ] as const)("preserves %s and the original expected version across a newer group refetch", async (_label, editName, editMapping, conflict) => {
    const actions = configure();
    actions.update.mockRejectedValue({ response: { status: 409 } });
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText(baseGroup.name));
    if (editName) fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "남길 초안" } });
    if (editMapping) {
      fireEvent.click(screen.getByLabelText("수신 대상"));
      fireEvent.click(screen.getByRole("option", { name: "보조제공인력" }));
      fireEvent.click(screen.getByLabelText("보조제공인력 템플릿"));
      fireEvent.click(screen.getByRole("option", { name: "제공 시작 안내" }));
    }
    if (conflict) {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
    }
    const remote: MessageTriggerRuleGroupView = { ...baseGroup, version: 5, name: "원격 변경", recipientMode: "CLIENT", recipientTemplates: { CLIENT: "SERVICE_INFO" } };
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [remote], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue(editName ? "남길 초안" : baseGroup.name);
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent(editMapping ? "보조제공인력" : "주보조 모두");
    expect(screen.getByLabelText("보조제공인력 템플릿")).toHaveTextContent("제공 시작 안내");
    if (conflict) expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존");
    expect(actions.update).toHaveBeenCalledTimes(conflict ? 1 : 0);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(conflict ? 2 : 1));
    expect(actions.update).toHaveBeenLastCalledWith({ id: baseGroup.id, draft: expect.objectContaining({
      expectedVersion: 4, name: editName ? "남길 초안" : baseGroup.name,
      recipientMode: editMapping ? "SECONDARY_EMPLOYEE" : "BOTH_EMPLOYEES",
      recipientTemplates: editMapping ? { SECONDARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE" } : baseGroup.recipientTemplates,
    }) });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));

    // Leaving the editor and reopening explicitly discards the retained draft.
    fireEvent.click(screen.getByRole("button", { name: "목록으로 돌아가기" }));
    fireEvent.click(screen.getByText(remote.name));
    expect(screen.getByLabelText("규칙 이름")).toHaveValue(remote.name);
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("고객");
    expect(screen.getByLabelText("고객 템플릿")).toHaveTextContent("고객 서비스 안내");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "다시 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenLastCalledWith({ id: baseGroup.id, draft: expect.objectContaining({ expectedVersion: 5 }) }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
  });
  it("refreshes a pristine group and starts the next edit from the refreshed version", async () => {
    const actions = configure();
    actions.update.mockRejectedValue({ response: { status: 409 } });
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText(baseGroup.name));
    const remote: MessageTriggerRuleGroupView = { ...baseGroup, version: 5, name: "원격 변경", recipientMode: "CLIENT", recipientTemplates: { CLIENT: "SERVICE_INFO" }, sendTime: "10:30" };
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [remote], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue(remote.name);
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("10:30");
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("고객");
    expect(screen.getByLabelText("고객 템플릿")).toHaveTextContent("고객 서비스 안내");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "새 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith({ id: baseGroup.id, draft: expect.objectContaining({ expectedVersion: 5, name: "새 편집" }) }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
  });
  it("preserves a per-role template edit without a name or recipient-mode change", async () => {
    const actions = configure();
    const catalog = mockedUseMessageTriggerTemplates({}).data!;
    mockedUseMessageTriggerTemplates.mockReturnValue({ data: catalog.map((template) => template.key === "SERVICE_INFO"
      ? { ...template, allowedRecipientTypes: ["CLIENT", "SECONDARY_EMPLOYEE"] }
      : template) } as unknown as ReturnType<typeof useMessageTriggerTemplates>);
    actions.update.mockRejectedValue({ response: { status: 409 } });
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText(baseGroup.name));
    fireEvent.click(screen.getByLabelText("보조제공인력 템플릿"));
    fireEvent.click(screen.getByRole("option", { name: "고객 서비스 안내" }));
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [{ ...baseGroup, version: 5 }], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue(baseGroup.name);
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("주보조 모두");
    expect(screen.getByLabelText("보조제공인력 템플릿")).toHaveTextContent("고객 서비스 안내");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith({ id: baseGroup.id, draft: expect.objectContaining({
      expectedVersion: 4, recipientTemplates: { PRIMARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE", SECONDARY_EMPLOYEE: "SERVICE_INFO" },
    }) }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
  });
  it("reconciles its own successful save and uses that revision for the next draft", async () => {
    const actions = configure();
    const saved: MessageTriggerRuleGroupView = { ...baseGroup, version: 5, name: "저장된 이름", sendTime: "10:30" };
    actions.update.mockResolvedValueOnce(saved).mockRejectedValue({ response: { status: 409 } });
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText(baseGroup.name));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "저장할 이름" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByLabelText("규칙 이름")).toHaveValue(saved.name));
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("10:30");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    // A lagging list response must not restore the revision from before this save.
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue(saved.name);
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "다음 초안" } });
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [{ ...saved, version: 6, name: "다른 곳의 변경" }], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("다음 초안");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenLastCalledWith({ id: baseGroup.id, draft: expect.objectContaining({ expectedVersion: 5, name: "다음 초안" }) }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
  });
  it.each([false, true])("retains a dirty selection excluded by a status-changing refetch (409: %s)", async (conflict) => {
    const actions = configure();
    actions.update.mockRejectedValue({ response: { status: 409 } });
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText(baseGroup.name));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "남길 초안" } });
    fireEvent.click(screen.getByLabelText("수신 대상"));
    fireEvent.click(screen.getByRole("option", { name: "보조제공인력" }));
    fireEvent.click(screen.getByLabelText("보조제공인력 템플릿"));
    fireEvent.click(screen.getByRole("option", { name: "제공 시작 안내" }));
    if (conflict) {
      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
    }
    const remote: MessageTriggerRuleGroupView = {
      ...baseGroup, version: 5, name: "원격 비활성 규칙", isActive: false,
      recipientMode: "CLIENT", recipientTemplates: { CLIENT: "SERVICE_INFO" },
      rules: baseGroup.rules.map((rule) => ({ ...rule, isActive: false })),
    };
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [remote], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("남길 초안");
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("보조제공인력");
    expect(screen.getByLabelText("보조제공인력 템플릿")).toHaveTextContent("제공 시작 안내");
    if (conflict) expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존");
    expect(actions.update).toHaveBeenCalledTimes(conflict ? 1 : 0);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenLastCalledWith({ id: baseGroup.id, draft: expect.objectContaining({
      expectedVersion: 4, name: "남길 초안", isActive: true, recipientMode: "SECONDARY_EMPLOYEE",
      recipientTemplates: { SECONDARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE" },
    }) }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));

    fireEvent.click(screen.getByRole("button", { name: "목록으로 돌아가기" }));
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    fireEvent.click(screen.getByText(remote.name));
    expect(screen.getByLabelText("규칙 이름")).toHaveValue(remote.name);
    expect(screen.getByLabelText("수신 대상")).toHaveTextContent("고객");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "새 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenLastCalledWith({ id: baseGroup.id, draft: expect.objectContaining({ expectedVersion: 5, isActive: false }) }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
  });
  it("clears a pristine selection excluded by a status-changing refetch and reopens the refreshed revision", async () => {
    const actions = configure();
    actions.update.mockRejectedValue({ response: { status: 409 } });
    const view = render(<TriggerRulesManager dataComponent={DC} />);
    fireEvent.click(screen.getByText(baseGroup.name));
    const remote: MessageTriggerRuleGroupView = {
      ...baseGroup, version: 5, name: "원격 비활성 규칙", isActive: false,
      rules: baseGroup.rules.map((rule) => ({ ...rule, isActive: false })),
    };
    jest.mocked(useMessageTriggerRuleGroups).mockReturnValue({ data: { groups: [remote], standaloneRules: [] }, isLoading: false, refetch: jest.fn() } as unknown as ReturnType<typeof useMessageTriggerRuleGroups>);
    view.rerender(<TriggerRulesManager dataComponent={DC} />);
    expect(screen.queryByLabelText("규칙 이름")).not.toBeInTheDocument();
    expect(actions.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "비활성화" }));
    fireEvent.click(screen.getByText(remote.name));
    expect(screen.getByLabelText("규칙 이름")).toHaveValue(remote.name);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "새 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(actions.update).toHaveBeenCalledWith({ id: baseGroup.id, draft: expect.objectContaining({ expectedVersion: 5, isActive: false }) }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("초안을 보존"));
  });
});
