import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessageTriggerEditor } from "../MessageTriggerEditor";

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
    }],
    isLoading: false,
  }),
  useCreateMessageTriggerRule: () => ({ mutateAsync: createRule, isPending: false }),
  useUpdateMessageTriggerRule: () => ({ mutateAsync: updateRule, isPending: false }),
  useDeleteMessageTriggerRule: () => ({ mutateAsync: deleteRule, isPending: false }),
}));

describe("MessageTriggerEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createRule.mockResolvedValue({ id: "new-rule" });
    updateRule.mockResolvedValue({});
    deleteRule.mockResolvedValue({});
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
    expect(screen.getByLabelText("발송 시각 (한국 시간)")).toHaveValue("09:00");
    fireEvent.change(screen.getByLabelText("발송 시각 (한국 시간)"), { target: { value: "23:59" } });
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));

    await waitFor(() => expect(createRule).toHaveBeenCalledWith({
      name: "서비스 시작 안내",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
      sendTime: "23:59",
      recipientType: "CLIENT",
      templateKey: "SERVICE_INFO",
      targetClientStatus: "all",
      retryOnFailure: true,
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not require a hidden time after switching to immediate sending", async () => {
    render(<MessageTriggerEditor data-component="mobile_messages_automation_test_editor" rule={null} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("규칙 이름"), { target: { value: "즉시 안내" } });
    fireEvent.change(screen.getByLabelText("발송 시각 (한국 시간)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("발송 이벤트"), { target: { value: "CLIENT_CREATED" } });
    expect(screen.queryByLabelText("발송 시각 (한국 시간)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "규칙 저장" }));
    await waitFor(() => expect(createRule).toHaveBeenCalledWith(expect.objectContaining({ offsetType: "IMMEDIATE", sendTime: "09:00" })));
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
      recipientType: "CLIENT" as const,
      templateKey: "SERVICE_INFO" as const,
      targetClientStatus: "waiting" as const,
      retryOnFailure: false,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };

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
      expect(screen.getByText("일시적인 발송 실패를 5분 간격으로 최대 3번 다시 보냅니다.")).toBeInTheDocument();
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
      })));
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
});
