import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { settingsApi, type MessageAutomationPoliciesResponse } from "@/services/api";
import type { MessageTriggerRule } from "@/features/message-triggers/types";

import { messagePolicyApi, type MessageAutomationPolicyConfigResponse } from "@/services/settings";
import { MessageTenantApplicationSettings } from "../MessageTenantApplicationSettings";

jest.mock("@/features/system-templates/branch-context", () => ({ useActiveBranchId: () => "branch-1", isBranchContextAligned: () => true }));
jest.mock("@/services/settings", () => ({ messagePolicyApi: { getConfiguration: jest.fn(), saveConfiguration: jest.fn(), previewConfiguration: jest.fn() } }));
const mockedPolicyApi = jest.mocked(messagePolicyApi);
const BASE_CONFIG: MessageAutomationPolicyConfigResponse = {
  version: null, permissions: { canRead: true, canWrite: true }, warnings: [],
  configuration: { schemaVersion: 1, dispatchCheckIntervalMinutes: 1, defaultRuleSendTime: "09:00", triggerRetryIntervalMinutes: 5, processingReclaimMinutes: 10, smsRetryIntervalMinutes: 5, pastExpiryHours: 24, pastSendIntervalMinutes: 1, pastRuleOrder: [], duplicateWindowHours: 72, quietHours: { enabled: false, start: "22:00", end: "08:00", recipientGroups: ["CLIENT", "CAREGIVER", "STAFF"], action: "DEFER", timezone: "Asia/Seoul" } },
};
let configResponse = JSON.parse(JSON.stringify(BASE_CONFIG)) as MessageAutomationPolicyConfigResponse;
let configReadError = false;

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: jest.fn(),
    getMessageAutomationPolicies: jest.fn(),
    getClientRegistrationPolicy: jest.fn(),
    updateClientRegistrationPolicy: jest.fn(),
    updateMessageAutomationPastTriggerConfig: jest.fn(),
    updateMessagePolicyActivation: jest.fn(),
    requestMessageSenderApproval: jest.fn(),
  },
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseMutation = jest.mocked(useMutation);
const mockedUseQueryClient = jest.mocked(useQueryClient);
const mockedUseGetAuthUser = jest.mocked(useGetAuthUser);
const mockedSettingsApi = jest.mocked(settingsApi);

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

const mockInvalidateQueries = jest.fn();
const mockSetQueryData = jest.fn();
const mockCancelQueries = jest.fn();
const mockGetQueryData = jest.fn();

const DEFAULT_TRIGGER_RULES: MessageTriggerRule[] = [
  {
    id: "trigger-rule-1",
    branchId: "branch-1",
    name: "인사 메시지",
    isActive: true,
    eventType: "CLIENT_CREATED",
    offsetType: "IMMEDIATE",
    offsetDays: 0,
    recipientType: "CLIENT",
    templateKey: "CLIENT_GREETING",
    targetClientStatus: "all",
    retryOnFailure: true,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-2",
    branchId: "branch-1",
    name: "서비스 안내",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 7,
    recipientType: "CLIENT",
    templateKey: "SERVICE_INFO",
    targetClientStatus: "all",
    retryOnFailure: true,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-3",
    branchId: "branch-1",
    name: "리마인더",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 1,
    recipientType: "CLIENT",
    templateKey: "REMINDER",
    targetClientStatus: "all",
    retryOnFailure: true,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-4",
    branchId: "branch-1",
    name: "비용 안내",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "SAME_DAY",
    offsetDays: 0,
    recipientType: "CLIENT",
    templateKey: "PRICE_INFO",
    targetClientStatus: "all",
    retryOnFailure: true,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-5",
    branchId: "branch-1",
    name: "감사 메시지",
    isActive: true,
    eventType: "SERVICE_END",
    offsetType: "AFTER_DAYS",
    offsetDays: 1,
    recipientType: "CLIENT",
    templateKey: "THANKS",
    targetClientStatus: "all",
    retryOnFailure: true,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
  {
    id: "trigger-rule-6",
    branchId: "branch-1",
    name: "설문 요청",
    isActive: true,
    eventType: "SERVICE_END",
    offsetType: "AFTER_DAYS",
    offsetDays: 2,
    recipientType: "CLIENT",
    templateKey: "SURVEY",
    targetClientStatus: "all",
    retryOnFailure: true,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  },
];

const DEFAULT_AUTOMATION_POLICIES: MessageAutomationPoliciesResponse = {
  canManageActivation: true,
  pastTriggerConfig: {
    sendIntervalMinutes: 1,
    ruleOrder: [],
  },
  policies: [
    {
      id: "service-feedback-link",
      title: "제공기록지 전송 자동화 규칙",
      description: "API에서 내려준 제공기록지 전송 설명",
      active: true,
      requiresApproval: true,
      rows: [
        { id: "send-time", label: "발송 시점", value: "서비스 시작일 오후 3시" },
        { id: "recipient", label: "수신 대상", value: "주 담당 제공인력" },
      ],
    },
    {
      id: "past-trigger",
      title: "지난 자동 전송 처리 규칙",
      description: "API에서 내려준 지난 자동 전송 설명",
      active: true,
      requiresApproval: true,
      rows: [
        { id: "condition", label: "조건", value: "API 기준 이미 지난 트리거" },
        { id: "action", label: "동작", value: "API 기준 지난 루틴 미실행" },
      ],
    },
    {
      id: "sms-retry",
      title: "SMS 재시도 규칙",
      description: "API에서 내려준 SMS 재시도 설명",
      active: true,
      requiresApproval: false,
      rows: [
        { id: "count", label: "재시도 횟수", value: "최대 2회" },
        { id: "interval", label: "재시도 간격", value: "실패 후 5분" },
      ],
    },
  ],
};

function automationPoliciesWithTriggerDispatch(
  active: boolean,
): MessageAutomationPoliciesResponse {
  return {
    ...DEFAULT_AUTOMATION_POLICIES,
    canManageActivation: true,
    policies: [
      {
        id: "trigger-dispatch",
        title: "메시지 자동 발송",
        description: "지점의 메시지를 자동으로 발송합니다.",
        active,
        requiresApproval: true,
        rows: [],
      },
      ...DEFAULT_AUTOMATION_POLICIES.policies,
    ],
    policyActivations: { "trigger-dispatch": active },
  };
}

function getQueryKey(options: unknown) {
  if (typeof options !== "object" || options === null || !("queryKey" in options)) {
    return undefined;
  }

  return (options as { queryKey?: readonly unknown[] }).queryKey;
}

function mockSettingsQueries(
  isApproved: boolean,
  automationPolicies: MessageAutomationPoliciesResponse = DEFAULT_AUTOMATION_POLICIES,
  triggerRules: MessageTriggerRule[] = DEFAULT_TRIGGER_RULES,
  options: {
    automationPoliciesLoading?: boolean;
    automationPoliciesError?: boolean;
    automationPoliciesPaused?: boolean;
    approval?: "failed" | "paused";
    approvalRefetch?: jest.Mock;
    rules?: "failed" | "paused" | "cached-failed";
    rulesRefetch?: jest.Mock;
  } = {},
) {
  configResponse = { ...configResponse, configuration: { ...configResponse.configuration, pastSendIntervalMinutes: automationPolicies.pastTriggerConfig.sendIntervalMinutes, pastRuleOrder: [...automationPolicies.pastTriggerConfig.ruleOrder] } };
  mockedUseQuery.mockImplementation(((queryOptions: unknown) => {
    const queryKey = getQueryKey(queryOptions);

    if (queryKey?.[1] === "message-automation-config") return { data: configReadError ? undefined : configResponse, isLoading: false, isError: configReadError, refetch: jest.fn() } as unknown as ReturnType<typeof useQuery>;
    if (queryKey?.[0] === "settings" && queryKey[1] === "message-sender-approval") {
      if (options.approval === "paused") {
        return { ...PAUSED_QUERY_RESULT, refetch: options.approvalRefetch ?? jest.fn() } as unknown as ReturnType<typeof useQuery>;
      }

      if (options.approval === "failed") {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          isFetching: false,
          isPaused: false,
          refetch: options.approvalRefetch ?? jest.fn(),
        } as unknown as ReturnType<typeof useQuery>;
      }

      return {
        data: {
          approvalStatus: isApproved ? "approved" : "not_requested",
          isApproved,
          canRequest: !isApproved,
          requestedAt: null,
          approvedAt: isApproved ? "2026-06-05T00:00:00.000Z" : null,
        },
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    if (queryKey?.[0] === "settings" && queryKey[1] === "message-automation-policies") {
      if (options.automationPoliciesPaused) {
        return { ...PAUSED_QUERY_RESULT, refetch: jest.fn() } as unknown as ReturnType<typeof useQuery>;
      }

      return {
        data: options.automationPoliciesLoading ? undefined : automationPolicies,
        isLoading: options.automationPoliciesLoading ?? false,
        isError: options.automationPoliciesError ?? false,
        refetch: jest.fn(),
      } as unknown as ReturnType<typeof useQuery>;
    }

    if (queryKey?.[0] === "settings" && queryKey[1] === "client-registration-policy") {
      return { data: { clientAutoRegistration: true, greetingOnAutoRegistration: false }, isLoading: false } as unknown as ReturnType<typeof useQuery>;
    }

    if (queryKey?.[0] === "message-triggers" && queryKey[1] === "list") {
      if (options.rules === "paused") {
        return { ...PAUSED_QUERY_RESULT, refetch: options.rulesRefetch ?? jest.fn() } as unknown as ReturnType<typeof useQuery>;
      }

      if (options.rules === "failed" || options.rules === "cached-failed") {
        return {
          data: options.rules === "cached-failed" ? triggerRules : undefined,
          isLoading: false,
          isError: true,
          isFetching: false,
          isPaused: false,
          refetch: options.rulesRefetch ?? jest.fn(),
        } as unknown as ReturnType<typeof useQuery>;
      }

      return {
        data: triggerRules,
        isLoading: false,
      } as unknown as ReturnType<typeof useQuery>;
    }

    return {
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>;
  }) as unknown as typeof useQuery);
}

beforeEach(() => {
  jest.clearAllMocks();
  configResponse = JSON.parse(JSON.stringify(BASE_CONFIG)) as MessageAutomationPolicyConfigResponse; configReadError = false;
  mockedPolicyApi.saveConfiguration.mockImplementation(async (input) => ({ ...configResponse, version: "version-2", configuration: input.configuration }));
  mockedPolicyApi.previewConfiguration.mockResolvedValue({ version: null, deferredCount: 3, canceledCount: 0, reevaluateAt: "2026-11-07T23:00:00.000Z", futureProviderReservations: 0, canEnableQuietHours: true, warnings: [] });
  jest.spyOn(window, "confirm").mockReturnValue(true);
  mockedUseGetAuthUser.mockReturnValue({
    data: {
      id: "user-1",
      name: "정다라",
      branchName: "인천점",
      role: "admin",
    },
  } as unknown as ReturnType<typeof useGetAuthUser>);
  mockSetQueryData.mockImplementation((key: unknown[], value: unknown) => { if (key[1] === "message-automation-config" && typeof value !== "function") configResponse = value as MessageAutomationPolicyConfigResponse; });
  mockedUseQueryClient.mockReturnValue({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
    cancelQueries: mockCancelQueries,
    getQueryData: mockGetQueryData,
  } as unknown as ReturnType<typeof useQueryClient>);
  mockedSettingsApi.getMessageAutomationPolicies.mockResolvedValue(DEFAULT_AUTOMATION_POLICIES);
  mockedSettingsApi.updateMessageAutomationPastTriggerConfig.mockImplementation(async (config) => config);
  mockedSettingsApi.updateMessagePolicyActivation.mockImplementation(async (enabled) => ({
    policyId: "trigger-dispatch",
    enabled,
  }));
  mockedSettingsApi.updateClientRegistrationPolicy.mockImplementation(async (patch) => ({
    clientAutoRegistration: true,
    greetingOnAutoRegistration: false,
    ...patch,
  }));
  mockedUseMutation.mockImplementation(((options: {
    mutationFn?: (variables?: unknown) => unknown;
    onSuccess?: (data: unknown, variables: unknown, context: unknown) => unknown;
    onError?: (error: unknown, variables: unknown, context: unknown) => unknown;
    onSettled?: (...args: unknown[]) => unknown;
  }) => {
    return {
      mutate: (variables?: unknown) => {
        Promise.resolve((options as { onMutate?: (variables: unknown) => unknown }).onMutate?.(variables))
          .then((context) => Promise.resolve(options.mutationFn?.(variables))
            .then((data) => options.onSuccess?.(data, variables, context))
            .catch((error) => options.onError?.(error, variables, context))
            .finally(() => options.onSettled?.(undefined, variables, undefined)));
      },
      isPending: false,
    };
  }) as unknown as typeof useMutation);
});

describe("MessageTenantApplicationSettings", () => {
  it("does not render or fetch the client registration policy", () => {
    mockSettingsQueries(true);
    render(<MessageTenantApplicationSettings />);

    expect(screen.queryByText("고객 자동 등록")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "eformsign 계약서 도착 시 고객 자동 등록" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "자동 등록 시 인사 문자 발송" })).not.toBeInTheDocument();
    expect(mockedSettingsApi.getClientRegistrationPolicy).not.toHaveBeenCalled();
    expect(mockedSettingsApi.updateClientRegistrationPolicy).not.toHaveBeenCalled();
  });

  it("renders automation policy items from the API", async () => {
    mockSettingsQueries(true, {
      pastTriggerConfig: DEFAULT_AUTOMATION_POLICIES.pastTriggerConfig,
      policies: [
        {
          id: "service-feedback-link",
          title: "API 제공기록지 정책",
          description: "API 제공기록지 설명",
          active: true,
          requiresApproval: true,
          rows: [
            { id: "send-time", label: "발송 시점", value: "API 오후 3시" },
          ],
        },
        {
          id: "past-trigger",
          title: "API 지난 루틴 정책",
          description: "API 지난 루틴 설명",
          active: false,
          requiresApproval: true,
          rows: [
            { id: "action", label: "동작", value: "API 지난 루틴 미실행" },
          ],
        },
        {
          id: "sms-retry",
          title: "API SMS 재시도 정책",
          description: "API SMS 재시도 설명",
          active: true,
          requiresApproval: false,
          rows: [
            { id: "count", label: "재시도 횟수", value: "API 최대 4회" },
          ],
        },
      ],
    });

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("설정").length).toBeGreaterThan(0);
    expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
    expect(screen.queryByText("API 제공기록지 정책")).not.toBeInTheDocument();
    expect(screen.queryByText("API 오후 3시")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "API 제공기록지 정책 활성화" })).not.toBeInTheDocument();
    expect(screen.getAllByText("API 지난 루틴 정책").length).toBeGreaterThan(0);
    expect(screen.getAllByText("API SMS 재시도 정책").length).toBeGreaterThan(0);
    expect(screen.getAllByText("중복 전송 확인").length).toBeGreaterThan(0);
    const inactivePolicySwitch = screen.getByRole("switch", { name: "API 지난 루틴 정책 활성화" });
    const smsPolicySwitch = screen.getByRole("switch", { name: "API SMS 재시도 정책 활성화" });

    expect(inactivePolicySwitch).toBeDisabled();
    expect(inactivePolicySwitch).toHaveAttribute("aria-checked", "false");
    expect(smsPolicySwitch).toBeDisabled();
    expect(smsPolicySwitch).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "중복 전송 확인 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getAllByText("API 지난 루틴 정책")[0]);

    expect(screen.getByText("API 지난 루틴 미실행")).toBeInTheDocument();
    expect(screen.getByText("늦은 등록 자동 전송 간격 (분)")).toBeInTheDocument();
    const intervalInput = screen.getByRole("spinbutton", { name: "늦은 등록 자동 전송 간격" });
    expect(intervalInput).toHaveValue(1);
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.change(intervalInput, { target: { value: "10" } });
    expect(intervalInput).toHaveValue(10);
    expect(screen.getByText("늦은 등록 자동 전송 순서")).toBeInTheDocument();
    for (const rule of DEFAULT_TRIGGER_RULES) {
      expect(screen.getByText(rule.name)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('[data-source-component="InfoRow"][data-component^="desktop_messages_sections_settings-past-trigger-policy-order-card_form_trigger-rule-"]')).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledWith({ expectedVersion: null, configuration: expect.objectContaining({
        pastSendIntervalMinutes: 10,
        pastRuleOrder: DEFAULT_TRIGGER_RULES.map((rule) => rule.id),
      }) }, "branch-1");
    });

    fireEvent.click(screen.getAllByText("중복 전송 확인")[0]);

    expect(screen.getByText("최근 72시간")).toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_messages_sections_split-layout_detail-panel-4_duplicate-send-policy"]')).toBeInTheDocument();
  });

  it("SMS retry row shows the API-provided value, not hardcoded copy", () => {
    mockSettingsQueries(true, {
      pastTriggerConfig: DEFAULT_AUTOMATION_POLICIES.pastTriggerConfig,
      policies: [
        {
          id: "sms-retry",
          title: "SMS 재시도 규칙",
          description: "API에서 내려준 SMS 재시도 설명",
          active: true,
          requiresApproval: false,
          rows: [
            { id: "count", label: "재시도 횟수", value: "최대 9회" },
            { id: "interval", label: "재시도 간격", value: "실패 후 1분" },
          ],
        },
      ],
    });

    render(<MessageTenantApplicationSettings />);

    expect(screen.getByText("최대 9회")).toBeInTheDocument();
    expect(screen.queryByText("최대 2회")).not.toBeInTheDocument();
  });

  it("hides inactive rules from the list but preserves their saved positions in the payload", async () => {
    const inactiveReminder = {
      ...DEFAULT_TRIGGER_RULES[2],
      isActive: false,
    };
    const triggerRules = [
      DEFAULT_TRIGGER_RULES[0],
      DEFAULT_TRIGGER_RULES[1],
      inactiveReminder,
      DEFAULT_TRIGGER_RULES[3],
    ];
    mockSettingsQueries(true, {
      ...DEFAULT_AUTOMATION_POLICIES,
      pastTriggerConfig: {
        sendIntervalMinutes: 1,
        ruleOrder: triggerRules.map((rule) => rule.id),
      },
    }, triggerRules);

    render(<MessageTenantApplicationSettings />);

    fireEvent.click(screen.getAllByText("지난 자동 전송 처리 규칙")[0]);

    expect(screen.getByText(DEFAULT_TRIGGER_RULES[0].name)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_TRIGGER_RULES[1].name)).toBeInTheDocument();
    expect(screen.queryByText(inactiveReminder.name)).not.toBeInTheDocument();
    expect(screen.getByText(DEFAULT_TRIGGER_RULES[3].name)).toBeInTheDocument();

    const intervalInput = screen.getByRole("spinbutton", { name: "늦은 등록 자동 전송 간격" });
    fireEvent.change(intervalInput, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledWith({ expectedVersion: null, configuration: expect.objectContaining({
        pastSendIntervalMinutes: 2,
        pastRuleOrder: [
          DEFAULT_TRIGGER_RULES[0].id,
          DEFAULT_TRIGGER_RULES[1].id,
          inactiveReminder.id,
          DEFAULT_TRIGGER_RULES[3].id,
        ],
      }) }, "branch-1");
    });
  });

  it("hides only the manual receipt-send system rule from automatic ordering while preserving its saved position", async () => {
    const manualOnlyRule: MessageTriggerRule = {
      ...DEFAULT_TRIGGER_RULES[0],
      id: "system:service_end_notice",
      branchId: null,
      name: "서비스 종료 안내 (수동 발송)",
      templateKey: "SERVICE_END_NOTICE",
    };
    const automaticReceiptRule: MessageTriggerRule = {
      ...DEFAULT_TRIGGER_RULES[0],
      id: "branch-service-end-notice",
      name: "자동 영수증 안내",
      templateKey: "SERVICE_END_NOTICE",
    };
    const triggerRules = [manualOnlyRule, DEFAULT_TRIGGER_RULES[0], automaticReceiptRule];
    mockSettingsQueries(true, {
      ...DEFAULT_AUTOMATION_POLICIES,
      pastTriggerConfig: {
        sendIntervalMinutes: 1,
        ruleOrder: triggerRules.map((rule) => rule.id),
      },
    }, triggerRules);

    render(<MessageTenantApplicationSettings />);
    fireEvent.click(screen.getAllByText("지난 자동 전송 처리 규칙")[0]);

    expect(screen.queryByText(manualOnlyRule.name)).not.toBeInTheDocument();
    expect(screen.getByText(DEFAULT_TRIGGER_RULES[0].name)).toBeInTheDocument();
    expect(screen.getByText(automaticReceiptRule.name)).toBeInTheDocument();

    const intervalInput = screen.getByRole("spinbutton", { name: "늦은 등록 자동 전송 간격" });
    fireEvent.change(intervalInput, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledWith({ expectedVersion: null, configuration: expect.objectContaining({
        pastSendIntervalMinutes: 2,
        pastRuleOrder: [manualOnlyRule.id, DEFAULT_TRIGGER_RULES[0].id, automaticReceiptRule.id],
      }) }, "branch-1");
    });
  });

  it("preserves an inactive rule position when displayed rules are reordered", async () => {
    const inactiveReminder = {
      ...DEFAULT_TRIGGER_RULES[2],
      isActive: false,
    };
    const triggerRules = [
      DEFAULT_TRIGGER_RULES[0],
      DEFAULT_TRIGGER_RULES[1],
      inactiveReminder,
      DEFAULT_TRIGGER_RULES[3],
    ];
    mockSettingsQueries(true, {
      ...DEFAULT_AUTOMATION_POLICIES,
      pastTriggerConfig: {
        sendIntervalMinutes: 1,
        ruleOrder: triggerRules.map((rule) => rule.id),
      },
    }, triggerRules);

    render(<MessageTenantApplicationSettings />);

    fireEvent.click(screen.getAllByText("지난 자동 전송 처리 규칙")[0]);
    fireEvent.click(screen.getByRole("button", {
      name: `${DEFAULT_TRIGGER_RULES[1].name} 아래로 이동`,
    }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledWith({ expectedVersion: null, configuration: expect.objectContaining({
        pastSendIntervalMinutes: 1,
        pastRuleOrder: [
          DEFAULT_TRIGGER_RULES[0].id,
          DEFAULT_TRIGGER_RULES[3].id,
          inactiveReminder.id,
          DEFAULT_TRIGGER_RULES[1].id,
        ],
      }) }, "branch-1");
    });
  });

  it("shows the sender application item and duplicate send policy before approval", () => {
    mockSettingsQueries(false);

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("메시지 발송 기능 신청").length).toBeGreaterThan(0);
    expect(screen.queryByText("제공기록지 전송 자동화 규칙")).not.toBeInTheDocument();
    expect(screen.getAllByText("지난 자동 전송 처리 규칙").length).toBeGreaterThan(0);
    expect(screen.getByText("SMS 재시도 규칙")).toBeInTheDocument();
    expect(screen.getByText("중복 전송 확인")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "제공기록지 전송 자동화 규칙 활성화" })).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_messages_sections_settings-tenant-application"]')).toBeInTheDocument();
  });

  it("waits for automation policies before rendering the settings list", () => {
    mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, DEFAULT_TRIGGER_RULES, {
      automationPoliciesLoading: true,
    });

    const view = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("설정 정보를 불러오는 중입니다.")).toHaveLength(2);
    expect(screen.queryByText("제공기록지 전송 자동화 규칙")).not.toBeInTheDocument();

    mockSettingsQueries(true);
    view.rerender(<MessageTenantApplicationSettings />);

    expect(screen.queryByText("제공기록지 전송 자동화 규칙")).not.toBeInTheDocument();
    expect(screen.getAllByText("지난 자동 전송 처리 규칙").length).toBeGreaterThan(0);
  });

  it("policy switches stay disabled while unapproved and only approval-gated active policies render off", () => {
    mockSettingsQueries(false);

    render(<MessageTenantApplicationSettings />);

    const approvalGatedSwitchNames = [
      "지난 자동 전송 처리 규칙 활성화",
      "중복 전송 확인 활성화",
    ];

    for (const name of approvalGatedSwitchNames) {
      const policySwitch = screen.getByRole("switch", { name });
      expect(policySwitch).toBeDisabled();
      expect(policySwitch).toHaveAttribute("aria-checked", "false");
    }

    const nonApprovalGatedSwitchNames = [
      "SMS 재시도 규칙 활성화",
    ];

    for (const name of nonApprovalGatedSwitchNames) {
      const policySwitch = screen.getByRole("switch", { name });
      expect(policySwitch).toBeDisabled();
      expect(policySwitch).toHaveAttribute("aria-checked", "true");
    }

    // Clicking a disabled switch must not toggle it on.
    fireEvent.click(screen.getByRole("switch", { name: approvalGatedSwitchNames[0] }));
    expect(screen.getByRole("switch", { name: approvalGatedSwitchNames[0] })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("keeps consent labels and native Space activation while framing the checked state", () => {
    mockSettingsQueries(false);
    const onSubmit = jest.fn((event) => event.preventDefault());
    const originalResizeObserver = globalThis.ResizeObserver;
    // Radix observes its native form input; jsdom supplies no layout observer.
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    try {
      render(<form onSubmit={onSubmit}><MessageTenantApplicationSettings /></form>);
      const checkbox = screen.getAllByRole("checkbox")[0];
      const label = checkbox.closest("label")!;
      const submit = screen.getByRole("button", { name: "메시지 발송 신청하기" });
      expect(label.htmlFor).toBe(checkbox.id);
      expect(label).toHaveClass("border-2", "border-v3-selectable-border", "hover:border-v3-selectable-border");
      expect(checkbox).toHaveAttribute("aria-checked", "false");
      fireEvent.click(label);
      expect(checkbox).toHaveAttribute("aria-checked", "true");
      expect(label).toHaveAttribute("data-selected", "true");
      expect(label).toHaveClass("border-v3-primary", "hover:border-v3-primary");
      checkbox.focus();
      expect(document.activeElement).toBe(checkbox);
      // jsdom does not synthesize a native button click from Space. Verify Space
      // remains uncancelled, then dispatch that native activation explicitly.
      expect(fireEvent.keyDown(checkbox, { key: " ", code: "Space" })).toBe(true);
      fireEvent.keyUp(checkbox, { key: " ", code: "Space" });
      fireEvent.click(checkbox);
      expect(checkbox).toHaveAttribute("aria-checked", "false");
      expect(label).toHaveClass("border-v3-selectable-border", "hover:border-v3-selectable-border");
      expect(label).not.toHaveClass("border-v3-primary");
      expect(label.className).not.toContain("!border");
      expect(submit).toBeDisabled();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(mockedSettingsApi.requestMessageSenderApproval).not.toHaveBeenCalled();
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it("sender application submit posts the approval request and refetches the approval state", async () => {
    mockSettingsQueries(false);
    mockedSettingsApi.requestMessageSenderApproval.mockResolvedValue({
      approvalStatus: "pending",
      isApproved: false,
      canRequest: false,
      requestedAt: "2026-07-09T00:00:00.000Z",
      approvedAt: null,
    });

    render(<MessageTenantApplicationSettings />);

    for (const checkbox of screen.getAllByRole("checkbox")) {
      fireEvent.click(checkbox);
    }

    fireEvent.click(screen.getByRole("button", { name: "메시지 발송 신청하기" }));

    await waitFor(() => {
      expect(mockedSettingsApi.requestMessageSenderApproval).toHaveBeenCalledTimes(1);
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["settings", "message-sender-approval"],
    });
  });

  it("shows the stored trigger-dispatch state and lets an admin change only that parent", async () => {
    mockSettingsQueries(false, automationPoliciesWithTriggerDispatch(true));

    render(<MessageTenantApplicationSettings />);

    const parentSwitch = screen.getByRole("switch", { name: "메시지 자동 발송 활성화" });
    expect(parentSwitch).toBeChecked();
    expect(parentSwitch).toBeEnabled();

    fireEvent.click(parentSwitch);

    await waitFor(() => {
      expect(mockedSettingsApi.updateMessagePolicyActivation).toHaveBeenCalledWith(false);
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["message-triggers"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["settings", "message-automation-policies"],
    });
  });

  it("keeps the parent switch unavailable to members while preserving the stored checked state", () => {
    mockSettingsQueries(false, {
      ...automationPoliciesWithTriggerDispatch(true),
      canManageActivation: false,
    });
    mockedUseGetAuthUser.mockReturnValue({
      data: { id: "user-2", name: "멤버", branchName: "인천점", role: "member" },
    } as unknown as ReturnType<typeof useGetAuthUser>);

    render(<MessageTenantApplicationSettings />);

    const parentSwitch = screen.getByRole("switch", { name: "메시지 자동 발송 활성화" });
    expect(parentSwitch).toBeChecked();
    expect(parentSwitch).toBeDisabled();
    fireEvent.click(parentSwitch);
    expect(mockedSettingsApi.updateMessagePolicyActivation).not.toHaveBeenCalled();
  });

  it("fails closed when the activation capability projection is missing", () => {
    mockSettingsQueries(false, {
      ...automationPoliciesWithTriggerDispatch(true),
      canManageActivation: undefined,
    });

    render(<MessageTenantApplicationSettings />);

    const parentSwitch = screen.getByRole("switch", { name: "메시지 자동 발송 활성화" });
    expect(parentSwitch).toBeChecked();
    expect(parentSwitch).toBeDisabled();
  });

  it("masks active child rules when the trigger-dispatch parent is off", () => {
    mockSettingsQueries(true, automationPoliciesWithTriggerDispatch(false));

    render(<MessageTenantApplicationSettings />);
    fireEvent.click(screen.getAllByText("지난 자동 전송 처리 규칙")[0]);

    for (const rule of DEFAULT_TRIGGER_RULES) {
      expect(screen.queryByText(rule.name)).not.toBeInTheDocument();
    }
  });

  it("fails closed when the trigger-dispatch policy query errors", () => {
    mockSettingsQueries(true, automationPoliciesWithTriggerDispatch(true), DEFAULT_TRIGGER_RULES, {
      automationPoliciesError: true,
    });

    render(<MessageTenantApplicationSettings />);

    expect(screen.getByText("현재 지점의 메시지 자동 발송 설정을 확인할 수 없어요.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "메시지 자동 발송 활성화" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "메시지 자동 발송 활성화" })).not.toBeChecked();
  });

  describe("unknown sender approval and unknown rules (BJJ-434)", () => {
    const ORDER_EMPTY_TEXT = "등록된 자동 전송 루틴 없음";
    const ORDER_LOADING_TEXT = "자동 전송 루틴을 불러오는 중";
    const APPROVAL_ERROR_TITLE = "발신 승인 상태를 불러오지 못했습니다";

    it("failed approval with no data: one retryable alert, no application item, no switch derived from approval", () => {
      const approvalRefetch = jest.fn();
      mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, DEFAULT_TRIGGER_RULES, {
        approval: "failed",
        approvalRefetch,
      });

      render(<MessageTenantApplicationSettings />);

      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(within(alerts[0]).getByText(APPROVAL_ERROR_TITLE)).toBeInTheDocument();
      expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
      expect(screen.queryByText("메시지 발송 신청하기")).not.toBeInTheDocument();
      // Rows that require approval render no switch at all; the others are unchanged.
      expect(screen.queryByRole("switch", { name: "지난 자동 전송 처리 규칙 활성화" })).not.toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "중복 전송 확인 활성화" })).not.toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "SMS 재시도 규칙 활성화" })).toBeInTheDocument();
      // The first automation policy is selected instead of the application panel.
      expect(screen.getAllByText("지난 자동 전송 처리 규칙").length).toBeGreaterThan(0);

      fireEvent.click(within(alerts[0]).getByRole("button", { name: "다시 시도" }));
      expect(approvalRefetch).toHaveBeenCalledTimes(1);
    });

    it("failed approval with no data: the trigger-dispatch switch does not depend on the approval answer", () => {
      mockSettingsQueries(true, automationPoliciesWithTriggerDispatch(true), DEFAULT_TRIGGER_RULES, {
        approval: "failed",
      });

      render(<MessageTenantApplicationSettings />);

      expect(screen.getByRole("switch", { name: "메시지 자동 발송 활성화" })).toBeChecked();
    });

    it("approved and not-approved answers render exactly as before, with no alert", () => {
      mockSettingsQueries(true);
      const approved = render(<MessageTenantApplicationSettings />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
      expect(screen.getByRole("switch", { name: "지난 자동 전송 처리 규칙 활성화" })).toHaveAttribute("aria-checked", "true");
      approved.unmount();

      mockSettingsQueries(false);
      render(<MessageTenantApplicationSettings />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getAllByText("메시지 발송 기능 신청").length).toBeGreaterThan(0);
    });

    it("paused approval with no data reads as loading: no application item, no 0개 pill, no alert", () => {
      mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, DEFAULT_TRIGGER_RULES, {
        approval: "paused",
      });

      render(<MessageTenantApplicationSettings />);

      expect(screen.getAllByText("설정 정보를 불러오는 중입니다.")).toHaveLength(2);
      expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
      expect(screen.queryByText("0개")).not.toBeInTheDocument();
      expect(screen.queryByText("표시할 설정 항목이 없습니다.")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("paused automation policies with no data read as loading", () => {
      mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, DEFAULT_TRIGGER_RULES, {
        automationPoliciesPaused: true,
      });

      render(<MessageTenantApplicationSettings />);

      expect(screen.getAllByText("설정 정보를 불러오는 중입니다.")).toHaveLength(2);
      expect(screen.queryByText("0개")).not.toBeInTheDocument();
      expect(screen.queryByText("현재 지점의 메시지 자동 발송 설정을 확인할 수 없어요.")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("loading settings do not print a 0개 pill", () => {
      mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, DEFAULT_TRIGGER_RULES, {
        automationPoliciesLoading: true,
      });

      render(<MessageTenantApplicationSettings />);

      expect(screen.getAllByText("설정 정보를 불러오는 중입니다.")).toHaveLength(2);
      expect(screen.queryByText("0개")).not.toBeInTheDocument();
    });

    it("order card, rules failed with no data: titled retryable failure, no empty text, save disabled", () => {
      const rulesRefetch = jest.fn();
      mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, DEFAULT_TRIGGER_RULES, {
        rules: "failed",
        rulesRefetch,
      });

      render(<MessageTenantApplicationSettings />);
      fireEvent.click(screen.getAllByText("지난 자동 전송 처리 규칙")[0]);

      const alert = screen.getByRole("alert");
      expect(within(alert).getByText("자동 전송 루틴을 불러오지 못했습니다")).toBeInTheDocument();
      expect(screen.queryByText(ORDER_EMPTY_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByText(ORDER_LOADING_TEXT)).not.toBeInTheDocument();

      // A dirty form must still not be saveable: the order would be built from zero rules.
      fireEvent.change(screen.getByRole("spinbutton", { name: "늦은 등록 자동 전송 간격" }), {
        target: { value: "2" },
      });
      expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();

      fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
      expect(rulesRefetch).toHaveBeenCalledTimes(1);
    });

    it("order card, rules paused with no data: loading row, not the empty text or an alert", () => {
      mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, DEFAULT_TRIGGER_RULES, {
        rules: "paused",
      });

      render(<MessageTenantApplicationSettings />);
      fireEvent.click(screen.getAllByText("지난 자동 전송 처리 규칙")[0]);

      expect(screen.getByText(ORDER_LOADING_TEXT)).toBeInTheDocument();
      expect(screen.queryByText(ORDER_EMPTY_TEXT)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("order card, rules loaded and empty: the empty text, no alert, save still works", () => {
      mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, []);

      render(<MessageTenantApplicationSettings />);
      fireEvent.click(screen.getAllByText("지난 자동 전송 처리 규칙")[0]);

      expect(screen.getByText(ORDER_EMPTY_TEXT)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      fireEvent.change(screen.getByRole("spinbutton", { name: "늦은 등록 자동 전송 간격" }), {
        target: { value: "2" },
      });
      expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    });

    it("order card, cached rules and a failed refetch: rows stay with one inline notice that retries", () => {
      const rulesRefetch = jest.fn();
      mockSettingsQueries(true, DEFAULT_AUTOMATION_POLICIES, DEFAULT_TRIGGER_RULES, {
        rules: "cached-failed",
        rulesRefetch,
      });

      render(<MessageTenantApplicationSettings />);
      fireEvent.click(screen.getAllByText("지난 자동 전송 처리 규칙")[0]);

      expect(screen.getByText(DEFAULT_TRIGGER_RULES[0].name)).toBeInTheDocument();
      expect(screen.queryByText(ORDER_EMPTY_TEXT)).not.toBeInTheDocument();
      const alert = screen.getByRole("alert");
      expect(within(alert).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();

      fireEvent.change(screen.getByRole("spinbutton", { name: "늦은 등록 자동 전송 간격" }), {
        target: { value: "2" },
      });
      expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();

      fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
      expect(rulesRefetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe("canonical policy draft", () => {
  const policies: MessageAutomationPoliciesResponse = {
    ...DEFAULT_AUTOMATION_POLICIES,
    policies: [
      { id: "trigger-dispatch", title: "메시지 자동 발송", description: "지점 자동 발송", active: false, requiresApproval: true, rows: [] },
      { id: "trigger-job-retry", title: "자동 작업 재시도", description: "재시도", active: true, requiresApproval: false, rows: [] },
      ...DEFAULT_AUTOMATION_POLICIES.policies,
    ],
  };
  const numericFields = [
    ["메시지 자동 발송", "자동 작업 확인 간격", 1, 1440],
    ["자동 작업 재시도", "자동 작업 재시도 간격", 1, 1440],
    ["자동 작업 재시도", "처리 중 작업 회수 시간", 10, 1440],
    ["SMS 재시도 규칙", "문자 재시도 간격", 1, 1440],
    ["지난 자동 전송 처리 규칙", "지난 자동 전송 유효 시간", 1, 720],
    ["지난 자동 전송 처리 규칙", "늦은 등록 자동 전송 간격", 1, 1440],
    ["중복 전송 확인", "중복 확인 범위", 1, 720],
  ] as const;
  function open(title: string) {
    mockSettingsQueries(true, policies);
    const view = render(<MessageTenantApplicationSettings />);
    fireEvent.click(screen.getAllByText(title)[0]);
    return view;
  }
  it.each([[false, false, 7], [false, true, 7], [true, false, 6], [true, true, 6]] as const)("retains conditional items approved=%s manager=%s", (approved, manager, count) => {
    mockSettingsQueries(approved, { ...policies, canManageActivation: manager });
    const { container } = render(<MessageTenantApplicationSettings />);
    const list = container.querySelector('[data-component="desktop_messages_sections_split-layout_list-panel-2"]')!;
    expect(within(list as HTMLElement).getByText(`${count}개`)).toBeInTheDocument();
    expect(within(list as HTMLElement).getAllByText("심야 시간 메세지 전송 금지")).toHaveLength(1);
    expect(screen.queryByText("제공기록지 전송 자동화 규칙")).not.toBeInTheDocument();
    expect(within(list as HTMLElement).queryByText("메시지 발송 기능 신청") !== null).toBe(!approved);
  });
  it.each(numericFields)("validates literal bounds for %s / %s without writes", (title, label, min, max) => {
    open(title);
    const input = screen.getByRole("spinbutton", { name: label });
    for (const invalid of [min - 1, max + 1]) {
      fireEvent.change(input, { target: { value: String(invalid) } });
      expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(`${min}~${max}`);
    }
    for (const valid of [min, max]) {
      fireEvent.change(input, { target: { value: String(valid) } });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(input).toHaveValue(valid);
    }
    expect(mockedPolicyApi.saveConfiguration).not.toHaveBeenCalled();
    expect(mockedSettingsApi.updateMessagePolicyActivation).not.toHaveBeenCalled();
  });
  it("edits the eighth time field locally and cancels to the persisted time", () => {
    open("메시지 자동 발송");
    fireEvent.change(screen.getByLabelText("새 규칙 기본 발송 시각"), { target: { value: "25:00" } });
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("새 규칙 기본 발송 시각"), { target: { value: "14:37" } });
    expect(screen.getByText("14:37 (한국 시간)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
    expect(screen.getByLabelText("새 규칙 기본 발송 시각")).toHaveValue("09:00");
    expect(mockedPolicyApi.saveConfiguration).not.toHaveBeenCalled();
  });
  it("persists a full configuration with null CAS and keeps activation separate", async () => {
    open("메시지 자동 발송");
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "7" } });
    expect(screen.getByText("7분")).toBeInTheDocument();
    expect(mockedPolicyApi.saveConfiguration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledWith({ expectedVersion: null, configuration: { ...BASE_CONFIG.configuration, dispatchCheckIntervalMinutes: 7 } }, "branch-1"));
    expect(mockedSettingsApi.updateMessagePolicyActivation).not.toHaveBeenCalled();
    expect(configResponse.version).toBe("version-2");
    expect(screen.getByRole("switch", { name: "메시지 자동 발송 활성화" })).not.toBeChecked();
  });
  it("restores the persisted value after ordinary failure", async () => {
    mockedPolicyApi.saveConfiguration.mockRejectedValue({ response: { status: 503 } });
    open("메시지 자동 발송");
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("저장하지 못했어요"));
    expect(screen.getByLabelText("자동 작업 확인 간격")).toHaveValue(1);
  });
  it.each([true, false])("preserves newer pending edits after save success=%s", async (success) => {
    let resolve!: (value: MessageAutomationPolicyConfigResponse) => void;
    let reject!: (error: unknown) => void;
    mockedPolicyApi.saveConfiguration.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    open("메시지 자동 발송");
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "8" } });
    await act(async () => { if (success) resolve({ ...BASE_CONFIG, version: "saved-7", configuration: { ...BASE_CONFIG.configuration, dispatchCheckIntervalMinutes: 7 } }); else reject({ response: { status: 503 } }); });
    expect(screen.getByLabelText("자동 작업 확인 간격")).toHaveValue(8);
    fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
    expect(screen.getByLabelText("자동 작업 확인 간격")).toHaveValue(success ? 7 : 1);
  });
  it.each(["v1", null])("keeps draft origin %s after a same-branch remote refetch and retains it on conflict", async (originVersion) => {
    configResponse = { ...BASE_CONFIG, version: originVersion };
    mockedPolicyApi.saveConfiguration.mockRejectedValue({ response: { status: 409 } });
    const view = open("메시지 자동 발송");
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "7" } });
    configResponse = { ...BASE_CONFIG, version: "remote-v2", configuration: { ...BASE_CONFIG.configuration, quietHours: { ...BASE_CONFIG.configuration.quietHours, enabled: true } } };
    view.rerender(<MessageTenantApplicationSettings />);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("새로고침"));
    expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledWith({ expectedVersion: originVersion, configuration: { ...BASE_CONFIG.configuration, dispatchCheckIntervalMinutes: 7 } }, "branch-1");
    expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("자동 작업 확인 간격")).toHaveValue(7);
    expect(configResponse.version).toBe("remote-v2");
    expect(configResponse.configuration.quietHours.enabled).toBe(true);
  });
  it("advances newer edits only to their own successful save version", async () => {
    let resolve!: (value: MessageAutomationPolicyConfigResponse) => void;
    configResponse = { ...BASE_CONFIG, version: "v1" };
    mockedPolicyApi.saveConfiguration.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    const view = open("메시지 자동 발송");
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "8" } });
    await act(async () => resolve({ ...BASE_CONFIG, version: "own-saved-v2", configuration: { ...BASE_CONFIG.configuration, dispatchCheckIntervalMinutes: 7 } }));
    expect(screen.getByLabelText("자동 작업 확인 간격")).toHaveValue(8);
    configResponse = { ...BASE_CONFIG, version: "remote-v3", configuration: { ...BASE_CONFIG.configuration, dispatchCheckIntervalMinutes: 7, quietHours: { ...BASE_CONFIG.configuration.quietHours, enabled: true } } };
    view.rerender(<MessageTenantApplicationSettings />);
    mockedPolicyApi.saveConfiguration.mockRejectedValueOnce({ response: { status: 409 } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledTimes(2));
    expect(mockedPolicyApi.saveConfiguration).toHaveBeenNthCalledWith(1, { expectedVersion: "v1", configuration: { ...BASE_CONFIG.configuration, dispatchCheckIntervalMinutes: 7 } }, "branch-1");
    expect(mockedPolicyApi.saveConfiguration).toHaveBeenNthCalledWith(2, { expectedVersion: "own-saved-v2", configuration: { ...BASE_CONFIG.configuration, dispatchCheckIntervalMinutes: 8 } }, "branch-1");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("새로고침"));
    expect(screen.getByLabelText("자동 작업 확인 간격")).toHaveValue(8);
    expect(configResponse.configuration.quietHours.enabled).toBe(true);
  });
  it("retains a conflicting draft and sends no overwrite", async () => {
    mockedPolicyApi.saveConfiguration.mockRejectedValue({ response: { status: 409 } });
    open("메시지 자동 발송");
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("새로고침"));
    expect(screen.getByLabelText("자동 작업 확인 간격")).toHaveValue(7);
    expect(mockedPolicyApi.saveConfiguration).toHaveBeenCalledTimes(1);
    expect(configResponse.version).toBeNull();
  });
  it("confirms dirty selection and guards page unload", () => {
    open("메시지 자동 발송");
    fireEvent.change(screen.getByLabelText("자동 작업 확인 간격"), { target: { value: "7" } });
    jest.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getAllByText("중복 전송 확인")[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText("자동 작업 확인 간격")).toHaveValue(7);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(mockedPolicyApi.saveConfiguration).not.toHaveBeenCalled();
  });
  it("validates quiet targets/time and previews literal server impact without a write", async () => {
    const { container } = open("심야 시간 메세지 전송 금지");
    fireEvent.click(screen.getAllByRole("switch", { name: "심야 시간 메세지 전송 금지 활성화" })[0]);
    for (const target of ["고객", "제공인력", "직원"]) fireEvent.click(screen.getByRole("button", { name: target }));
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("한 개 이상");
    fireEvent.click(screen.getByRole("button", { name: "직원" }));
    fireEvent.change(screen.getByLabelText("심야 종료 시각"), { target: { value: "22:00" } });
    expect(screen.getByRole("alert")).toHaveTextContent("달라야");
    fireEvent.change(screen.getByLabelText("심야 종료 시각"), { target: { value: "08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "발송 취소" }));
    fireEvent.click(screen.getByRole("button", { name: "영향 미리보기" }));
    await waitFor(() => expect(screen.getByText("3건")).toBeInTheDocument());
    expect(mockedPolicyApi.previewConfiguration).toHaveBeenCalledWith({ expectedVersion: null, configuration: { ...BASE_CONFIG.configuration, quietHours: { ...BASE_CONFIG.configuration.quietHours, enabled: true, recipientGroups: ["STAFF"], action: "CANCEL" } } }, "branch-1");
    expect(mockedPolicyApi.saveConfiguration).not.toHaveBeenCalled();
    expect(container.querySelector('[data-slot="save-note"], [data-slot="dirty-state"], [data-slot="footer-note"]')).toBeNull();
  });
  it("disables edits on unavailable config without reporting OFF as saved", () => {
    configReadError = true;
    open("심야 시간 메세지 전송 금지");
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.getByText("설정을 불러오지 못했습니다")).toBeInTheDocument();
    expect(mockedPolicyApi.saveConfiguration).not.toHaveBeenCalled();
  });
});
