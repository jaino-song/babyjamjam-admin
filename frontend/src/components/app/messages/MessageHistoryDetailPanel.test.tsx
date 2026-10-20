import fs from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MessageResendBlock } from "@babyjamjam/shared";
import { MESSAGE_LOG_STATUS_BADGE_VARIANT } from "@babyjamjam/shared";
import type { MessageLogRecord } from "@babyjamjam/shared/types/message";
import { statusBadgeVariants } from "@/components/app/ui/status-badge";
import { cn } from "@/lib/utils";

import {
  MessageHistoryDetailPanel,
  MESSAGE_HISTORY_STATUS_META,
  normalizeMessageHistoryRecord,
} from "./MessageHistoryDetailPanel";

const source = fs.readFileSync(require.resolve("./MessageHistoryDetailPanel"), "utf8");

describe("MessageHistoryDetailPanel delivery status labels", () => {
  it("carries the shared lookup label through normalization into the detail badge only", () => {
    expect(source).toContain("detailStatusLabel: normalized.isResent ? MESSAGE_RESENT_LABEL : getMessageHistoryDetailStatusLabel(record)");
    expect(source).toContain("selectedRecord.detailStatusLabel ?? MESSAGE_HISTORY_STATUS_META[selectedRecord.status].label");
    const matcher = source.slice(source.indexOf("export function matchesMessageHistoryQuery"), source.indexOf("export function MessageHistoryDetailPanel"));
    expect(matcher).not.toContain("detailStatusLabel");
  });
  it("should use the shared sent label instead of a standalone completion label", () => {
    const badges = source.slice(
      source.indexOf("badges={"),
      source.indexOf("trailing={"),
    );

    expect(badges).toContain("MESSAGE_HISTORY_STATUS_META[selectedRecord.status].label");
    expect(badges).not.toContain("\n            완료\n");
  });
});

describe("MessageHistoryDetailPanel needs_setup status", () => {
  const needsSetupRecord: MessageLogRecord = {
    id: 7,
    provider: "aligo_sms",
    templateKey: "service_record_link_sms",
    triggerJobId: "job-7",
    receiver: "01012345678",
    clientId: 10,
    recipientPhone: "01012345678",
    messageBody: "",
    variables: {},
    status: "needs_setup",
    aligoMid: null,
    errorMessage: "수신자 연락처가 필요합니다.",
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:10:00.000Z",
    ruleId: "rule-1",
    ruleName: "제공기록지 링크",
    eventType: "SERVICE_START",
    offsetType: "SAME_DAY",
    offsetDays: 0,
    scheduledFor: "2026-07-16T12:00:00.000Z",
    recipientType: "CLIENT",
    recipientName: "김고객",
    clientName: "김고객",
    employeeName: null,
  };

  it("has list-badge metadata so a 추가 정보 필요 row cannot render an empty badge", () => {
    expect(MESSAGE_HISTORY_STATUS_META.needs_setup.label).toBe("추가 정보 필요");
    expect(MESSAGE_HISTORY_STATUS_META.needs_setup.icon).toBeDefined();
  });

  it("renders 추가 정보 필요 in the detail panel instead of throwing", () => {
    const selectedRecord = normalizeMessageHistoryRecord(needsSetupRecord);

    render(
      <MessageHistoryDetailPanel
        selectedRecord={selectedRecord}
        dataComponentPrefix="desktop_messages_test"
      />,
    );

    expect(screen.getAllByText("추가 정보 필요").length).toBeGreaterThan(0);
  });
});

describe("MessageHistoryDetailPanel 추가 정보 필요 reason and 재발송 (BJJ-444)", () => {
  const baseLog: MessageLogRecord = {
    id: 7,
    provider: "aligo_sms",
    templateKey: "service_record_link_sms",
    triggerJobId: null,
    receiver: "01012345678",
    clientId: 10,
    recipientPhone: "01012345678",
    messageBody: "",
    variables: {},
    status: "failed",
    aligoMid: null,
    errorMessage: "발송에 실패했습니다.",
    attempts: 1,
    lastAttemptAt: "2026-07-16T12:00:00.000Z",
    nextRetryAt: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:10:00.000Z",
    ruleId: "rule-1",
    ruleName: "제공기록지 링크",
    eventType: "SERVICE_START",
    offsetType: "SAME_DAY",
    offsetDays: 0,
    scheduledFor: "2026-07-16T12:00:00.000Z",
    recipientType: "CLIENT",
    recipientName: "김고객",
    clientName: "김고객",
    employeeName: null,
  };
  const jobUuid = "6f0c7a52-6d41-4c63-9d0e-3a5b8a5f2b11";
  const needsSetupJobRow = {
    ...baseLog,
    id: `job:${jobUuid}`,
    provider: "message_job",
    triggerJobId: jobUuid,
    status: "needs_setup",
    errorMessage: "수신자 연락처가 필요합니다.",
  } as unknown as MessageLogRecord;
  const prefix = "desktop_messages_test";

  it.each([
    { resentByLogId: null, retryBlockedByLogId: null },
    { resentByLogId: 8, retryBlockedByLogId: null },
    { resentByLogId: null, retryBlockedByLogId: 8 },
  ])("keeps the failure label unless resent and disables blocked logs (%j)", ({ resentByLogId, retryBlockedByLogId }) => {
    const isRetryBlocked = resentByLogId !== null || retryBlockedByLogId !== null;
    const onRetry = jest.fn();
    const { container } = render(
      <MessageHistoryDetailPanel
        selectedRecord={normalizeMessageHistoryRecord({ ...baseLog, resentByLogId, retryBlockedByLogId })}
        dataComponentPrefix={prefix}
        canRetry
        onRetry={onRetry}
      />,
    );
    const badge = container.querySelector(`[data-component="${prefix}_detail-status"]`);
    const avatar = container.querySelector(`[data-component="${prefix}_detail-avatar"]`);
    const avatarStatus = resentByLogId === null ? "failed" : "sent";
    expect(avatar).toHaveClass(...MESSAGE_HISTORY_STATUS_META[avatarStatus].avatarClass.split(" "));
    expect(avatar?.querySelector(".lucide-history")).toBeInTheDocument();
    expect(badge).toHaveTextContent(resentByLogId === null ? "발송 실패" : "재발송됨");
    expect(screen.getByText("실패 사유")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "재발송" });
    if (!isRetryBlocked) expect(button).toBeEnabled();
    else expect(button).toBeDisabled();
    expect(button.closest('[data-slot="hover-card-trigger"]')).toBeNull();
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(isRetryBlocked ? 0 : 1);
    if (resentByLogId !== null) {
      expect(badge?.className).toBe(cn(statusBadgeVariants({ variant: MESSAGE_LOG_STATUS_BADGE_VARIANT.sent, size: "sm" })));
    } else {
      expect(screen.queryByText("재발송됨")).not.toBeInTheDocument();
      expect(badge).not.toHaveClass("bg-status-success");
    }
  });

  it.each(["checking", "exhausted"])("prioritizes the resent label over history lookup %s", (historyLookup) => {
    const record = normalizeMessageHistoryRecord({ ...baseLog, resentByLogId: 8, variables: { historyLookup } });
    expect(record.detailStatusLabel).toBe("재발송됨");
    render(<MessageHistoryDetailPanel selectedRecord={record} dataComponentPrefix={prefix} />);
    expect(screen.getByText("재발송됨")).toBeInTheDocument();
    expect(screen.queryByText("확인 중")).not.toBeInTheDocument();
    expect(screen.queryByText("확인 필요")).not.toBeInTheDocument();
  });

  it("carries the trigger job id and the job-row flag through normalization", () => {
    const job = normalizeMessageHistoryRecord(needsSetupJobRow);
    expect(job.triggerJobId).toBe(jobUuid);
    expect(job.isTriggerJobRow).toBe(true);
    expect(job.setupReason).toBeTruthy();

    const log = normalizeMessageHistoryRecord(baseLog);
    expect(log.triggerJobId).toBeNull();
    expect(log.isTriggerJobRow).toBe(false);
  });

  it("shows the amber 추가 필요 정보 row and the 재발송 button for a needs_setup job", () => {
    const onRetry = jest.fn();
    const { container } = render(
      <MessageHistoryDetailPanel
        selectedRecord={normalizeMessageHistoryRecord(needsSetupJobRow)}
        dataComponentPrefix={prefix}
        canRetry
        onRetry={onRetry}
        retryPendingLabel="재발송 중"
      />,
    );

    expect(screen.getByText("추가 필요 정보")).toBeInTheDocument();
    const reason = screen.getByText(normalizeMessageHistoryRecord(needsSetupJobRow).setupReason as string);
    expect(reason).toHaveClass("text-amber-700");
    expect(reason).not.toHaveClass("text-red-700");
    expect(
      container.querySelector(`[data-component="${prefix}_detail-content_info-card_setup-reason"]`),
    ).toBeInTheDocument();
    expect(screen.queryByText("실패 사유")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "재발송" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses the pending label prop while a needs_setup job is being re-sent", () => {
    render(
      <MessageHistoryDetailPanel
        selectedRecord={normalizeMessageHistoryRecord(needsSetupJobRow)}
        dataComponentPrefix={prefix}
        canRetry
        isRetrying
        onRetry={jest.fn()}
        retryPendingLabel="재발송 중"
      />,
    );

    const button = screen.getByRole("button", { name: "재발송 중" });
    expect(button).toBeDisabled();
    expect(screen.queryByRole("button", { name: "재시도 중" })).not.toBeInTheDocument();
  });

  it("carries resendBlock through normalization for a needs_setup job only", () => {
    const blocked = normalizeMessageHistoryRecord({
      ...needsSetupJobRow,
      resendBlockedBy: "recipient",
      resendBlockedRecipient: { kind: "client", id: 10 },
    });
    expect(blocked.resendBlock).toMatchObject({
      level: "recipient",
      recipient: { kind: "client", id: 10 },
      recipientName: "김고객",
      ruleName: "제공기록지 링크",
    });
    expect(normalizeMessageHistoryRecord(needsSetupJobRow).resendBlock).toBeUndefined();
    expect(
      normalizeMessageHistoryRecord({ ...baseLog, resendBlockedBy: "branch" }).resendBlock,
    ).toBeUndefined();
  });

  describe("blocked 재발송", () => {
    const recipientBlock: MessageResendBlock = {
      level: "recipient",
      recipient: { kind: "employee", id: 7 },
      recipientName: "송진호",
      ruleId: "rule-1",
      ruleName: "제공기록지 링크",
    };

    beforeAll(() => {
      if (!("ResizeObserver" in globalThis)) {
        globalThis.ResizeObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        } as unknown as typeof ResizeObserver;
      }
    });

    it("keeps the button disabled, never retries on click, and shows no always-visible hint", () => {
      const onRetry = jest.fn();
      render(
        <MessageHistoryDetailPanel
          selectedRecord={normalizeMessageHistoryRecord(needsSetupJobRow)}
          dataComponentPrefix={prefix}
          canRetry
          onRetry={onRetry}
          retryBlock={recipientBlock}
        />,
      );

      const button = screen.getByRole("button", { name: "재발송" });
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute("data-disabled-reason");
      fireEvent.click(button);
      expect(onRetry).not.toHaveBeenCalled();
      expect(screen.queryByText("자동 문자가 꺼져 있어요")).not.toBeInTheDocument();
    });

    it("explains the block and links to where it is turned on once the wrapper is focused", async () => {
      render(
        <MessageHistoryDetailPanel
          selectedRecord={normalizeMessageHistoryRecord(needsSetupJobRow)}
          dataComponentPrefix={prefix}
          canRetry
          onRetry={jest.fn()}
          retryBlock={recipientBlock}
        />,
      );

      const wrapper = screen.getByRole("button", { name: "재발송" }).closest('[data-slot="hover-card-trigger"]');
      expect(wrapper).not.toBeNull();
      fireEvent.focus(wrapper as HTMLElement);

      expect(await screen.findByText("자동 문자가 꺼져 있어요")).toBeInTheDocument();
      const card = document.querySelector(`[data-component="${prefix}_detail-retry_blocked-hover-card"]`);
      expect(card).not.toBeNull();
      expect(card).toHaveTextContent("송진호 관리사의 ‘자동 문자 발송’이 꺼져 있어 재발송할 수 없어요.");
      expect(screen.getByRole("link", { name: "관리사 정보에서 켜기 →" })).toHaveAttribute("href", "/employees");
    });

    it("renders a plain enabled button, with no hover card wrapper, when nothing blocks the resend", () => {
      render(
        <MessageHistoryDetailPanel
          selectedRecord={normalizeMessageHistoryRecord(needsSetupJobRow)}
          dataComponentPrefix={prefix}
          canRetry
          onRetry={jest.fn()}
        />,
      );

      const button = screen.getByRole("button", { name: "재발송" });
      expect(button).toBeEnabled();
      expect(button.closest('[data-slot="hover-card-trigger"]')).toBeNull();
    });
  });

  it("shows no 추가 필요 정보 row for a failed log and keeps the old retry labels", () => {
    const failed = normalizeMessageHistoryRecord(baseLog);
    const { rerender } = render(
      <MessageHistoryDetailPanel
        selectedRecord={failed}
        dataComponentPrefix={prefix}
        canRetry
        onRetry={jest.fn()}
      />,
    );

    expect(screen.queryByText("추가 필요 정보")).not.toBeInTheDocument();
    expect(screen.getByText("실패 사유")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "재발송" })).toBeEnabled();

    rerender(
      <MessageHistoryDetailPanel
        selectedRecord={failed}
        dataComponentPrefix={prefix}
        canRetry
        isRetrying
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "재시도 중" })).toBeDisabled();
  });

  it("shows no retry button when retry is not allowed", () => {
    render(
      <MessageHistoryDetailPanel
        selectedRecord={normalizeMessageHistoryRecord(needsSetupJobRow)}
        dataComponentPrefix={prefix}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText("추가 필요 정보")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "재발송" })).not.toBeInTheDocument();
  });
});
