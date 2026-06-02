"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Check, Send, UserCheck, UserPlus, type LucideIcon } from "lucide-react";

import {
  useAlimtalkTriggerRules,
  useUpdateAlimtalkTriggerRule,
} from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import type {
  AlimtalkTriggerRule,
  TriggerEventType,
  TriggerTemplateKey,
} from "@/features/alimtalk-triggers/types";
import { api } from "@/lib/api/client";
import "@/components/app/mobile-redesign/redesign.css";

interface AlimtalkLogRecord {
  id: number;
  templateKey: string;
  status: "pending" | "sent" | "failed";
  createdAt: string;
  ruleName: string | null;
  eventType: string | null;
}

interface TriggerDefinition {
  templateKey: TriggerTemplateKey;
  eventType: TriggerEventType;
  title: string;
  timingLabel: string;
  icon: LucideIcon;
  tone: "primary" | "orange" | "green" | "purple";
  fallbackMonthlyCount: number;
  fallbackActive: boolean;
}

interface TriggerDisplayRow extends TriggerDefinition {
  isActive: boolean;
  monthlyCount: number;
  failedCount: number;
  rule: AlimtalkTriggerRule | null;
}

const TRIGGER_DEFINITIONS: TriggerDefinition[] = [
  {
    templateKey: "CLIENT_WELCOME",
    eventType: "CLIENT_CREATED",
    title: "고객 등록 환영",
    timingLabel: "고객 신규 등록 즉시",
    icon: UserPlus,
    tone: "primary",
    fallbackMonthlyCount: 12,
    fallbackActive: true,
  },
  {
    templateKey: "SERVICE_START_REMINDER",
    eventType: "SERVICE_START",
    title: "서비스 시작 D-1 안내",
    timingLabel: "서비스 시작 1일 전",
    icon: Send,
    tone: "orange",
    fallbackMonthlyCount: 8,
    fallbackActive: true,
  },
  {
    templateKey: "SERVICE_END_REMINDER",
    eventType: "SERVICE_END",
    title: "서비스 종료 안내",
    timingLabel: "서비스 종료일 당일",
    icon: Check,
    tone: "green",
    fallbackMonthlyCount: 6,
    fallbackActive: true,
  },
  {
    templateKey: "EMPLOYEE_ASSIGNED",
    eventType: "EMPLOYEE_ASSIGNED",
    title: "제공인력 배정 안내",
    timingLabel: "제공인력 배정 즉시",
    icon: UserCheck,
    tone: "purple",
    fallbackMonthlyCount: 7,
    fallbackActive: false,
  },
];

const DEFAULT_TRIGGER_ACTIVE: Record<TriggerTemplateKey, boolean> = {
  CLIENT_WELCOME: true,
  SERVICE_START_REMINDER: true,
  SERVICE_END_REMINDER: true,
  EMPLOYEE_ASSIGNED: false,
};

function findMatchingRule(
  rules: AlimtalkTriggerRule[],
  definition: TriggerDefinition,
): AlimtalkTriggerRule | null {
  return (
    rules.find((rule) => rule.templateKey === definition.templateKey)
    ?? rules.find((rule) => rule.eventType === definition.eventType)
    ?? null
  );
}

function isCurrentMonthLog(log: AlimtalkLogRecord) {
  const createdAt = new Date(log.createdAt);
  const now = new Date();

  return (
    !Number.isNaN(createdAt.getTime())
    && createdAt.getFullYear() === now.getFullYear()
    && createdAt.getMonth() === now.getMonth()
  );
}

function matchesTriggerLog(log: AlimtalkLogRecord, definition: TriggerDefinition) {
  return (
    log.templateKey === definition.templateKey
    || log.eventType === definition.eventType
    || log.ruleName === definition.title
  );
}

function getMonthLabel() {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric" }).format(new Date());
}

export function AlimtalkAutomationPage() {
  const [fixtureActive, setFixtureActive] = useState<Record<TriggerTemplateKey, boolean>>(
    DEFAULT_TRIGGER_ACTIVE,
  );

  const { data: rulesResponse = [] } = useAlimtalkTriggerRules();
  const updateRuleMutation = useUpdateAlimtalkTriggerRule();

  const { data: logsResponse = [] } = useQuery<unknown>({
    queryKey: ["alimtalk", "logs", 200],
    queryFn: async () => {
      const res = await api.get<unknown>("/alimtalk-logs", {
        params: { limit: 200 },
      });
      return res.data;
    },
  });

  const rules = useMemo<AlimtalkTriggerRule[]>(() => (
    Array.isArray(rulesResponse) ? rulesResponse : []
  ), [rulesResponse]);

  const logs = useMemo<AlimtalkLogRecord[]>(() => (
    Array.isArray(logsResponse) ? logsResponse : []
  ), [logsResponse]);

  const hasLiveLogs = logs.length > 0;
  const monthLabel = useMemo(() => getMonthLabel(), []);

  const displayRows = useMemo<TriggerDisplayRow[]>(() => {
    return TRIGGER_DEFINITIONS.map((definition) => {
      const rule = findMatchingRule(rules, definition);
      const matchingLogs = logs.filter((log) => (
        isCurrentMonthLog(log) && matchesTriggerLog(log, definition)
      ));

      return {
        ...definition,
        rule,
        isActive: rule?.isActive ?? fixtureActive[definition.templateKey],
        monthlyCount: hasLiveLogs ? matchingLogs.length : definition.fallbackMonthlyCount,
        failedCount: matchingLogs.filter((log) => log.status === "failed").length,
      };
    });
  }, [fixtureActive, hasLiveLogs, logs, rules]);

  const handleToggle = useCallback((row: TriggerDisplayRow) => {
    const nextActive = !row.isActive;

    if (!row.rule) {
      setFixtureActive((current) => ({
        ...current,
        [row.templateKey]: nextActive,
      }));
      return;
    }

    updateRuleMutation.mutate({
      id: row.rule.id,
      dto: { isActive: nextActive },
    });
  }, [updateRuleMutation]);

  return (
    <section data-component="alimtalk" className="alimtalk-page">
      <div className="shell-content" data-component="alimtalk-content">
        <div className="list-card pop-up alimtalk-trigger-card" data-component="alimtalk-trigger-card">
          <div className="list-title" data-component="alimtalk-trigger-card-title">
            <span className="list-title-text">알림톡 자동 발송</span>
            <Link href="/messages/system-templates" className="list-action">
              템플릿 관리
            </Link>
          </div>

          <div className="list-card-scroll" data-component="alimtalk-trigger-scroll">
            <div className="section-block" data-component="alimtalk-trigger-section">
              <div className="section-header" data-component="alimtalk-trigger-section-header">자동화</div>

              {displayRows.map((row) => {
                const Icon = row.icon;

                return (
                  <button
                    key={row.templateKey}
                    type="button"
                    className="list-item alimtalk-trigger-row"
                    aria-pressed={row.isActive}
                    data-component="alimtalk-trigger-row"
                    data-trigger-key={row.templateKey}
                    onClick={() => handleToggle(row)}
                  >
                    <div
                      className={`trigger-icon trigger-icon-${row.tone}`}
                      data-component="alimtalk-trigger-icon"
                    >
                      <Icon size={18} strokeWidth={2.5} />
                    </div>

                    <div className="trigger-info" data-component="alimtalk-trigger-info">
                      <div className="trigger-title" data-component="alimtalk-trigger-title">{row.title}</div>
                      <div className="trigger-meta" data-component="alimtalk-trigger-meta">
                        <span className={`send-stat ${row.failedCount > 0 ? "fail" : ""}`}>
                          {monthLabel} {row.monthlyCount}건
                        </span>
                        <span className="sep">·</span>
                        <span>{row.timingLabel}</span>
                      </div>
                    </div>

                    <span className={`toggle ${row.isActive ? "on" : ""}`} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
