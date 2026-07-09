import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { settingsApi, type MessageAutomationPoliciesResponse } from "@/services/api";

import { MessageTenantApplicationSettings } from "../MessageTenantApplicationSettings";

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
    requestMessageSenderApproval: jest.fn(),
  },
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseMutation = jest.mocked(useMutation);
const mockedUseQueryClient = jest.mocked(useQueryClient);
const mockedUseGetAuthUser = jest.mocked(useGetAuthUser);
const mockedSettingsApi = jest.mocked(settingsApi);

const mockInvalidateQueries = jest.fn();

const DEFAULT_AUTOMATION_POLICIES: MessageAutomationPoliciesResponse = {
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
      requiresApproval: true,
      rows: [
        { id: "count", label: "재시도 횟수", value: "최대 2회" },
        { id: "interval", label: "재시도 간격", value: "실패 후 5분" },
      ],
    },
  ],
};

function getQueryKey(options: unknown) {
  if (typeof options !== "object" || options === null || !("queryKey" in options)) {
    return undefined;
  }

  return (options as { queryKey?: readonly unknown[] }).queryKey;
}

function mockSettingsQueries(
  isApproved: boolean,
  automationPolicies: MessageAutomationPoliciesResponse = DEFAULT_AUTOMATION_POLICIES,
) {
  mockedUseQuery.mockImplementation(((options: unknown) => {
    const queryKey = getQueryKey(options);

    if (queryKey?.[0] === "settings" && queryKey[1] === "message-sender-approval") {
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
      return {
        data: automationPolicies,
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
  mockedUseGetAuthUser.mockReturnValue({
    data: {
      id: "user-1",
      name: "송진호",
      branchName: "인천점",
    },
  } as unknown as ReturnType<typeof useGetAuthUser>);
  mockedUseQueryClient.mockReturnValue({
    invalidateQueries: mockInvalidateQueries,
  } as unknown as ReturnType<typeof useQueryClient>);
  mockedSettingsApi.getMessageAutomationPolicies.mockResolvedValue(DEFAULT_AUTOMATION_POLICIES);
  mockedUseMutation.mockImplementation(((options: {
    mutationFn?: (variables?: unknown) => unknown;
    onSuccess?: (data: unknown, variables: unknown, context: unknown) => unknown;
    onError?: (error: unknown, variables: unknown, context: unknown) => unknown;
  }) => {
    return {
      mutate: (variables?: unknown) => {
        Promise.resolve(options.mutationFn?.(variables))
          .then((data) => options.onSuccess?.(data, variables, undefined))
          .catch((error) => options.onError?.(error, variables, undefined));
      },
      isPending: false,
    };
  }) as unknown as typeof useMutation);
});

describe("MessageTenantApplicationSettings", () => {
  it("renders automation policy items from the API", () => {
    mockSettingsQueries(true, {
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
          requiresApproval: true,
          rows: [
            { id: "count", label: "재시도 횟수", value: "API 최대 4회" },
          ],
        },
      ],
    });

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("설정").length).toBeGreaterThan(0);
    expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
    expect(screen.getAllByText("API 제공기록지 정책").length).toBeGreaterThan(0);
    expect(screen.getByText("API 오후 3시")).toBeInTheDocument();
    expect(screen.getByText("API 지난 루틴 정책")).toBeInTheDocument();
    expect(screen.getByText("API SMS 재시도 정책")).toBeInTheDocument();
    expect(screen.getAllByText("중복 전송 확인").length).toBeGreaterThan(0);
    const servicePolicySwitch = screen.getByRole("switch", { name: "API 제공기록지 정책 활성화" });
    const inactivePolicySwitch = screen.getByRole("switch", { name: "API 지난 루틴 정책 활성화" });
    const smsPolicySwitch = screen.getByRole("switch", { name: "API SMS 재시도 정책 활성화" });

    expect(servicePolicySwitch).toBeDisabled();
    expect(servicePolicySwitch).toHaveAttribute("aria-checked", "true");
    expect(inactivePolicySwitch).toBeDisabled();
    expect(inactivePolicySwitch).toHaveAttribute("aria-checked", "false");
    expect(smsPolicySwitch).toBeDisabled();
    expect(smsPolicySwitch).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "중복 전송 확인 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByText("API 지난 루틴 정책"));

    expect(screen.getByText("API 지난 루틴 미실행")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("중복 전송 확인")[0]);

    expect(screen.getByText("최근 72시간")).toBeInTheDocument();
    expect(container.querySelector('[data-component="messages-settings-duplicate-send-policy"]')).toBeInTheDocument();
  });

  it("SMS retry row shows the API-provided value, not hardcoded copy", () => {
    mockSettingsQueries(true, {
      policies: [
        {
          id: "sms-retry",
          title: "SMS 재시도 규칙",
          description: "API에서 내려준 SMS 재시도 설명",
          active: true,
          requiresApproval: true,
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

  it("shows the sender application item and duplicate send policy before approval", () => {
    mockSettingsQueries(false);

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("메시지 발송 기능 신청").length).toBeGreaterThan(0);
    expect(screen.getByText("제공기록지 전송 자동화 규칙")).toBeInTheDocument();
    expect(screen.getByText("지난 자동 전송 처리 규칙")).toBeInTheDocument();
    expect(screen.getByText("SMS 재시도 규칙")).toBeInTheDocument();
    expect(screen.getByText("중복 전송 확인")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "제공기록지 전송 자동화 규칙 활성화" })).toBeInTheDocument();
    expect(container.querySelector('[data-component="messages-settings-tenant-application"]')).toBeInTheDocument();
  });

  it("policy switches stay disabled and off when unapproved even if the API says active", () => {
    mockSettingsQueries(false);

    render(<MessageTenantApplicationSettings />);

    const policySwitchNames = [
      "제공기록지 전송 자동화 규칙 활성화",
      "지난 자동 전송 처리 규칙 활성화",
      "SMS 재시도 규칙 활성화",
      "중복 전송 확인 활성화",
    ];

    for (const name of policySwitchNames) {
      const policySwitch = screen.getByRole("switch", { name });
      expect(policySwitch).toBeDisabled();
      expect(policySwitch).toHaveAttribute("aria-checked", "false");
    }

    // Clicking a disabled switch must not toggle it on.
    fireEvent.click(screen.getByRole("switch", { name: policySwitchNames[0] }));
    expect(screen.getByRole("switch", { name: policySwitchNames[0] })).toHaveAttribute(
      "aria-checked",
      "false",
    );
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
});
