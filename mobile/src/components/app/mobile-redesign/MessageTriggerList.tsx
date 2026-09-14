"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquareText, type LucideIcon } from "lucide-react";
import {
  MESSAGE_EVENT_LABELS,
  MESSAGE_RECIPIENT_LABELS,
  getMessageTemplateLabel,
} from "@babyjamjam/shared";

import {
  SettingsListCard,
  SettingsListItem,
  SettingsListRowsSkeleton,
} from "@/components/app/mobile-redesign/settings/SettingsListCard";
import { Switch } from "@/components/ui/switch";
import {
  useMessageTriggerRules,
  useUpdateMessageTriggerRuleBranchActivation,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  MessageTriggerRule,
  TriggerEventType,
} from "@/features/message-triggers/types";
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

interface BaseTriggerDisplayRow {
  title: string;
  timingLabel: string;
  channelLabel: "SMS";
  icon: LucideIcon;
  tone: "primary" | "orange" | "green" | "purple";
  monthlyCount: number | null;
  failedCount: number | null;
}

interface LiveTriggerDisplayRow extends BaseTriggerDisplayRow {
  kind: "live";
  rule: MessageTriggerRule;
}

type TriggerDisplayRow = LiveTriggerDisplayRow;

const EVENT_SORT_ORDER: Record<TriggerEventType, number> = {
  CLIENT_CREATED: 0,
  SERVICE_START: 1,
  SERVICE_END: 2,
  EMPLOYEE_ASSIGNED: 3,
};

function getRuleTitle(rule: MessageTriggerRule) {
  return rule.name.trim() || getMessageTemplateLabel(rule.templateKey);
}

function getRuleTimingLabel(rule: MessageTriggerRule) {
  const eventLabel = MESSAGE_EVENT_LABELS[rule.eventType];

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

function toDataComponentToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function MessageTriggerList({
  "data-component": dataComponent,
  onEdit,
  onCreate,
  selectedId = null,
  beforeItems,
}: {
  "data-component": string;
  onEdit?: (rule: MessageTriggerRule) => void;
  onCreate?: () => void;
  selectedId?: string | null;
  beforeItems?: ReactNode;
}) {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const {
    data: rulesResponse = [],
    isError: isRulesError,
    isLoading: isRulesLoading,
  } = useMessageTriggerRules();
  const updateRuleMutation = useUpdateMessageTriggerRule();
  const branchActivationMutation = useUpdateMessageTriggerRuleBranchActivation();

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
      const matchingLogs = logs.filter((log) => (
        isCurrentMonthLog(log) && matchesTriggerLog(log, rule)
      ));

      return {
        kind: "live",
        rule,
        title: getRuleTitle(rule),
        timingLabel: `${getRuleTimingLabel(rule)} · ${MESSAGE_RECIPIENT_LABELS[rule.recipientType]}`,
        channelLabel: "SMS",
        icon: MessageSquareText,
        tone: "primary",
        monthlyCount: isLogsLoading || isLogsError ? null : matchingLogs.length,
        failedCount: isLogsLoading || isLogsError
          ? null
          : matchingLogs.filter((log) => log.status === "failed").length,
      };
    });
  }, [isLogsError, isLogsLoading, logs, rules]);

  const handleToggle = useCallback((row: TriggerDisplayRow) => {
    const nextActive = !row.rule.isActive;

    if (row.rule.branchId === null) {
      branchActivationMutation.mutate({
        id: row.rule.id,
        dto: { isActive: nextActive },
      });
      return;
    }

    updateRuleMutation.mutate({
      id: row.rule.id,
      dto: { isActive: nextActive },
    });
  }, [branchActivationMutation, updateRuleMutation]);

  const isTogglePending = updateRuleMutation.isPending || branchActivationMutation.isPending;

  return (
    <SettingsListCard
      data-component={dataComponent}
      title="자동 전송"
      count={displayRows.length}
      subtitle="메시지 자동 전송 규칙을 정할 수 있어요"
      actionLabel={onCreate ? "+ 규칙" : undefined}
      onAction={onCreate}
    >
      {beforeItems}
      {displayRows.map((row) => {
          const rowActive = row.rule.isActive;
          const rowKey = row.rule.id;
          const triggerKey = row.rule.templateKey;
          const triggerId = row.rule.id;
          // M5: a branchless rule (branchId === null) is a system rule — the manual-send
          // synthetic rule is one example — and must not be editable or toggleable here,
          // mirroring the desktop guard (frontend/src/components/app/messages/
          // TriggerRulesManager.tsx:525,564,712).
          const isSystemRule = row.rule.branchId === null;

          const countLabel = isLogsLoading
            ? "발송 건수 집계 중"
            : isLogsError
              ? "집계 실패"
              : `${monthLabel} ${row.monthlyCount ?? 0}건`;
          const itemBase = sub(`item-${toDataComponentToken(rowKey)}`);

          return (
            <SettingsListItem
              key={rowKey}
              data-component={itemBase}
              icon={row.icon}
              title={row.title}
              subtitle={`${countLabel} · ${row.timingLabel} · ${row.channelLabel}`}
              isSelected={selectedId === rowKey}
              onSelect={onEdit
                ? isSystemRule
                  ? undefined
                  : () => onEdit(row.rule)
                : () => handleToggle(row)}
              isDisabled={!onEdit && (isTogglePending || row.rule.isLockedByGlobal === true)}
              showChevron={Boolean(onEdit && !isSystemRule)}
              dataAttributes={{
                "data-trigger-id": triggerId,
                "data-trigger-key": triggerKey,
                "data-trigger-channel": row.channelLabel,
              }}
              control={onEdit ? (
                <Switch
                  data-component={`${itemBase}_trailing_switch`}
                  thumbDataComponent={`${itemBase}_trailing_switch_thumb`}
                  aria-label={`${row.title} ${rowActive ? "비활성화" : "활성화"}`}
                  checked={rowActive}
                  disabled={isTogglePending || row.rule.isLockedByGlobal === true}
                  className="[--v3-ui-scale:var(--glint-ui-scale,1)]"
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={() => handleToggle(row)}
                />
              ) : undefined}
            />
          );
      })}

      {isRulesLoading ? (
        <SettingsListRowsSkeleton data-component={sub("items_loading")} />
      ) : null}

      {!isRulesLoading && isRulesError ? (
        <div className="message-empty-state" data-component={sub("items_error")}>
          자동 전송 트리거를 불러오지 못했습니다.
        </div>
      ) : null}

      {!isRulesLoading && !isRulesError && displayRows.length === 0 ? (
        <div className="message-empty-state" data-component={sub("items_empty")}>
          등록된 자동 전송 트리거가 없습니다.
        </div>
      ) : null}
    </SettingsListCard>
  );
}
