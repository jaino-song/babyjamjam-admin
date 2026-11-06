import type {
  MessageAutomationPolicy,
  MessageAutomationPolicyConfiguration,
  MessageAutomationPolicyRow,
  MessageSettingsPolicyId,
  MessageSenderApprovalResponse,
} from "@babyjamjam/shared/types/message";
import {
  Building2,
  CalendarClock,
  History,
  Moon,
  Repeat2,
  ShieldCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

export const QUIET_HOURS_POLICY_ITEM_ID = "quiet-hours";
export const DUPLICATE_SEND_POLICY_ITEM_ID = "duplicate-send-confirmation";
export const CLIENT_REGISTRATION_POLICY_ITEM_ID = "client-registration-policy";
export const TENANT_APPLICATION_ITEM_ID = "current-tenant";

const SERVICE_RECORD_LINK_POLICY_ID = "service-feedback-link";
const PAST_TRIGGER_POLICY_ID = "past-trigger";
const SMS_RETRY_POLICY_ID = "sms-retry";

export const DUPLICATE_SEND_ROWS: MessageAutomationPolicyRow[] = [
  { id: "condition", label: "조건", value: "같은 번호 · 같은 메시지" },
  { id: "window", label: "확인 범위", value: "확인 불가" },
  { id: "behavior", label: "동작", value: "전송 전 확인 모달" },
];

export type SettingsListItem = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  icon: LucideIcon;
  kind:
    | "tenant-application"
    | "automation-policy"
    | "duplicate-send-policy"
    | "client-registration-policy";
  active: boolean;
  disabled?: boolean;
  unavailable?: boolean;
  requiresApproval: boolean;
  rows?: MessageAutomationPolicyRow[];
};

export function getAutomationPolicyIcon(policyId: string): LucideIcon {
  if (policyId === SERVICE_RECORD_LINK_POLICY_ID) return CalendarClock;
  if (policyId === PAST_TRIGGER_POLICY_ID) return History;
  if (policyId === SMS_RETRY_POLICY_ID) return Repeat2;
  return ShieldCheck;
}

function getPolicyStatusLabel(active: boolean): string {
  return active ? "활성" : "비활성";
}

function formatRequestedAt(requestedAt: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(requestedAt));
}

function canonicalTimingRows(policyId: string, configuration: MessageAutomationPolicyConfiguration | undefined): MessageAutomationPolicyRow[] {
  const count = (value: number | undefined, unit: string) => value === undefined ? "확인 불가" : Number.isFinite(value) ? `${value}${unit}` : "입력 확인 필요";
  const time = configuration?.defaultRuleSendTime;
  switch (policyId) {
    case "trigger-dispatch": return [
      { id: "dispatch-interval", label: "실행 주기", value: count(configuration?.dispatchCheckIntervalMinutes, "분마다") },
      { id: "duplicate-window", label: "중복 확인 기간", value: count(configuration?.duplicateWindowHours, "시간") },
      { id: "send-time", label: "발송 시각", value: time === undefined ? "확인 불가" : time ? `규칙별 설정 (기본 ${time} 한국 시간)` : "입력 확인 필요" },
    ];
    case "trigger-job-retry": return [
      { id: "retry-delay", label: "일시 오류 재시도", value: count(configuration?.triggerRetryIntervalMinutes, "분 후") },
      { id: "processing-reclaim", label: "처리중 작업 회수", value: count(configuration?.processingReclaimMinutes, "분 후") },
    ];
    case "sms-retry": return [{ id: "retry-delay", label: "재시도 간격", value: count(configuration?.smsRetryIntervalMinutes, "분 후") }];
    case "past-trigger": return [
      { id: "grace-window", label: "기존 발송 만료 기준", value: configuration ? `예정 시각 후 ${count(configuration.pastExpiryHours, "시간")}` : "확인 불가" },
      { id: "catch-up-interval", label: "보충 발송 간격", value: count(configuration?.pastSendIntervalMinutes, "분") },
    ];
    default: return [];
  }
}

function withCanonicalTimingRows(policy: MessageAutomationPolicy, configuration: MessageAutomationPolicyConfiguration | undefined): MessageAutomationPolicyRow[] {
  const canonical = canonicalTimingRows(policy.id, configuration);
  if (canonical.length === 0) return policy.rows;
  // Current backend row ids are stable; remove earlier display aliases rather
  // than leaving a second, stale timing value beside the canonical one.
  const aliases = policy.id === "trigger-dispatch" ? ["interval", "schedule"] : ["interval"];
  const rows = policy.rows.filter((row) => !aliases.includes(row.id)).map((row) => canonical.find((current) => current.id === row.id) ?? row);
  const ids = new Set(rows.map((row) => row.id));
  return [...rows, ...canonical.filter((row) => !ids.has(row.id))];
}

export function buildSettingsListItems({
  approval,
  policies,
  clientAutoRegistration = false,
  policyActivations,
  configuration,
  canWriteConfiguration,
}: {
  approval: MessageSenderApprovalResponse | undefined;
  policies: MessageAutomationPolicy[] | undefined;
  clientAutoRegistration?: boolean;
  configuration?: MessageAutomationPolicyConfiguration;
  canWriteConfiguration?: boolean;
  policyActivations?: Partial<Record<MessageSettingsPolicyId, boolean>>;
}): SettingsListItem[] {
  const items: SettingsListItem[] = [];

  if (approval && !approval.isApproved) {
    items.push({
      id: TENANT_APPLICATION_ITEM_ID,
      title: "메시지 발송 기능 신청",
      subtitle: approval.requestedAt
        ? `신청 접수 ${formatRequestedAt(approval.requestedAt)}`
        : "알리고 정책 동의 후 신청해 주세요.",
      statusLabel: approval.requestedAt ? "접수됨" : "작성 중",
      icon: Building2,
      kind: "tenant-application",
      active: true,
      requiresApproval: true,
    });
  }

  for (const policy of policies ?? []) {
    const timing = canonicalTimingRows(policy.id, configuration);
    const timingSummary = timing.length === 0 ? "" : configuration ? timing.map((row) => `${row.label} ${row.value}`).join(" · ") : "설정값 확인 불가";
    items.push({
      id: policy.id,
      title: policy.title,
      subtitle: timingSummary ? `${policy.description} · ${timingSummary}` : policy.description,
      statusLabel: getPolicyStatusLabel(policy.active),
      icon: getAutomationPolicyIcon(policy.id),
      kind: "automation-policy",
      active: policy.active,
      requiresApproval: policy.requiresApproval,
      rows: withCanonicalTimingRows(policy, configuration),
    });
  }

  items.push(
    {
      id: CLIENT_REGISTRATION_POLICY_ITEM_ID,
      title: "고객 자동 등록",
      subtitle: "전자문서 고객 등록과 인사 문자 발송을 관리합니다.",
      statusLabel: getPolicyStatusLabel(clientAutoRegistration),
      icon: UserPlus,
      kind: "client-registration-policy",
      active: clientAutoRegistration,
      requiresApproval: false,
    },
    {
      id: DUPLICATE_SEND_POLICY_ITEM_ID,
      title: "중복 전송 확인",
      subtitle: configuration ? Number.isFinite(configuration.duplicateWindowHours) ? `${configuration.duplicateWindowHours}시간 내 같은 번호와 같은 메시지는 전송 전 확인합니다.` : "중복 전송 확인 범위를 입력해 주세요." : "같은 번호와 같은 메시지는 전송 전 확인합니다. 확인 범위를 불러올 수 없습니다.",
      statusLabel: getPolicyStatusLabel(
        policyActivations?.[DUPLICATE_SEND_POLICY_ITEM_ID] ?? true,
      ),
      icon: Repeat2,
      kind: "duplicate-send-policy",
      active: policyActivations?.[DUPLICATE_SEND_POLICY_ITEM_ID] ?? true,
      requiresApproval: true,
      rows: DUPLICATE_SEND_ROWS.map((row) => row.id === "window" ? { ...row, value: configuration ? Number.isFinite(configuration.duplicateWindowHours) ? `최근 ${configuration.duplicateWindowHours}시간` : "입력 확인 필요" : "확인 불가" } : row),
    },
  );

  const quiet = configuration?.quietHours;
  const quietGroups = quiet?.recipientGroups.map((group) => ({ CLIENT: "고객", CAREGIVER: "제공인력", STAFF: "직원" })[group]).join(" · ");
  const quietAction = quiet?.action === "CANCEL" ? "전송 취소" : "금지 시간 이후 전송";
  const quietRows: MessageAutomationPolicyRow[] = quiet ? [
    { id: "channel", label: "채널", value: "SMS/LMS" },
    { id: "enabled", label: "상태", value: getPolicyStatusLabel(quiet.enabled) },
    { id: "time", label: "금지 시간", value: `${quiet.start || "입력 확인 필요"}~${quiet.end || "입력 확인 필요"} (한국 시간)` },
    { id: "groups", label: "대상", value: quietGroups || "선택된 대상 없음" },
    { id: "action", label: "처리", value: quietAction },
  ] : [{ id: "configuration", label: "설정", value: "확인 불가" }];
  items.push({
    id: QUIET_HOURS_POLICY_ITEM_ID,
    title: "심야 시간 메세지 전송 금지",
    subtitle: quiet ? `SMS/LMS · ${getPolicyStatusLabel(quiet.enabled)} · ${quiet.start || "입력 확인 필요"}~${quiet.end || "입력 확인 필요"} (한국 시간) · ${quietGroups || "선택된 대상 없음"} · ${quietAction}` : "SMS/LMS 전송 금지 설정을 불러올 수 없습니다.",
    statusLabel: quiet === undefined ? "확인 불가" : getPolicyStatusLabel(quiet.enabled),
    icon: Moon,
    kind: "automation-policy",
    active: quiet?.enabled === true,
    unavailable: quiet === undefined,
    rows: quietRows,
    disabled: canWriteConfiguration === false,
    requiresApproval: false,
  });
  return items;
}

export function getOrderedTriggerRules<TRule extends { id: string }>(
  rules: TRule[],
  orderIds: string[],
): TRule[] {
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const ordered = orderIds
    .map((id) => rulesById.get(id))
    .filter((rule): rule is TRule => Boolean(rule));
  const orderedIds = new Set(ordered.map((rule) => rule.id));
  const missing = rules.filter((rule) => !orderedIds.has(rule.id));

  return [...ordered, ...missing];
}
