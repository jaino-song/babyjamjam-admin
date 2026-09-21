import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

type QueryOptions = {
  queryKey?: readonly unknown[];
};

interface SettingsQueryState {
  providerEnabled?: boolean;
  senderApproved?: boolean;
  clientRegistrationPolicy?: {
    clientAutoRegistration: boolean;
    greetingOnAutoRegistration: boolean;
  };
  clientRegistrationPolicyLoading?: boolean;
  clientRegistrationPolicyError?: boolean;
  messageAutomationPolicies?: MessageAutomationPoliciesResponse;
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
  clientRegistrationPolicy = {
    clientAutoRegistration: true,
    greetingOnAutoRegistration: false,
  },
  clientRegistrationPolicyLoading = false,
  clientRegistrationPolicyError = false,
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
  messageAutomationPoliciesRefetch = jest.fn(),
  systemTemplate,
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

    if (queryKey.includes("client-registration-policy")) {
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

  it("normalizes the legacy system SERVICE_END_NOTICE name without changing user-authored names", async () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [
        {
          id: "system:service-end-notice",
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

    expect(screen.getByText("서비스 종료 안내")).toBeInTheDocument();
    expect(screen.getByText("수동 영수증 안내")).toBeInTheDocument();
    expect(screen.queryByText("서비스 종료 안내 (수동 발송)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("서비스 종료 안내"));
    await waitFor(() => expect(screen.getByLabelText("규칙 이름")).toHaveValue("서비스 종료 안내"));
    expect(screen.getByLabelText("규칙 이름")).toBeDisabled();
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
    fireEvent.click(screen.getByLabelText("발송 템플릿"));

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByText("제공기록지 작성 링크")).not.toBeInTheDocument();
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
    expect(screen.getByText("시스템 자동화 · 서비스 시작 · 시작 당일 09:00 (한국 시간) · 주 담당 직원")).toBeInTheDocument();
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
