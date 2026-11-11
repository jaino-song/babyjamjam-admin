import { act, fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import type { MessageAutomationPolicyConfigResponse, MessageTriggerRuleGroupView } from "@babyjamjam/shared/types/message";
import type { ReactElement } from "react";
import { messageRuleGroupsApi } from "@/services/api";
import { MessageTriggerList } from "../MessageTriggerList";
import { MessageTriggerEditor } from "../MessageTriggerEditor";

const mockGroupList = jest.fn();
const mockPreview = jest.fn();
const mockGetConfig = jest.fn();
const configKey = ["settings", "message-automation-config", "branch-1"] as const;
const CONFIG: MessageAutomationPolicyConfigResponse = {
  version: "v1", permissions: { canRead: true, canWrite: true }, warnings: [],
  configuration: { schemaVersion: 1, dispatchCheckIntervalMinutes: 5, defaultRuleSendTime: "11:00", triggerRetryIntervalMinutes: 5, processingReclaimMinutes: 10, smsRetryIntervalMinutes: 5, pastExpiryHours: 72, pastSendIntervalMinutes: 5, pastRuleOrder: [], duplicateWindowHours: 72, quietHours: { enabled: false, start: "21:00", end: "08:00", recipientGroups: ["CLIENT"], action: "DEFER", timezone: "Asia/Seoul" } },
};
jest.mock("@/services/api", () => ({ settingsApi: { getMessageAutomationConfig: (...args: unknown[]) => mockGetConfig(...args) }, messageRuleGroupsApi: { create: (...args: unknown[]) => createRule(...args), update: jest.fn(), remove: jest.fn(), preview: (...args: unknown[]) => mockPreview(...args), list: (...args: unknown[]) => mockGroupList(...args) } }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: { branchId: "branch-1", role: "owner" } }) }));
jest.mock("@/lib/messages/logs", () => ({ fetchAllMessageLogs: async () => [] }));
function render(ui: ReactElement, cachedConfig = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (cachedConfig) client.setQueryData(configKey, CONFIG);
  const tree = (element: ReactElement) => <QueryClientProvider client={client}>{element}</QueryClientProvider>;
  const view = renderBase(tree(ui));
  return { ...view, client, rerender: (element: ReactElement) => view.rerender(tree(element)) };
}

const createRule = jest.fn();
const updateRule = jest.fn();
const deleteRule = jest.fn();

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerTemplates: () => ({
    data: [{
      key: "SERVICE_INFO",
      name: "서비스 안내",
      description: "서비스 시작 안내",
      allowedEventTypes: ["SERVICE_START"],
      allowedRecipientTypes: ["CLIENT"],
      requiredVariables: [],
      providers: { sms: { templateKey: "SERVICE_INFO" } },
    }, {
      key: "CLIENT_GREETING", name: "고객 인사", description: "", allowedEventTypes: ["CLIENT_CREATED"], allowedRecipientTypes: ["CLIENT"], requiredVariables: [], providers: { sms: { templateKey: "CLIENT_GREETING" } },
    }, {
      key: "CAREGIVER_SERVICE_START_NOTICE", name: "제공인력 시작 안내", description: "", allowedEventTypes: ["SERVICE_START"], allowedRecipientTypes: ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"], requiredVariables: [], providers: { sms: { templateKey: "CAREGIVER_SERVICE_START_NOTICE" } },
    }],
    isLoading: false,
  }),
  useCreateMessageTriggerRule: () => ({ mutateAsync: createRule, isPending: false }),
  useUpdateMessageTriggerRule: () => ({ mutateAsync: updateRule, isPending: false }),
  useDeleteMessageTriggerRule: () => ({ mutateAsync: deleteRule, isPending: false }),
  useUpdateMessageTriggerRuleBranchActivation: () => ({ mutate: jest.fn(), isPending: false }),
}));

describe("MessageTriggerEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockReset().mockResolvedValue(CONFIG);
    createRule.mockResolvedValue({ id: "new-rule" });
    updateRule.mockResolvedValue({});
    deleteRule.mockResolvedValue({});
    mockGroupList.mockResolvedValue({ groups: [], standaloneRules: [] });
    mockPreview.mockResolvedValue({ complete: false, count: 0, recipients: [] });
  });

  it("submits the configured branch default without a time edit and keeps it after refetch", async () => {
    const onDirtyChange = jest.fn();
    const { client } = render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onDirtyChange={onDirtyChange} onClose={jest.fn()} />, false);
    await waitFor(() => expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("11:00"));
    expect(mockGetConfig).toHaveBeenCalledWith("branch-1");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    mockGetConfig.mockResolvedValue({ ...CONFIG, configuration: { ...CONFIG.configuration, defaultRuleSendTime: "12:00" } });
    await act(async () => { await client.refetchQueries({ queryKey: configKey }); });
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("11:00");
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "기본 시각 안내" } });
    fireEvent.click(screen.getByRole("button", { name: "수신자별 미리보기" }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith({ draft: expect.objectContaining({ sendTime: "11:00" }) }, "branch-1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "규칙 저장" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() => expect(createRule).toHaveBeenCalledWith(expect.objectContaining({ sendTime: "11:00" }), "branch-1"));
  });

  it.each([false, true])("preserves draft edits while configuration loads (time edited: %s)", async (editTime) => {
    let resolveConfig!: (config: MessageAutomationPolicyConfigResponse) => void;
    mockGetConfig.mockReturnValue(new Promise<MessageAutomationPolicyConfigResponse>((resolve) => { resolveConfig = resolve; }));
    const onDirtyChange = jest.fn();
    const { client } = render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onDirtyChange={onDirtyChange} onClose={jest.fn()} />, false);
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "보존할 이름" } });
    expect(screen.getByRole("button", { name: "규칙 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "수신자별 미리보기" })).toBeDisabled();
    if (editTime) fireEvent.change(screen.getByLabelText("발송 시각 (한국 시간)"), { target: { value: "16:45" } });
    await act(async () => { resolveConfig(CONFIG); });
    await waitFor(() => expect(client.getQueryState(configKey)?.status).toBe("success"));
    await waitFor(() => expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue(editTime ? "16:45" : "11:00"));
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("보존할 이름");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.change(screen.getByLabelText("발송 시각 (한국 시간)"), { target: { value: "17:30" } });
    mockGetConfig.mockResolvedValue({ ...CONFIG, configuration: { ...CONFIG.configuration, defaultRuleSendTime: "12:00" } });
    await act(async () => { await client.refetchQueries({ queryKey: configKey }); });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() => expect(createRule).toHaveBeenCalledWith(expect.objectContaining({ name: "보존할 이름", sendTime: "17:30" }), "branch-1"));
  });

  it("leaves the time empty and prevents scheduled requests when configuration is unavailable", async () => {
    mockGetConfig.mockRejectedValue(new Error("503"));
    const { client } = render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onClose={jest.fn()} />, false);
    await waitFor(() => expect(client.getQueryState(configKey)?.status).toBe("error"));
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "설정 없는 안내" } });
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "수신자별 미리보기" }));
    expect(createRule).not.toHaveBeenCalled();
    expect(mockPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "규칙 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "수신자별 미리보기" })).toBeDisabled();
  });

  it("creates a mobile automation rule with the same rule fields as desktop", async () => {
    const onClose = jest.fn();
    render(
      <MessageTriggerEditor
        data-component="mobile_messages_automation_test_editor"
        rule={null}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "서비스 시작 안내" } });
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("11:00");
    fireEvent.change(screen.getByLabelText("발송 시각 (한국 시간)"), { target: { value: "23:59" } });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));

    await waitFor(() => expect(createRule).toHaveBeenCalledWith({
      name: "서비스 시작 안내",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
      sendTime: "23:59",
      recipientMode: "CLIENT",
      recipientTemplates: { CLIENT: "SERVICE_INFO" },
      targetClientStatus: "all",
      retryOnFailure: true,
    }, "branch-1"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not require a hidden time after switching to immediate sending", async () => {
    render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "즉시 안내" } });
    fireEvent.change(screen.getByLabelText("발송 시각 (한국 시간)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("발송 이벤트"), { target: { value: "CLIENT_CREATED" } });
    expect(screen.queryByLabelText("발송 시각 (한국 시간)")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("고객 메시지 템플릿"), { target: { value: "CLIENT_GREETING" } });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() => expect(createRule).toHaveBeenCalledWith(expect.objectContaining({ offsetType: "IMMEDIATE", sendTime: "09:00" }), "branch-1"));
  });

  it("updates and deletes an existing rule", async () => {
    const onClose = jest.fn();
    render(<MessageTriggerEditor
      data-component="mobile_messages_automation_test_editor"
      rule={{
        id: "rule-1",
        branchId: "branch-1",
        name: "기존 규칙",
        isActive: false,
        eventType: "SERVICE_START",
        offsetType: "BEFORE_DAYS",
        offsetDays: 3,
        sendTime: "14:30",
        recipientType: "CLIENT",
        templateKey: "SERVICE_INFO",
        targetClientStatus: "waiting",
        retryOnFailure: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }}
      onClose={onClose}
    />);

    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "수정 규칙" } });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));

    await waitFor(() => expect(updateRule).toHaveBeenCalledWith({
      id: "rule-1",
      dto: expect.objectContaining({
        name: "수정 규칙",
        isActive: false,
        offsetDays: 3,
        sendTime: "14:30",
        targetClientStatus: "waiting",
        retryOnFailure: false,
      }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "규칙 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));

    await waitFor(() => expect(deleteRule).toHaveBeenCalledWith("rule-1"));
  });

  describe("대상 고객 상태 and 실패 시 재전송", () => {
    const storedRule = {
      id: "rule-1",
      branchId: "branch-1",
      name: "기존 규칙",
      isActive: true,
      eventType: "SERVICE_START" as const,
      offsetType: "BEFORE_DAYS" as const,
      offsetDays: 3,
      sendTime: "14:30",
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      targetClientStatus: "waiting" as const,
      retryOnFailure: false,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

    it("hides default rule deletion while allowing deactivation", async () => {
      render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={{ ...storedRule, isDefault: true }} onClose={jest.fn()} />);
      expect(screen.queryByRole("button", { name: "규칙 삭제" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByLabelText("규칙 활성화"));
      fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
      await waitFor(() => expect(updateRule).toHaveBeenCalledWith({ id: storedRule.id, dto: expect.objectContaining({ isActive: false }) }));
      expect(deleteRule).not.toHaveBeenCalled();
    });

    it("renders both controls with the defaults and the four shared status options", () => {
      render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onClose={jest.fn()} />);

      const status = screen.getByLabelText("대상 고객 상태") as HTMLSelectElement;
      expect(status).toHaveValue("all");
      expect(Array.from(status.options).map((option) => [option.value, option.textContent])).toEqual([
        ["all", "전체"],
        ["pre_booking", "예약 전"],
        ["waiting", "대기"],
        ["active", "진행"],
      ]);
      expect(screen.getByLabelText("실패 시 재전송")).toBeChecked();
      expect(screen.getByText("일시적인 발송 실패를 설정된 재시도 간격에 따라 다시 보냅니다.")).toBeInTheDocument();
    });

    it("renders both controls with the stored values of an existing rule", () => {
      render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={storedRule} onClose={jest.fn()} />);

      expect(screen.getByLabelText("대상 고객 상태")).toHaveValue("waiting");
      expect(screen.getByLabelText("실패 시 재전송")).not.toBeChecked();
    });

    it("submits the changed values when creating a rule", async () => {
      render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onClose={jest.fn()} />);

      fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "진행 고객 안내" } });
      fireEvent.change(screen.getByLabelText("대상 고객 상태"), { target: { value: "active" } });
      fireEvent.click(screen.getByLabelText("실패 시 재전송"));
      fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));

      await waitFor(() => expect(createRule).toHaveBeenCalledWith(expect.objectContaining({
        targetClientStatus: "active",
        retryOnFailure: false,
      }), "branch-1"));
    });

    it("submits the changed values when updating a rule", async () => {
      render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={storedRule} onClose={jest.fn()} />);

      fireEvent.change(screen.getByLabelText("대상 고객 상태"), { target: { value: "pre_booking" } });
      fireEvent.click(screen.getByLabelText("실패 시 재전송"));
      fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));

      await waitFor(() => expect(updateRule).toHaveBeenCalledWith({
        id: "rule-1",
        dto: expect.objectContaining({
          targetClientStatus: "pre_booking",
          retryOnFailure: true,
        }),
      }));
    });
  });
  it("requires a template for every expanded role and previews literal server results without saving", async () => {
    mockPreview.mockResolvedValue({ complete: false, count: 1, recipients: [{ ruleId: "r", recipientType: "PRIMARY_EMPLOYEE", employeeId: 3, employeeScheduleId: 9, recipientName: "주제공인력", recipientPhone: "01011112222", templateKey: "CAREGIVER_SERVICE_START_NOTICE", body: "서버가 만든 본문", count: 1, scheduledFor: "2026-11-07T00:00:00Z", anchorSource: "employee_schedule.startDate", anchorDate: "2026-11-07", outcome: "ready", reason: null }, { ruleId: "r2", recipientType: "SECONDARY_EMPLOYEE", employeeId: null, employeeScheduleId: null, recipientName: null, recipientPhone: null, templateKey: "CAREGIVER_SERVICE_START_NOTICE", body: null, count: 0, scheduledFor: null, anchorSource: "employee_schedule.startDate", anchorDate: null, outcome: "skip", reason: "배정 없음" }] });
    render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "제공인력 안내" } });
    fireEvent.click(screen.getByRole("button", { name: "주보조모두" }));
    expect(screen.getByRole("button", { name: "규칙 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "수신자별 미리보기" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("주 담당 제공인력 메시지 템플릿"), { target: { value: "CAREGIVER_SERVICE_START_NOTICE" } });
    expect(screen.getByRole("button", { name: "규칙 저장" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("보조 제공인력 메시지 템플릿"), { target: { value: "CAREGIVER_SERVICE_START_NOTICE" } });
    fireEvent.click(screen.getByRole("button", { name: "수신자별 미리보기" }));
    expect(await screen.findByText("서버가 만든 본문")).toBeInTheDocument();
    expect(screen.getByText(/배정 없음/)).toBeInTheDocument();
    expect(mockPreview).toHaveBeenCalledWith({ draft: expect.objectContaining({ recipientMode: "BOTH_EMPLOYEES", recipientTemplates: { PRIMARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE", SECONDARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE" } }) }, "branch-1");
    expect(createRule).not.toHaveBeenCalled();
  });

  it("blocks CLIENT_CREATED provider combinations with zero preview/save calls", async () => {
    render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "등록 안내" } });
    fireEvent.change(screen.getByLabelText("발송 이벤트"), { target: { value: "CLIENT_CREATED" } });
    fireEvent.click(screen.getByRole("button", { name: "주제공인력" }));
    expect(screen.getByRole("button", { name: "규칙 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "수신자별 미리보기" })).toBeDisabled();
    expect(createRule).not.toHaveBeenCalled(); expect(mockPreview).not.toHaveBeenCalled();
  });

  it("shows one BOTH parent row and keeps standalone system compatibility", async () => {
    const child = { id: "child-one", groupId: "g", branchId: "branch-1", name: "child", isActive: true, eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "09:00", recipientType: "PRIMARY_EMPLOYEE", templateKey: "CAREGIVER_SERVICE_START_NOTICE", targetClientStatus: "all", retryOnFailure: true, createdAt: "2026-11-01", updatedAt: "2026-11-01" };
    mockGroupList.mockResolvedValue({ groups: [{ id: "g", name: "두 제공인력 안내", recipientMode: "BOTH_EMPLOYEES", branchId: "branch-1", version: 3, isActive: true, rules: [child, { ...child, id: "child-two", recipientType: "SECONDARY_EMPLOYEE" }], eventType: "SERVICE_START", offsetType: "SAME_DAY", offsetDays: 0, sendTime: "09:00", targetClientStatus: "all", retryOnFailure: true, recipientTemplates: { PRIMARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE", SECONDARY_EMPLOYEE: "CAREGIVER_SERVICE_START_NOTICE" } }], standaloneRules: [{ ...child, id: "system", groupId: null, name: "시스템 안내", branchId: null }] });
    render(<MessageTriggerList data-component="mobile_messages_automation_test_list" canManage onEdit={jest.fn()} onEditGroup={jest.fn()} />);
    expect(await screen.findByText("두 제공인력 안내")).toBeInTheDocument();
    expect(screen.getAllByText("두 제공인력 안내")).toHaveLength(1);
    expect(screen.getByText("시스템 안내")).toBeInTheDocument(); expect(screen.queryByText("child")).not.toBeInTheDocument();
  });

  it("does not fall back to individual rules after a group503", async () => {
    mockGroupList.mockRejectedValue(new Error("503"));
    render(<MessageTriggerList data-component="mobile_messages_automation_test_list" canManage onEdit={jest.fn()} />);
    expect(await screen.findByText("자동 전송 트리거를 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByText("등록된 자동 전송 트리거가 없습니다.")).not.toBeInTheDocument();
  });

  it.each([false, true])("refreshes standalone details only while pristine (dirty: %s)", async (editDraft) => {
    const rule = { id: "r", branchId: "branch-1", name: "기존 규칙", isActive: false, eventType: "SERVICE_START" as const, offsetType: "BEFORE_DAYS" as const, offsetDays: 3, sendTime: "10:30", recipientType: "CLIENT" as const, templateKey: "SERVICE_INFO" as const, targetClientStatus: "all" as const, retryOnFailure: true, createdAt: "2026-11-01", updatedAt: "2026-11-01" };
    const view = render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={rule} onClose={jest.fn()} />);
    if (editDraft) fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "보존할 변경" } });
    view.rerender(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={{ ...rule, name: "다른 탭의 이름", sendTime: "12:45", updatedAt: "2026-11-02" }} onClose={jest.fn()} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue(editDraft ? "보존할 변경" : "다른 탭의 이름");
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue(editDraft ? "10:30" : "12:45");
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() => expect(updateRule).toHaveBeenCalledWith({ id: "r", dto: expect.objectContaining({ name: editDraft ? "보존할 변경" : "다른 탭의 이름", sendTime: editDraft ? "10:30" : "12:45" }) }));
  });

  it("adopts refreshed group fields and version while the detail is pristine", async () => {
    const group: MessageTriggerRuleGroupView = { id: "g", branchId: "branch-1", name: "저장된 규칙", recipientMode: "CLIENT", version: 1, createdAt: "2026-11-01", updatedAt: "2026-11-01", deletedAt: null, rules: [], eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 3, sendTime: "10:30", targetClientStatus: "all", retryOnFailure: true, isActive: false, recipientTemplates: { CLIENT: "SERVICE_INFO" } };
    const onDirtyChange = jest.fn();
    const onClose = jest.fn();
    const view = render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} group={group} onDirtyChange={onDirtyChange} onClose={onClose} />);
    const refreshed = { ...group, name: "다른 탭에서 변경", version: 2, sendTime: "12:45", updatedAt: "2026-11-02" };
    view.rerender(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} group={refreshed} onDirtyChange={onDirtyChange} onClose={onClose} />);
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("다른 탭에서 변경");
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("12:45");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "최신 버전 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() => expect(messageRuleGroupsApi.update).toHaveBeenCalledWith("g", expect.objectContaining({ expectedVersion: 2, name: "최신 버전 편집", sendTime: "12:45" }), "branch-1"));
  });

  it("adopts a version-only refresh before the next edit", async () => {
    const group: MessageTriggerRuleGroupView = { id: "g", branchId: "branch-1", name: "저장된 규칙", recipientMode: "CLIENT", version: 1, createdAt: "2026-11-01", updatedAt: "2026-11-01", deletedAt: null, rules: [], eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 3, sendTime: "10:30", targetClientStatus: "all", retryOnFailure: true, isActive: false, recipientTemplates: { CLIENT: "SERVICE_INFO" } };
    const view = render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} group={group} onClose={jest.fn()} />);
    view.rerender(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} group={{ ...group, version: 2 }} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "다음 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() => expect(messageRuleGroupsApi.update).toHaveBeenCalledWith("g", expect.objectContaining({ expectedVersion: 2 }), "branch-1"));
  });

  it("retains the loaded group version through a refetch and preserves a409 draft", async () => {
    const group: MessageTriggerRuleGroupView = { id: "g", branchId: "branch-1", name: "저장된 규칙", recipientMode: "CLIENT", version: 2, createdAt: "2026-11-01", updatedAt: "2026-11-01", deletedAt: null, rules: [], eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 3, sendTime: "09:00", targetClientStatus: "all", retryOnFailure: true, isActive: true, recipientTemplates: { CLIENT: "SERVICE_INFO" } };
    jest.mocked(messageRuleGroupsApi.update).mockRejectedValueOnce(new Error("409"));
    const onClose = jest.fn();
    const view = render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} group={group} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "보존할 변경" } });
    view.rerender(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} group={{ ...group, version: 3, name: "다른 탭의 이름", sendTime: "12:45" }} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() => expect(messageRuleGroupsApi.update).toHaveBeenCalledWith("g", expect.objectContaining({ expectedVersion: 2, name: "보존할 변경", sendTime: "09:00" }), "branch-1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("저장하지 못했습니다");
    expect(screen.getByLabelText("규칙 이름")).toHaveValue("보존할 변경"); expect(onClose).not.toHaveBeenCalled();
  });

  it.each(["create", "update", "delete"])("invalidates only the captured branch group cache after group %s", async (operation) => {
    const group: MessageTriggerRuleGroupView = { id: "g", branchId: "branch-1", name: "저장된 규칙", recipientMode: "CLIENT", version: 2, createdAt: "2026-11-01", updatedAt: "2026-11-01", deletedAt: null, rules: [], eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 3, sendTime: "09:00", targetClientStatus: "all", retryOnFailure: true, isActive: true, recipientTemplates: { CLIENT: "SERVICE_INFO" } };
    jest.mocked(messageRuleGroupsApi.update).mockResolvedValue(group);
    jest.mocked(messageRuleGroupsApi.remove).mockResolvedValue(undefined);
    const onClose = jest.fn();
    const { client } = render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} group={operation === "create" ? null : group} onClose={onClose} />);
    const ownBranchKey = [...messageTriggerKeys.all, "rule-groups", "branch-1"];
    const otherBranchKey = [...messageTriggerKeys.all, "rule-groups", "branch-2"];
    const cachedList = { groups: [group], standaloneRules: [] };
    client.setQueryData(ownBranchKey, cachedList);
    client.setQueryData(otherBranchKey, cachedList);
    client.setQueryData(messageTriggerKeys.list(), []);

    if (operation === "delete") {
      fireEvent.click(screen.getByRole("button", { name: "규칙 삭제" }));
      fireEvent.click(screen.getByRole("button", { name: "삭제 확인" }));
    } else {
      fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "새 안내" } });
      await waitFor(() => expect(screen.getByRole("button", { name: "규칙 저장" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    }

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(client.getQueryState(ownBranchKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherBranchKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(messageTriggerKeys.list())?.isInvalidated).toBe(false);
    expect(client.getQueryData(ownBranchKey)).toEqual(cachedList);
  });

});
