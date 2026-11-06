import type {
  MessageAutomationPolicy,
  MessageAutomationPolicyConfiguration,
  MessageSenderApprovalResponse,
} from "@babyjamjam/shared/types/message";
import {
  Building2,
  CalendarClock,
  History,
  Repeat2,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import {
  buildSettingsListItems,
  CLIENT_REGISTRATION_POLICY_ITEM_ID,
  DUPLICATE_SEND_POLICY_ITEM_ID,
  DUPLICATE_SEND_ROWS,
  getAutomationPolicyIcon,
  getOrderedTriggerRules,
  TENANT_APPLICATION_ITEM_ID,
  QUIET_HOURS_POLICY_ITEM_ID,
} from "../settings-items";

const unapproved: MessageSenderApprovalResponse = {
  approvalStatus: "not_requested",
  isApproved: false,
  canRequest: true,
  requestedAt: null,
  approvedAt: null,
};

const approved: MessageSenderApprovalResponse = {
  ...unapproved,
  approvalStatus: "approved",
  isApproved: true,
};

const policies: MessageAutomationPolicy[] = [
  {
    id: "service-feedback-link",
    title: "제공기록지 링크",
    description: "서비스 종료 후 링크를 전송합니다.",
    active: true,
    requiresApproval: true,
    rows: [{ id: "timing", label: "시점", value: "서비스 종료 후" }],
  },
  {
    id: "custom-policy",
    title: "기타 정책",
    description: "기타 자동화 정책입니다.",
    active: false,
    requiresApproval: false,
    rows: [],
  },
];

const configuration: MessageAutomationPolicyConfiguration = {
  schemaVersion: 1, dispatchCheckIntervalMinutes: 7, defaultRuleSendTime: "10:10", triggerRetryIntervalMinutes: 7, processingReclaimMinutes: 10, smsRetryIntervalMinutes: 7,
  pastExpiryHours: 96, pastSendIntervalMinutes: 7, pastRuleOrder: [], duplicateWindowHours: 96,
  quietHours: { enabled: true, start: "22:30", end: "07:10", recipientGroups: ["CLIENT", "CAREGIVER", "STAFF"], action: "CANCEL", timezone: "Asia/Seoul" },
};

describe("buildSettingsListItems", () => {
  it("includes the tenant application only for a known unapproved state", () => {
    const unapprovedItems = buildSettingsListItems({ approval: unapproved, policies: [] });
    const approvedItems = buildSettingsListItems({ approval: approved, policies: [] });
    const unknownItems = buildSettingsListItems({ approval: undefined, policies: [] });

    expect(unapprovedItems[0]).toMatchObject({
      id: TENANT_APPLICATION_ITEM_ID,
      title: "메시지 발송 기능 신청",
      subtitle: "알리고 정책 동의 후 신청해 주세요.",
      statusLabel: "작성 중",
      icon: Building2,
      kind: "tenant-application",
    });
    expect(approvedItems.some((item) => item.id === TENANT_APPLICATION_ITEM_ID)).toBe(false);
    expect(unknownItems.some((item) => item.id === TENANT_APPLICATION_ITEM_ID)).toBe(false);
  });

  it("keeps API policy order before client registration and duplicate-send items", () => {
    const items = buildSettingsListItems({
      approval: unapproved,
      policies,
      clientAutoRegistration: false,
      policyActivations: { "duplicate-send-confirmation": false },
    });

    expect(items.map((item) => item.id)).toEqual([
      TENANT_APPLICATION_ITEM_ID,
      "service-feedback-link",
      "custom-policy",
      CLIENT_REGISTRATION_POLICY_ITEM_ID,
      DUPLICATE_SEND_POLICY_ITEM_ID,
      QUIET_HOURS_POLICY_ITEM_ID,
    ]);
    expect(items[1]).toMatchObject({
      title: policies[0].title,
      subtitle: policies[0].description,
      active: true,
      statusLabel: "활성",
      requiresApproval: true,
      rows: policies[0].rows,
    });
    expect(items[3]).toMatchObject({
      title: "고객 자동 등록",
      icon: UserPlus,
      active: false,
      statusLabel: "비활성",
    });
    expect(items[4]).toMatchObject({
      title: "중복 전송 확인",
      icon: Repeat2,
      active: false,
      statusLabel: "비활성",
      rows: DUPLICATE_SEND_ROWS,
    });
  });
  it.each<[string, string[]]>([
    ["trigger-dispatch", ["7분마다", "96시간", "규칙별 설정 (기본 10:10 한국 시간)"]],
    ["trigger-job-retry", ["7분 후", "10분 후"]],
    ["sms-retry", ["7분 후"]],
    ["past-trigger", ["예정 시각 후 96시간", "7분"]],
  ])("derives every editable timing row and summary for %s from canonical values", (id, values) => {
    const policy: MessageAutomationPolicy = { id, title: id, description: "유지할 설명", active: true, requiresApproval: true, rows: [{ id: "max-attempts", label: "최대 시도 횟수", value: "최대 3회" }, ...["dispatch-interval", "duplicate-window", "send-time", "retry-delay", "processing-reclaim", "grace-window", "catch-up-interval"].map((rowId) => ({ id: rowId, label: rowId, value: "오래된 값" }))] };
    const item = buildSettingsListItems({ approval: approved, policies: [policy], configuration }).find((item) => item.id === id);
    expect(item?.subtitle).toContain("유지할 설명");
    expect(item?.rows).toContainEqual({ id: "max-attempts", label: "최대 시도 횟수", value: "최대 3회" });
    expect(item).toMatchObject({ active: true, requiresApproval: true });
    for (const value of values) {
      expect(item?.rows?.some((row) => row.value === value)).toBe(true);
      expect(item?.subtitle).toContain(value);
    }
  });

  it("uses the96hour canonical duplicate window and current quiet policy", () => {
    const items = buildSettingsListItems({ approval: approved, policies: [], configuration });
    const duplicate = items.find((item) => item.id === DUPLICATE_SEND_POLICY_ITEM_ID);
    expect(duplicate?.subtitle).toBe("96시간 내 같은 번호와 같은 메시지는 전송 전 확인합니다.");
    expect(duplicate?.rows).toContainEqual({ id: "window", label: "확인 범위", value: "최근 96시간" });
    const quiet = items.find((item) => item.id === QUIET_HOURS_POLICY_ITEM_ID);
    expect(quiet).toMatchObject({ active: true, statusLabel: "활성", unavailable: false });
    expect(quiet?.subtitle).toContain("22:30~07:10 (한국 시간)");
    expect(quiet?.subtitle).toContain("고객 · 제공인력 · 직원");
    expect(quiet?.subtitle).toContain("전송 취소");
    expect(quiet?.rows).toContainEqual({ id: "time", label: "금지 시간", value: "22:30~07:10 (한국 시간)" });
    expect(quiet?.rows).toContainEqual({ id: "action", label: "처리", value: "전송 취소" });
  });

  it("never invents a72hour or stale timing fallback when canonical configuration is unavailable", () => {
    const item = buildSettingsListItems({ approval: approved, policies: [{ id: "trigger-dispatch", title: "실행", description: "승인된 자동 전송", active: true, requiresApproval: true, rows: [{ id: "dispatch-interval", label: "실행 주기", value: "5분마다" }, { id: "duplicate-window", label: "중복 확인 기간", value: "72시간" }] }] });
    const display = JSON.stringify(item);
    expect(display).not.toContain("72시간");
    expect(display).not.toContain("5분마다");
    expect(item[0].rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: "dispatch-interval", value: "확인 불가" }), expect.objectContaining({ id: "duplicate-window", value: "확인 불가" })]));
    expect(item.find((row) => row.id === DUPLICATE_SEND_POLICY_ITEM_ID)?.subtitle).toContain("불러올 수 없습니다");
    expect(item.find((row) => row.id === QUIET_HOURS_POLICY_ITEM_ID)).toMatchObject({ unavailable: true, statusLabel: "확인 불가" });
  });

});

describe("getAutomationPolicyIcon", () => {
  it.each([
    ["service-feedback-link", CalendarClock],
    ["past-trigger", History],
    ["sms-retry", Repeat2],
    ["unknown-policy", ShieldCheck],
  ])("maps %s to the expected icon", (policyId, expectedIcon) => {
    expect(getAutomationPolicyIcon(policyId)).toBe(expectedIcon);
  });
});

describe("getOrderedTriggerRules", () => {
  it("orders known ids first, ignores stale ids, and appends missing rules", () => {
    const rules = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];

    expect(getOrderedTriggerRules(rules, ["stale", "c", "a", "missing"])).toEqual([
      rules[2],
      rules[0],
      rules[1],
    ]);
  });
});
