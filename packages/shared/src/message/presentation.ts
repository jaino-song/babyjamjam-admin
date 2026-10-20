import {
  SMS_TRIGGER_TEMPLATE_KEYS,
  type MessageLogRecord,
  type MessageResendBlockedBy,
  type MessageResendBlockedRecipient,
  type MessageLogStatus,
  type MessageTriggerEventType,
  type MessageTriggerJobStatus,
  type MessageTriggerRecipientType,
  type MessageTriggerTemplateKey,
} from "../types/message";

export type MessageSectionId =
  | "send"
  | "scheduled"
  | "history"
  | "templates"
  | "triggers"
  | "settings";

// "scheduled" (발송 예정) is intentionally omitted here — its content is being
// folded into 발송 기록 by a follow-up task. MessageSectionId keeps the
// "scheduled" member so existing UNRELEASED_SECTION_IDS sets and route-path
// checks in both apps keep compiling; only the nav entry is gone for now.
export const MESSAGE_SECTION_DEFINITIONS = [
  { id: "send", label: "전송하기", mobilePath: "/messages/new" },
  { id: "history", label: "발송 기록", mobilePath: "/messages/history" },
  { id: "templates", label: "템플릿", mobilePath: "/messages/templates" },
  { id: "triggers", label: "자동 전송", mobilePath: "/messages/automation" },
  { id: "settings", label: "설정", mobilePath: "/messages/settings" },
] as const satisfies ReadonlyArray<{
  id: MessageSectionId;
  label: string;
  mobilePath: `/messages/${string}`;
}>;

export const MESSAGE_TEMPLATE_LABELS: Readonly<Record<string, string>> = {
  CLIENT_WELCOME: "고객 등록 안내",
  SERVICE_START_REMINDER: "서비스 시작 알림",
  SERVICE_INFO: "서비스 안내",
  SERVICE_END_REMINDER: "서비스 종료 알림",
  EMPLOYEE_ASSIGNED: "직원 배정 알림",
  SERVICE_RECORD_LINK: "제공기록지 작성 링크",
  CLIENT_GREETING: "인사 메시지",
  PRICE_INFO: "비용 안내",
  REMINDER: "리마인드",
  THANKS: "예약 완료(입금 확인)",
  SURVEY: "모니터링 설문",
  INFO: "정보 요청",
  GREETING: "인사 메시지",
  SERVICE_END_NOTICE: "서비스 종료 안내",
  service_record_link_sms: "제공기록지 작성 링크",
  client_greeting_sms: "인사 메시지",
  service_end_notice_sms: "서비스 종료 안내",
  manual_sms: "수동 메시지",
  "인사(소개)": "인사 메시지",
};

export const MESSAGE_HISTORY_STATUS_LABELS: Readonly<Record<MessageLogStatus, string>> = {
  sent: "발송 성공",
  failed: "발송 실패",
  pending: "재시도 대기",
  canceled: "발송 취소",
  needs_setup: "추가 정보 필요",
};

/** Detail-only provider-history state; list badges retain the stored status. */
export function getMessageHistoryDetailStatusLabel(record: {
  status: string;
  variables?: Record<string, unknown> | null;
}): string {
  if (record.status !== "sent") {
    if (record.variables?.["historyLookup"] === "checking") return "확인 중";
    if (record.variables?.["historyLookup"] === "exhausted") return "확인 필요";
  }
  switch (record.status) {
    case "sent":
    case "failed":
    case "pending":
    case "canceled":
    case "needs_setup":
      return MESSAGE_HISTORY_STATUS_LABELS[record.status];
    default:
      return record.status || "-";
  }
}

export const MESSAGE_JOB_STATUS_LABELS: Readonly<Record<MessageTriggerJobStatus, string>> = {
  pending: "발송 대기",
  processing: "발송 중",
  dispatching: "발송 중",
  sent: "발송 완료",
  failed: "발송 실패",
  canceled: "발송 취소",
  needs_setup: "추가 정보 필요",
};

// Single source of truth for message-status -> StatusBadge variant. Both
// apps' StatusBadge already wires these variants to the shared `--status-*`
// design tokens, so consumers should read these maps instead of hand-rolling
// Tailwind palette classes (e.g. `bg-emerald-50`, `bg-slate-100`) per status.
export type MessageStatusBadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

export const MESSAGE_LOG_STATUS_BADGE_VARIANT: Readonly<Record<MessageLogStatus, MessageStatusBadgeVariant>> = {
  sent: "success",
  failed: "danger",
  pending: "warning",
  canceled: "neutral",
  needs_setup: "warning",
};

export const MESSAGE_JOB_STATUS_BADGE_VARIANT: Readonly<Record<MessageTriggerJobStatus, MessageStatusBadgeVariant>> = {
  pending: "warning",
  processing: "info",
  dispatching: "info",
  sent: "success",
  failed: "danger",
  canceled: "neutral",
  needs_setup: "warning",
};

// Copy for the merged 발송 기록 screen, which shows upcoming sends and past
// sends as two zones of one list. Both apps read these so the two screens
// cannot drift apart in wording — the split copy in the old separate screens
// is exactly how they diverged before.
export const MESSAGE_RECORD_ZONE_LABELS = {
  upcoming: "예정",
  past: "지난 발송",
} as const;

export type MessageRecordStatusFilter = "all" | "upcoming" | "sent" | "failed" | "canceled";

// The past-status tab labels (sent/failed/canceled) deliberately reuse
// MESSAGE_HISTORY_STATUS_LABELS above, the same copy shown on each row's
// status badge, so the tabs and the badges cannot drift apart in wording.
export const MESSAGE_RECORD_STATUS_FILTER_LABELS: Readonly<Record<MessageRecordStatusFilter, string>> = {
  all: "전체",
  upcoming: "예정",
  sent: MESSAGE_HISTORY_STATUS_LABELS.sent,
  failed: MESSAGE_HISTORY_STATUS_LABELS.failed,
  canceled: MESSAGE_HISTORY_STATUS_LABELS.canceled,
};

// A user-pressed cancel is permanent: the backend marks it so the re-sync that
// runs on any client or rule edit will not put the message back on the
// schedule. The confirm copy says so, because "취소" alone reads as reversible.
export const MESSAGE_JOB_CANCEL_COPY = {
  action: "발송 취소",
  confirmTitle: "예정된 발송을 취소할까요?",
  confirmBody:
    "취소하면 이 메시지는 자동으로 발송되지 않습니다. 고객 정보를 수정해도 다시 예약되지 않습니다.",
  confirmAction: "발송 취소",
  dismiss: "닫기",
  success: "예정된 발송을 취소했습니다.",
  failure: "이미 발송되었거나 취소할 수 없는 상태예요.",
} as const;

export const MESSAGE_RECORD_REASON_LABEL = "사유";

/** Reason label for a `needs_setup` row, where "사유" alone reads as a failure. */
export const MESSAGE_SETUP_REASON_LABEL = "추가 필요 정보";

// Copy for re-sending a `needs_setup` job after the operator fixed the setup.
export const MESSAGE_JOB_RESEND_COPY = {
  action: "재발송",
  pending: "재발송 중",
  success: "재발송했습니다.",
  stillNeedsSetup: "아직 추가 정보가 필요합니다. 사유를 확인해 주세요.",
  notSent: "재발송하지 않았습니다.",
  conflict: "지금은 재발송할 수 없습니다. 자동 전송 설정과 받는 사람의 자동 문자 설정을 확인해 주세요.",
  failure: "재발송하지 못했습니다. 잠시 후 다시 시도해 주세요.",
} as const;

/**
 * Why the 재발송 button is disabled on a `needs_setup` job: the server would
 * refuse the resend at this SMS automation safeguard level. Everything the
 * hover card needs to say which switch is off and to point at it.
 */
export interface MessageResendBlock {
  level: MessageResendBlockedBy;
  /** Set for a `recipient` block when the server named the entity. */
  recipient: MessageResendBlockedRecipient | null;
  /** The recipient's display name, null when the row has none. */
  recipientName: string | null;
  ruleId: string | null;
  ruleName: string | null;
}

export type MessageResendBlockPlatform = "desktop" | "mobile";

export interface MessageResendBlockCard {
  title: string;
  /** Bold lead of the description (a person or rule name), when there is one. */
  emphasis: string | null;
  /** The rest of the description, after `emphasis`. */
  description: string;
  /** Where the admin can turn it back on; null when no screen is sensible. */
  action: { label: string; href: string } | null;
}

const MESSAGE_RESEND_BLOCK_RECIPIENT_NOUN = {
  client: "고객",
  employee: "관리사",
  user: "사용자",
} as const satisfies Record<MessageResendBlockedRecipient["kind"], string>;

const MESSAGE_RESEND_BLOCK_RECIPIENT_ACTION_LABEL = {
  client: "고객 정보에서 켜기 →",
  employee: "관리사 정보에서 켜기 →",
  user: "계정 관리에서 켜기 →",
} as const satisfies Record<MessageResendBlockedRecipient["kind"], string>;

export interface MessageResendBlockCardOptions {
  /** Only an owner can open /system-admin; for anyone else a user recipient gets no link. */
  canOpenOwnerAdmin: boolean;
}

function messageResendBlockRecipientHref(
  recipient: MessageResendBlockedRecipient,
  platform: MessageResendBlockPlatform,
): string {
  switch (recipient.kind) {
    case "client":
      return `/clients?id=${encodeURIComponent(String(recipient.id))}`;
    case "employee":
      // Neither app deep-links to one employee; the list is where the switch lives.
      return "/employees";
    case "user":
      return platform === "mobile"
        ? `/system-admin?section=accounts&item=${encodeURIComponent(recipient.id)}`
        : "/system-admin?section=accounts";
  }
}

/** Copy and link of the hover card on a disabled 재발송 button, per safeguard level. */
export function getMessageResendBlockCard(
  block: MessageResendBlock,
  platform: MessageResendBlockPlatform,
  options: MessageResendBlockCardOptions = { canOpenOwnerAdmin: false },
): MessageResendBlockCard {
  if (block.level === "branch") {
    return {
      title: "지점 자동 전송이 꺼져 있어요",
      emphasis: null,
      description: "이 지점의 ‘자동 전송 실행’이 꺼져 있어 재발송할 수 없어요.",
      action: {
        label: "자동화 설정 열기 →",
        href: platform === "mobile" ? "/messages/settings?item=trigger-dispatch" : "/messages?section=settings",
      },
    };
  }

  if (block.level === "rule") {
    const ruleName = block.ruleName?.trim() || null;
    const ruleHref = platform === "mobile"
      ? (block.ruleId ? `/messages/automation?item=${encodeURIComponent(block.ruleId)}` : "/messages/automation")
      : "/messages?section=triggers";
    return {
      title: "자동화 규칙이 꺼져 있어요",
      emphasis: ruleName,
      description: ruleName
        ? "규칙이 꺼져 있어 재발송할 수 없어요."
        : "자동화 규칙이 꺼져 있어 재발송할 수 없어요.",
      action: { label: "규칙 보기 →", href: ruleHref },
    };
  }

  const kind = block.recipient?.kind ?? null;
  const noun = kind ? MESSAGE_RESEND_BLOCK_RECIPIENT_NOUN[kind] : null;
  const name = block.recipientName?.trim() || null;
  return {
    title: "자동 문자가 꺼져 있어요",
    emphasis: name,
    description: name
      ? `${noun ? `${noun}의` : "님의"} ‘자동 문자 발송’이 꺼져 있어 재발송할 수 없어요.`
      : `받는 ${noun ?? "사람"}의 ‘자동 문자 발송’이 꺼져 있어 재발송할 수 없어요.`,
    action: block.recipient && kind && (kind !== "user" || options.canOpenOwnerAdmin)
      ? {
        label: MESSAGE_RESEND_BLOCK_RECIPIENT_ACTION_LABEL[kind],
        href: messageResendBlockRecipientHref(block.recipient, platform),
      }
      : null,
  };
}

export const MESSAGE_EVENT_LABELS: Readonly<Record<MessageTriggerEventType, string>> = {
  CLIENT_CREATED: "고객 등록",
  SERVICE_START: "서비스 시작",
  SERVICE_END: "서비스 종료",
  EMPLOYEE_ASSIGNED: "직원 배정",
};

export const MESSAGE_RECIPIENT_LABELS: Readonly<Record<MessageTriggerRecipientType, string>> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "주 담당 직원",
  SECONDARY_EMPLOYEE: "보조 직원",
};

const SMS_HISTORY_PROVIDERS = new Set(["aligo_sms", "sms"]);
const SMS_DELIVERY_TEMPLATE_KEYS = new Set(["service_record_link_sms", "client_greeting_sms", "service_end_notice_sms"]);
const INTERNAL_KEY_PATTERN = /^[a-z0-9_-]+$/i;

function getVariableValue(variables: Record<string, string> | undefined, key: string): string | null {
  const value = variables?.[key]?.trim();
  return value ? value : null;
}

function getKnownTemplateLabel(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  return MESSAGE_TEMPLATE_LABELS[normalized]
    ?? MESSAGE_TEMPLATE_LABELS[normalized.toUpperCase()]
    ?? null;
}

function getHumanFacingFallback(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || INTERNAL_KEY_PATTERN.test(normalized)) return null;
  return normalized;
}

export function getMessageTemplateLabel(
  templateKey: string,
  variables?: Record<string, string>,
): string {
  const directLabel = getKnownTemplateLabel(templateKey);
  if (directLabel) return directLabel;

  const systemTemplateLabel = getKnownTemplateLabel(getVariableValue(variables, "systemTemplateKey"));
  if (systemTemplateLabel) return systemTemplateLabel;

  const variableTitle = getVariableValue(variables, "title");
  return getKnownTemplateLabel(variableTitle)
    ?? getHumanFacingFallback(variableTitle)
    ?? "메시지";
}

export function getMessageHistoryTitle(input: {
  templateKey: string;
  variables?: Record<string, string>;
  ruleName?: string | null;
}): string {
  const templateLabel = getMessageTemplateLabel(input.templateKey, input.variables);
  const ruleName = input.ruleName?.trim();
  const normalizedRuleLabel = getKnownTemplateLabel(ruleName);

  if (normalizedRuleLabel) return normalizedRuleLabel;

  if (ruleName && ruleName !== input.templateKey) {
    return getHumanFacingFallback(ruleName) ?? templateLabel;
  }

  return templateLabel;
}

export function isSmsTriggerTemplate(templateKey: string | null | undefined): boolean {
  if (!templateKey) return false;

  return SMS_TRIGGER_TEMPLATE_KEYS.includes(templateKey as MessageTriggerTemplateKey)
    || SMS_DELIVERY_TEMPLATE_KEYS.has(templateKey);
}

export function isSmsHistoryProvider(provider: string | null | undefined): boolean {
  return provider ? SMS_HISTORY_PROVIDERS.has(provider) : false;
}

export function isSmsHistoryRecord(record: MessageLogRecord): boolean {
  return isSmsHistoryProvider(record.provider) || isSmsTriggerTemplate(record.templateKey);
}

export type MessageChannel = "sms";

export function isHistoryRecordInChannel(
  record: MessageLogRecord,
  channel: MessageChannel,
): boolean {
  const isSmsRecord = isSmsHistoryRecord(record);
  return channel === "sms" && isSmsRecord;
}

export function getMessageChannelLabel(provider: string | null | undefined): string {
  if (isSmsHistoryProvider(provider)) return "메시지";
  return "메시지";
}

export function getMessageHistoryTimestamp(record: {
  createdAt: string;
  lastAttemptAt?: string | null;
  updatedAt?: string | null;
}): string {
  return record.lastAttemptAt ?? record.updatedAt ?? record.createdAt;
}

export function formatMessageDateTimeCompact(dateString: string | null): string {
  if (!dateString) return "-";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMessageDateTimeDetail(dateString: string | null): string {
  if (!dateString) return "-";

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const CARRIER_FAILURE_REASON_PREFIX = "통신사 전달 실패:";

export function formatMessageFailureReason(reason: string | null | undefined): string {
  if (!reason) return "";

  const permanentFailure = reason.trim().startsWith("발송 실패:");
  const body = permanentFailure ? reason.trim().slice("발송 실패:".length) : reason;

  // Carrier-check failures ("통신사 전달 실패: 1234 가입자없음, 5678 결번") carry the
  // last four digits of the receiver; keep digits, colon and commas for them.
  const keepPattern = body.trimStart().startsWith(CARRIER_FAILURE_REASON_PREFIX)
    ? /[^\uAC00-\uD7A3\u3131-\u318E\s.0-9:,]/g
    : /[^\uAC00-\uD7A3\u3131-\u318E\s.]/g;

  const sanitizedReason = body
    .replace(keepPattern, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
  return permanentFailure && sanitizedReason ? `발송 실패: ${sanitizedReason}` : sanitizedReason;
}

export interface NormalizeMessageHistoryPresentationOptions {
  recipientNameFallback?: string | null;
  recipientListLabelFallback?: string | null;
}

export const MESSAGE_RESENT_LABEL = "재발송됨";

export interface NormalizedMessageHistoryPresentation {
  isResent: boolean;
  id: number | string;
  title: string;
  templateLabel: string;
  recipientName: string;
  recipientPhone: string;
  recipientListLabel: string;
  channelLabel: string;
  sentAt: string;
  status: MessageLogStatus;
  messagePreview: string;
  failureReason?: string;
  /** Why a `needs_setup` row cannot be sent; `failureReason` stays unset for it. */
  setupReason?: string;
  /** Only for `needs_setup` rows the server would refuse to resend: why, and where to fix it. */
  resendBlock?: MessageResendBlock;
}

export function normalizeMessageHistoryPresentation(
  record: MessageLogRecord,
  options: NormalizeMessageHistoryPresentationOptions = {},
): NormalizedMessageHistoryPresentation {
  const templateLabel = getMessageTemplateLabel(record.templateKey, record.variables);
  const title = getMessageHistoryTitle(record);
  const fallbackRecipientName = options.recipientNameFallback?.trim() ?? "";
  const fallbackListLabel = options.recipientListLabelFallback?.trim() ?? fallbackRecipientName;
  const isEmployeeRecipient = record.recipientType === "PRIMARY_EMPLOYEE"
    || record.recipientType === "SECONDARY_EMPLOYEE";
  const resolvedRecipientName = record.recipientName?.trim()
    || (isEmployeeRecipient ? record.employeeName?.trim() : record.clientName?.trim())
    || record.employeeName?.trim()
    || fallbackRecipientName
    || "";
  const registeredClientName = isEmployeeRecipient
    ? resolvedRecipientName
    : record.clientName?.trim()
      || (record.clientId !== null ? record.recipientName?.trim() : "")
      || fallbackRecipientName
      || "";
  const failureReason = record.status === "failed"
    ? formatMessageFailureReason(record.errorMessage)
    : "";
  const setupReason = record.status === "needs_setup"
    ? formatMessageFailureReason(record.errorMessage)
    : "";

  return {
    id: record.id,
    isResent: record.status === "failed" && record.resentByLogId != null,
    title,
    templateLabel,
    recipientName: resolvedRecipientName || "-",
    recipientPhone: record.recipientPhone?.trim() || record.receiver,
    recipientListLabel: registeredClientName || fallbackListLabel || record.receiver,
    channelLabel: getMessageChannelLabel(record.provider),
    sentAt: getMessageHistoryTimestamp(record),
    status: record.status,
    messagePreview: record.messageBody,
    failureReason: failureReason || undefined,
    setupReason: setupReason || undefined,
    resendBlock: record.status === "needs_setup" && record.resendBlockedBy
      ? {
        level: record.resendBlockedBy,
        recipient: record.resendBlockedRecipient ?? null,
        recipientName: resolvedRecipientName || null,
        ruleId: record.ruleId,
        ruleName: record.ruleName,
      }
      : undefined,
  };
}
