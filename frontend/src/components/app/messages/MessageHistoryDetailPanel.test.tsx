import fs from "node:fs";
import { render, screen } from "@testing-library/react";
import type { MessageLogRecord } from "@babyjamjam/shared/types/message";

import {
  MessageHistoryDetailPanel,
  MESSAGE_HISTORY_STATUS_META,
  normalizeMessageHistoryRecord,
} from "./MessageHistoryDetailPanel";

const source = fs.readFileSync(require.resolve("./MessageHistoryDetailPanel"), "utf8");

describe("MessageHistoryDetailPanel delivery status labels", () => {
  it("carries the shared lookup label through normalization into the detail badge only", () => {
    expect(source).toContain("detailStatusLabel: getMessageHistoryDetailStatusLabel(record)");
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

  it("has list-badge metadata so a 설정 필요 row cannot render an empty badge", () => {
    expect(MESSAGE_HISTORY_STATUS_META.needs_setup.label).toBe("설정 필요");
    expect(MESSAGE_HISTORY_STATUS_META.needs_setup.icon).toBeDefined();
  });

  it("renders 설정 필요 in the detail panel instead of throwing", () => {
    const selectedRecord = normalizeMessageHistoryRecord(needsSetupRecord);

    render(
      <MessageHistoryDetailPanel
        selectedRecord={selectedRecord}
        dataComponentPrefix="desktop_messages_test"
      />,
    );

    expect(screen.getAllByText("설정 필요").length).toBeGreaterThan(0);
  });
});
