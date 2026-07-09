import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { settingsApi } from "@/services/api";

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
    requestMessageSenderApproval: jest.fn(),
  },
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseMutation = jest.mocked(useMutation);
const mockedUseQueryClient = jest.mocked(useQueryClient);
const mockedUseGetAuthUser = jest.mocked(useGetAuthUser);
const mockedSettingsApi = jest.mocked(settingsApi);

const mockInvalidateQueries = jest.fn();

function mockSenderApproval(isApproved: boolean) {
  mockedUseQuery.mockReturnValue({
    data: {
      approvalStatus: isApproved ? "approved" : "not_requested",
      isApproved,
      canRequest: !isApproved,
      requestedAt: null,
      approvedAt: isApproved ? "2026-06-05T00:00:00.000Z" : null,
    },
    isLoading: false,
  } as unknown as ReturnType<typeof useQuery>);
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
  it("shows the duplicate send policy but hides the sender application item after approval", () => {
    mockSenderApproval(true);

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("설정").length).toBeGreaterThan(0);
    expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
    expect(screen.getAllByText("제공기록지 전송 자동화 규칙").length).toBeGreaterThan(0);
    expect(screen.getByText("서비스 시작일 오후 3시")).toBeInTheDocument();
    expect(screen.getByText("지난 자동 전송 처리 규칙")).toBeInTheDocument();
    expect(screen.getByText("SMS 재시도 규칙")).toBeInTheDocument();
    expect(screen.getAllByText("중복 전송 확인").length).toBeGreaterThan(0);
    expect(screen.getByRole("switch", { name: "제공기록지 전송 자동화 규칙 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "지난 자동 전송 처리 규칙 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "SMS 재시도 규칙 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "중복 전송 확인 활성화" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByText("지난 자동 전송 처리 규칙"));

    expect(screen.getByText("고객 추가 시점이 자동 전송 트리거 시점 이후")).toBeInTheDocument();
    expect(screen.getByText("지난 루틴 미실행")).toBeInTheDocument();
    expect(screen.getByText("자동 메시지 템플릿 전송 루틴")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "지난 자동 전송 처리 규칙 활성화" }));

    expect(screen.getByRole("switch", { name: "지난 자동 전송 처리 규칙 활성화" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText("고객 추가 시점이 자동 전송 트리거 시점 이후")).toBeInTheDocument();

    fireEvent.click(screen.getByText("SMS 재시도 규칙"));

    expect(screen.getByText("최대 2회")).toBeInTheDocument();
    expect(screen.getByText("실패 후 5분")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("중복 전송 확인")[0]);

    expect(screen.getByText("최근 72시간")).toBeInTheDocument();
    expect(container.querySelector('[data-component="messages-settings-duplicate-send-policy"]')).toBeInTheDocument();
  });

  it("shows the sender application item and duplicate send policy before approval", () => {
    mockSenderApproval(false);

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("메시지 발송 기능 신청").length).toBeGreaterThan(0);
    expect(screen.getByText("제공기록지 전송 자동화 규칙")).toBeInTheDocument();
    expect(screen.getByText("지난 자동 전송 처리 규칙")).toBeInTheDocument();
    expect(screen.getByText("SMS 재시도 규칙")).toBeInTheDocument();
    expect(screen.getByText("중복 전송 확인")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "제공기록지 전송 자동화 규칙 활성화" })).toBeInTheDocument();
    expect(container.querySelector('[data-component="messages-settings-tenant-application"]')).toBeInTheDocument();
  });

  it("policy toggles are off and disabled when the branch is unapproved", () => {
    mockSenderApproval(false);

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
    mockSenderApproval(false);
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
