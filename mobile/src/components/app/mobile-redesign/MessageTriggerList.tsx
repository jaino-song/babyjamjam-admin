"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, type LucideIcon } from "lucide-react";
import {
  MESSAGE_EVENT_LABELS,
  MESSAGE_RECIPIENT_LABELS,
  SERVICE_RECORD_LINK_RULE_ID,
  getMessageTemplateLabel,
} from "@babyjamjam/shared";

import {
  SettingsListCard,
  SettingsListItem,
  SettingsListRowsSkeleton,
} from "@/components/app/mobile-redesign/settings/SettingsListCard";
import { Switch } from "@/components/ui/switch";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import {
  useUpdateMessageTriggerRuleBranchActivation,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  MessageTriggerRule,
  TriggerEventType,
} from "@/features/message-triggers/types";
import type { MessageTriggerRuleGroupView, MessageTriggerRuleGroupList } from "@babyjamjam/shared/types/message";
import { messageRuleGroupsApi } from "@/services/api";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
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
  group?: MessageTriggerRuleGroupView;
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
  // getServiceRecordLinkScheduledFor computes this timing, not the carrier rule's sendTime.
  if (rule.id === SERVICE_RECORD_LINK_RULE_ID) {
    return "서비스 시작 1일 전 12:00 (한국 시간) · 늦게 등록되면 즉시 발송";
  }
  const eventLabel = MESSAGE_EVENT_LABELS[rule.eventType];

  if (rule.offsetType === "IMMEDIATE") {
    return `${eventLabel} 즉시`;
  }

  const timeLabel = `${rule.sendTime ?? "09:00"} (한국 시간)`;
  if (rule.offsetType === "SAME_DAY") {
    return `${eventLabel} 당일 ${timeLabel}`;
  }

  const dayLabel = `${Math.max(rule.offsetDays, 0)}일`;
  if (rule.offsetType === "BEFORE_DAYS") {
    return `${eventLabel} ${dayLabel} 전 ${timeLabel}`;
  }

  return `${eventLabel} ${dayLabel} 후 ${timeLabel}`;
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
  canManage,
  onEdit,
  onEditGroup,
  onCreate,
  selectedId = null,
  beforeItems,
}: {
  "data-component": string;
  canManage: boolean;
  onEdit?: (rule: MessageTriggerRule) => void;
  onEditGroup?: (group: MessageTriggerRuleGroupView) => void;
  onCreate?: () => void;
  selectedId?: string | null;
  beforeItems?: ReactNode;
}) {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const branchId = useGetAuthUser().data?.branchId ?? null;
  const queryClient = useQueryClient();
  const groupMutation = useMutation({
    mutationFn: (captured: { group: MessageTriggerRuleGroupView; branchId: string }) => { const { group } = captured; return messageRuleGroupsApi.update(group.id, { name: group.name, recipientMode: group.recipientMode, eventType: group.eventType, offsetType: group.offsetType, offsetDays: group.offsetDays, sendTime: group.sendTime, targetClientStatus: group.targetClientStatus, retryOnFailure: group.retryOnFailure, isActive: !group.isActive, recipientTemplates: group.recipientTemplates, expectedVersion: group.version }, captured.branchId); },
    onSuccess: (_data, captured) => { void queryClient.invalidateQueries({ queryKey: ["message-trigger-rule-groups", captured.branchId] }); },
  });
  const {
    data: rulesResponse,
    isError: isRulesError,
    isLoading: isRulesLoading,
    isPaused: isRulesPaused,
    refetch: refetchRules,
    isFetching: isRulesFetching,
  } = useQuery<MessageTriggerRuleGroupList>({ queryKey: ["message-trigger-rule-groups", branchId], queryFn: () => messageRuleGroupsApi.list(branchId!), enabled: Boolean(branchId) });
  const isRulesLoadPending = isRulesLoading || (isRulesPaused && rulesResponse === undefined);
  const updateRuleMutation = useUpdateMessageTriggerRule();
  const branchActivationMutation = useUpdateMessageTriggerRuleBranchActivation();

  const {
    data: logsResponse = [],
    isError: isLogsError,
    isLoading: isLogsLoading,
  } = useQuery<MessageLogRecord[]>({
    queryKey: ["messages", "logs", "all", branchId],
    queryFn: () => fetchAllMessageLogs<MessageLogRecord>(),
    enabled: Boolean(branchId),
  });

  const rules = useMemo<MessageTriggerRule[]>(() => (
    rulesResponse?.standaloneRules ?? []
  ), [rulesResponse]);

  const logs = useMemo<MessageLogRecord[]>(() => (
    Array.isArray(logsResponse) ? logsResponse : []
  ), [logsResponse]);

  const monthLabel = useMemo(() => getMonthLabel(), []);

  const displayRows = useMemo<TriggerDisplayRow[]>(() => {
    const standalone: TriggerDisplayRow[] = [...rules].sort(compareTriggerRules).map((rule) => {
      const matchingLogs = logs.filter((log) => isCurrentMonthLog(log) && matchesTriggerLog(log, rule));
      return { kind: "live", rule, title: getRuleTitle(rule), timingLabel: `${getRuleTimingLabel(rule)} · ${MESSAGE_RECIPIENT_LABELS[rule.recipientType]}`, channelLabel: "SMS", icon: MessageSquareText, tone: "primary", monthlyCount: isLogsLoading || isLogsError ? null : matchingLogs.length, failedCount: isLogsLoading || isLogsError ? null : matchingLogs.filter((log) => log.status === "failed").length };
    });
    const groups: TriggerDisplayRow[] = (rulesResponse?.groups ?? []).flatMap((group) => {
      const first = group.rules[0];
      if (!first) return [];
      const rule: MessageTriggerRule = { ...first, id: group.id, name: group.name, isActive: group.isActive, branchId: group.branchId };
      const matching = logs.filter((log) => isCurrentMonthLog(log) && group.rules.some((child) => matchesTriggerLog(log, child)));
      const recipient = group.recipientMode === "BOTH_EMPLOYEES" ? "주보조모두" : MESSAGE_RECIPIENT_LABELS[group.recipientMode];
      const anchor = group.recipientMode !== "CLIENT" && (group.eventType === "SERVICE_START" || group.eventType === "SERVICE_END") ? " · 배정 일정 기준" : "";
      return [{ kind: "live" as const, rule, group, title: group.name, timingLabel: `${getRuleTimingLabel(rule)} · ${recipient}${anchor}`, channelLabel: "SMS" as const, icon: MessageSquareText, tone: "primary" as const, monthlyCount: isLogsLoading || isLogsError ? null : matching.length, failedCount: isLogsLoading || isLogsError ? null : matching.filter((log) => log.status === "failed").length }];
    });
    return [...groups, ...standalone];
  }, [isLogsError, isLogsLoading, logs, rules, rulesResponse]);

  const handleToggle = useCallback((row: TriggerDisplayRow) => {
    if (row.group) {
      if (branchId) groupMutation.mutate({ group: row.group, branchId });
      return;
    }
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
  }, [branchActivationMutation, updateRuleMutation, groupMutation, branchId]);

  const isTogglePending = groupMutation.isPending || updateRuleMutation.isPending || branchActivationMutation.isPending;

  return (
    <SettingsListCard
      data-component={dataComponent}
      title="자동 전송"
      count={isRulesLoadPending || (isRulesError && rulesResponse === undefined) ? "—" : displayRows.length}
      subtitle="메시지 자동 전송 규칙을 정할 수 있어요"
      actionLabel={canManage && onCreate ? "+ 규칙" : undefined}
      onAction={canManage ? onCreate : undefined}
    >
      {beforeItems}
      {groupMutation.isError ? <p role="alert">자동 전송 규칙을 저장하지 못했습니다. 최신 정보를 다시 불러와 주세요.</p> : null}
      {!isRulesLoading && isRulesError ? (
        <QueryErrorState
          dataComponent={sub("items_error")}
          size={displayRows.length > 0 ? "inline" : "panel"}
          title={displayRows.length > 0 ? "최신 정보를 불러오지 못했습니다" : "자동 전송 트리거를 불러오지 못했습니다."}
          onRetry={() => void refetchRules()}
          isRetrying={isRulesFetching}
        />
      ) : null}
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
              onSelect={!canManage
                ? undefined
                : onEdit
                ? isSystemRule
                  ? undefined
                  : () => row.group ? onEditGroup?.(row.group) : onEdit(row.rule)
                : () => handleToggle(row)}
              isDisabled={!canManage || (!onEdit && (isTogglePending || row.rule.isLockedByGlobal === true))}
              showChevron={Boolean(canManage && onEdit && !isSystemRule)}
              dataAttributes={{
                "data-trigger-id": triggerId,
                "data-trigger-key": triggerKey,
                "data-trigger-channel": row.channelLabel,
              }}
              control={canManage && onEdit ? (
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

      {isRulesLoadPending ? (
        <SettingsListRowsSkeleton data-component={sub("items_loading")} />
      ) : null}

      {!isRulesLoadPending && !isRulesError && displayRows.length === 0 ? (
        <div className="message-empty-state" data-component={sub("items_empty")}>
          등록된 자동 전송 트리거가 없습니다.
        </div>
      ) : null}
    </SettingsListCard>
  );
}
