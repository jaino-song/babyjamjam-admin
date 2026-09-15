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
} from "@/features/message-triggers/hooks/use-message-triggers";
import { settingsApi } from "@/services/api";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: jest.fn(),
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
  systemTemplate?: {
    id: string;
    templateKey: string;
    content: string;
    customVariables: Array<{ key: string; label: string; required: boolean }>;
    requiredVariables: Array<{ key: string; label: string; required: boolean; type: string }>;
    updatedAt: string;
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
        recipientType: "CLIENT",
        templateKey: "SERVICE_INFO",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
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

  it("hides manual-only SERVICE_END_NOTICE rules while retaining the backend service-record rule", () => {
    mockSettingsQueries({ providerEnabled: true, senderApproved: true });
    mockedUseMessageTriggerRules.mockReturnValue({
      data: [
        {
          id: "manual-service-end-notice",
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
    } as unknown as ReturnType<typeof useMessageTriggerRules>);

    render(<TriggerRulesManager dataComponent="desktop_messages_sections_section-content_triggers-section_trigger-rules" />);

    expect(screen.queryByText("수동 영수증 안내")).not.toBeInTheDocument();
    expect(screen.getByText("제공기록지 작성 링크")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "제공기록지 작성 링크 활성화" })).toBeInTheDocument();
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
    expect(screen.getByText("시스템 자동화 · 서비스 시작 · 시작 당일 · 주 담당 직원")).toBeInTheDocument();
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
        recipientType: "PRIMARY_EMPLOYEE",
        templateKey: "SERVICE_RECORD_LINK",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
      isLoading: false,
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
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(mutateAsync).toHaveBeenCalledWith({
      name: "서비스 시작 7일 전 안내",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
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
});
