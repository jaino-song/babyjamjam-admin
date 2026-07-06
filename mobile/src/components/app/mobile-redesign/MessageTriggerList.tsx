"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, MessageSquareText, Send, UserCheck, UserPlus, type LucideIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  useMessageTriggerRules,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  MessageTriggerRule,
  TriggerEventType,
  TriggerTemplateKey,
} from "@/features/message-triggers/types";
import { getTriggerTemplateChannel } from "@/features/message-triggers/types";
import { fetchAllMessageLogs } from "@/lib/messages/logs";
import "@/components/app/mobile-redesign/redesign.css";

interface MessageLogRecord {
  id: number;
  templateKey: string;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  ruleId: string | null;
  ruleName: string | null;
  eventType: TriggerEventType | null;
}

interface TriggerEventMeta {
  label: string;
  icon: LucideIcon;
  tone: "primary" | "orange" | "green" | "purple";
}

interface BaseTriggerDisplayRow {
  title: string;
  timingLabel: string;
  channelLabel: "알림톡" | "SMS";
  icon: LucideIcon;
  tone: TriggerEventMeta["tone"];
  monthlyCount: number | null;
  failedCount: number | null;
}

interface LiveTriggerDisplayRow extends BaseTriggerDisplayRow {
  kind: "live";
  rule: MessageTriggerRule;
}

interface UiTriggerDisplayRow extends BaseTriggerDisplayRow {
  kind: "ui";
  id: string;
  isActive: boolean;
}

type TriggerDisplayRow = LiveTriggerDisplayRow | UiTriggerDisplayRow;

export const UI_ONLY_AUTOMATION_TRIGGER_COUNT = 1;

const CLIENT_GREETING_SMS_TRIGGER: UiTriggerDisplayRow = {
  kind: "ui",
  id: "client-greeting-sms",
  title: "신규 고객 인사 SMS",
  timingLabel: "고객 등록 즉시 · 고객 번호",
  channelLabel: "SMS",
  icon: MessageSquareText,
  tone: "primary",
  monthlyCount: 0,
  failedCount: 0,
  isActive: true,
};

const EVENT_META: Record<TriggerEventType, TriggerEventMeta> = {
  CLIENT_CREATED: {
    label: "고객 등록",
    icon: UserPlus,
    tone: "primary",
  },
  SERVICE_START: {
    label: "서비스 시작",
    icon: Send,
    tone: "orange",
  },
  SERVICE_END: {
    label: "서비스 종료",
    icon: Check,
    tone: "green",
  },
  EMPLOYEE_ASSIGNED: {
    label: "제공인력 배정",
    icon: UserCheck,
    tone: "purple",
  },
};

const EVENT_SORT_ORDER: Record<TriggerEventType, number> = {
  CLIENT_CREATED: 0,
  SERVICE_START: 1,
  SERVICE_END: 2,
  EMPLOYEE_ASSIGNED: 3,
};

const RECIPIENT_LABEL: Record<MessageTriggerRule["recipientType"], string> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "주 담당 제공인력",
  SECONDARY_EMPLOYEE: "보조 제공인력",
};

const TEMPLATE_LABEL: Record<TriggerTemplateKey, string> = {
  CLIENT_WELCOME: "고객 등록 환영",
  SERVICE_START_REMINDER: "서비스 시작 안내",
  SERVICE_INFO: "서비스 안내",
  SERVICE_END_REMINDER: "서비스 종료 안내",
  EMPLOYEE_ASSIGNED: "제공인력 배정 안내",
  SERVICE_FEEDBACK_LINK: "제공기록지 작성 링크",
  CLIENT_GREETING: "인사(소개)",
  PRICE_INFO: "비용 안내",
  REMINDER: "리마인드",
  THANKS: "예약 완료(입금 확인)",
  SURVEY: "모니터링 설문",
  INFO: "정보 요청",
};

function getRuleTitle(rule: MessageTriggerRule) {
  return rule.name.trim() || TEMPLATE_LABEL[rule.templateKey];
}

function getRuleTimingLabel(rule: MessageTriggerRule) {
  const eventLabel = EVENT_META[rule.eventType].label;

  if (rule.offsetType === "IMMEDIATE") {
    return `${eventLabel} 즉시`;
  }

  if (rule.offsetType === "SAME_DAY") {
    return `${eventLabel} 당일`;
  }

  const dayLabel = `${Math.max(rule.offsetDays, 0)}일`;
  if (rule.offsetType === "BEFORE_DAYS") {
    return `${eventLabel} ${dayLabel} 전`;
  }

  return `${eventLabel} ${dayLabel} 후`;
}

function getRuleChannelLabel(rule: MessageTriggerRule): BaseTriggerDisplayRow["channelLabel"] {
  return getTriggerTemplateChannel(rule.templateKey) === "sms" ? "SMS" : "알림톡";
}

function getRuleIcon(rule: MessageTriggerRule, eventMeta: TriggerEventMeta): LucideIcon {
  return getTriggerTemplateChannel(rule.templateKey) === "sms" ? MessageSquareText : eventMeta.icon;
}

function getRuleTone(rule: MessageTriggerRule, eventMeta: TriggerEventMeta): TriggerEventMeta["tone"] {
  return getTriggerTemplateChannel(rule.templateKey) === "sms" ? "primary" : eventMeta.tone;
}

function isCurrentMonthLog(log: MessageLogRecord) {
  const createdAt = new Date(log.createdAt);
  const now = new Date();

  return (
    !Number.isNaN(createdAt.getTime())
    && createdAt.getFullYear() === now.getFullYear()
    && createdAt.getMonth() === now.getMonth()
  );
}

function matchesTriggerLog(log: MessageLogRecord, rule: MessageTriggerRule) {
  if (log.ruleId) {
    return log.ruleId === rule.id;
  }

  return (
    log.ruleName === rule.name
    || (
      log.templateKey === rule.templateKey
      && log.eventType === rule.eventType
    )
  );
}

function getMonthLabel() {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric" }).format(new Date());
}

function compareTriggerRules(first: MessageTriggerRule, second: MessageTriggerRule) {
  const eventOrder = EVENT_SORT_ORDER[first.eventType] - EVENT_SORT_ORDER[second.eventType];
  if (eventOrder !== 0) return eventOrder;

  const offsetOrder = first.offsetDays - second.offsetDays;
  if (offsetOrder !== 0) return offsetOrder;

  return getRuleTitle(first).localeCompare(getRuleTitle(second), "ko-KR");
}

export function MessageTriggerList() {
  const {
    data: rulesResponse = [],
    isError: isRulesError,
    isLoading: isRulesLoading,
  } = useMessageTriggerRules();
  const updateRuleMutation = useUpdateMessageTriggerRule();

  const {
    data: logsResponse = [],
    isError: isLogsError,
    isLoading: isLogsLoading,
  } = useQuery<MessageLogRecord[]>({
    queryKey: ["messages", "logs", "all"],
    queryFn: () => fetchAllMessageLogs<MessageLogRecord>(),
  });

  const rules = useMemo<MessageTriggerRule[]>(() => (
    Array.isArray(rulesResponse) ? rulesResponse : []
  ), [rulesResponse]);

  const logs = useMemo<MessageLogRecord[]>(() => (
    Array.isArray(logsResponse) ? logsResponse : []
  ), [logsResponse]);

  const monthLabel = useMemo(() => getMonthLabel(), []);

  const displayRows = useMemo<TriggerDisplayRow[]>(() => {
    return [...rules].sort(compareTriggerRules).map((rule) => {
      const eventMeta = EVENT_META[rule.eventType];
      const matchingLogs = logs.filter((log) => (
        isCurrentMonthLog(log) && matchesTriggerLog(log, rule)
      ));

      return {
        kind: "live",
        rule,
        title: getRuleTitle(rule),
        timingLabel: `${getRuleTimingLabel(rule)} · ${RECIPIENT_LABEL[rule.recipientType]}`,
        channelLabel: getRuleChannelLabel(rule),
        icon: getRuleIcon(rule, eventMeta),
        tone: getRuleTone(rule, eventMeta),
        monthlyCount: isLogsLoading || isLogsError ? null : matchingLogs.length,
        failedCount: isLogsLoading || isLogsError
          ? null
          : matchingLogs.filter((log) => log.status === "failed").length,
      };
    });
  }, [isLogsError, isLogsLoading, logs, rules]);

  const allDisplayRows = useMemo<TriggerDisplayRow[]>(() => (
    [
      CLIENT_GREETING_SMS_TRIGGER,
      ...displayRows,
    ]
  ), [displayRows]);

  const handleToggle = useCallback((row: TriggerDisplayRow) => {
    if (row.kind === "ui") return;
    const nextActive = !row.rule.isActive;

    updateRuleMutation.mutate({
      id: row.rule.id,
      dto: { isActive: nextActive },
    });
  }, [updateRuleMutation]);

  return (
    <div className="list-card-scroll" data-component="message-trigger-scroll">
      <div className="section-block" data-component="message-trigger-section">
        <div className="section-header" data-component="message-trigger-section-header">자동 전송 트리거</div>

        {allDisplayRows.map((row) => {
          const Icon = row.icon;
          const rowActive = row.kind === "live" ? row.rule.isActive : row.isActive;
          const rowKey = row.kind === "live" ? row.rule.id : row.id;
          const triggerKey = row.kind === "live" ? row.rule.templateKey : row.id;
          const triggerId = row.kind === "live" ? row.rule.id : row.id;

          return (
            <button
              key={rowKey}
              type="button"
              className="list-item message-trigger-row"
              aria-pressed={rowActive}
              data-component="message-trigger-row"
              data-trigger-id={triggerId}
              data-trigger-key={triggerKey}
              data-trigger-channel={row.channelLabel}
              disabled={row.kind === "live" && updateRuleMutation.isPending}
              onClick={() => handleToggle(row)}
            >
              <div
                className={`trigger-icon trigger-icon-${row.tone}`}
                data-component="message-trigger-icon"
              >
                <Icon size={18} strokeWidth={2.5} />
              </div>

              <div className="trigger-info" data-component="message-trigger-info">
                <div className="trigger-title" data-component="message-trigger-title">{row.title}</div>
                <div className="trigger-meta" data-component="message-trigger-meta">
                  <span className={`send-stat ${row.kind === "live" && (isLogsError || (row.failedCount ?? 0) > 0) ? "fail" : ""}`}>
                    {isLogsLoading && row.kind === "live" ? (
                      <span className="alimtalk-count-skeleton" aria-label="발송 건수 집계 중" />
                    ) : isLogsError && row.kind === "live" ? (
                      "집계 실패"
                    ) : (
                      `${monthLabel} ${row.monthlyCount ?? 0}건`
                    )}
                  </span>
                  <span className="sep">·</span>
                  <span>{row.timingLabel}</span>
                  <span className="sep">·</span>
                  <span>{row.channelLabel}</span>
                </div>
              </div>

              <span className={`toggle ${rowActive ? "on" : ""}`} aria-hidden="true" />
            </button>
          );
        })}

        {isRulesLoading && (
          Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`message-trigger-skeleton-${index}`}
              className="list-item message-trigger-row message-trigger-row-skeleton"
              data-component="message-trigger-row-skeleton"
              aria-hidden="true"
            >
              <Skeleton className="trigger-icon bg-v3-dim-white animate-pulse" />
              <div className="trigger-info" data-component="message-trigger-skeleton-info">
                <Skeleton className="h-4 w-28 bg-v3-dim-white animate-pulse" />
                <Skeleton className="mt-2 h-3 w-36 bg-v3-dim-white animate-pulse" />
              </div>
              <Skeleton className="h-[22px] w-[38px] rounded-full bg-v3-dim-white animate-pulse" />
            </div>
          ))
        )}

        {!isRulesLoading && isRulesError && (
          <div className="alimtalk-empty-state" data-component="message-trigger-error">
            자동 전송 트리거를 불러오지 못했습니다.
          </div>
        )}

        {!isRulesLoading && !isRulesError && allDisplayRows.length === 0 && (
          <div className="alimtalk-empty-state" data-component="message-trigger-empty">
            등록된 자동 전송 트리거가 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}
