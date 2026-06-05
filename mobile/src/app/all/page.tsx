"use client";

import { useMemo } from "react";
import {
  BarChart3,
  Bell,
  Calculator,
  Calendar,
  MessageCircle,
  MessageSquareText,
  Send,
  UserCheck,
  Users,
} from "lucide-react";

import { useAllClients } from "@/hooks/useClients";
import { useEmployees } from "@/hooks/useEmployees";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import { useUnreadCount, usePushNotification } from "@/hooks/usePushNotification";
import { AllSettingsRedesign } from "@/components/app/mobile-redesign/AllSettingsRedesign";
import { UI_ONLY_AUTOMATION_TRIGGER_COUNT } from "@/components/app/mobile-redesign/AlimtalkAutomationPage";
import type { MenuGroup } from "@/components/app/mobile-redesign/mockup-data";
import { useAlimtalkTriggerRules } from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";

export default function AllMenuPage() {
  const clientsQuery = useAllClients();
  const employeesQuery = useEmployees();
  const messageTemplatesQuery = useMessageTemplates();
  const alimtalkTriggerRulesQuery = useAlimtalkTriggerRules();
  const pushNotification = usePushNotification();
  const unreadCountQuery = useUnreadCount(true);

  const clients = clientsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const messageTemplates = messageTemplatesQuery.data ?? [];
  const alimtalkTriggerRules = alimtalkTriggerRulesQuery.data ?? [];
  const automationTriggerCount = alimtalkTriggerRules.length + UI_ONLY_AUTOMATION_TRIGGER_COUNT;
  const unreadNotifCount = unreadCountQuery.data ?? 0;
  const isClientsInitialLoading = clientsQuery.isLoading && !clientsQuery.data;
  const isEmployeesInitialLoading = employeesQuery.isLoading && !employeesQuery.data;
  const isMessageTemplatesInitialLoading = messageTemplatesQuery.isLoading && !messageTemplatesQuery.data;
  const isAlimtalkRulesInitialLoading = alimtalkTriggerRulesQuery.isLoading && !alimtalkTriggerRulesQuery.data;
  const isUnreadInitialLoading = unreadCountQuery.isLoading && unreadCountQuery.data === undefined;

  const menuGroups = useMemo<MenuGroup[]>(() => {
    return [
      {
        title: "지점 관리",
        rows: [
          {
            label: "상담",
            href: "/consultations",
            icon: MessageCircle,
            tone: "burgundy",
            badgeLoading: isUnreadInitialLoading,
            badgeSkeletonWidth: "18px",
            ...(unreadNotifCount > 0 ? { badge: String(unreadNotifCount) } : {}),
          },
          {
            label: "고객",
            href: "/clients",
            icon: Users,
            tone: "primary",
            value: isClientsInitialLoading ? undefined : `${clients.length}명`,
            valueLoading: isClientsInitialLoading,
            valueSkeletonWidth: "28px",
          },
          {
            label: "제공인력",
            href: "/employees",
            icon: UserCheck,
            tone: "purple",
            value: isEmployeesInitialLoading ? undefined : `${employees.length}명`,
            valueLoading: isEmployeesInitialLoading,
            valueSkeletonWidth: "28px",
          },
          {
            label: "일정 캘린더",
            href: "/employees/schedule",
            icon: Calendar,
            tone: "orange",
            disabled: true,
            statusLabel: "출시 예정",
          },
          {
            label: "통계 보고서",
            href: "/dashboard/analytics",
            icon: BarChart3,
            tone: "green",
            disabled: true,
            statusLabel: "출시 예정",
          },
        ],
      },
      {
        title: "서비스 관리",
        rows: [
          { label: "가격표", href: "/prices", icon: Calculator, tone: "orange" },
          {
            label: "메시지",
            href: "/messages",
            icon: MessageSquareText,
            tone: "primary",
            value: isMessageTemplatesInitialLoading ? undefined : `${messageTemplates.length}건`,
            valueLoading: isMessageTemplatesInitialLoading,
            valueSkeletonWidth: "32px",
          },
          {
            label: "발송 자동화",
            href: "/alimtalk",
            icon: Send,
            tone: "gold",
            value: isAlimtalkRulesInitialLoading ? undefined : `${automationTriggerCount}개`,
            valueLoading: isAlimtalkRulesInitialLoading,
            valueSkeletonWidth: "28px",
          },
        ],
      },
      {
        title: "설정",
        rows: [
          {
            label: "알림 설정",
            href: "/notification",
            icon: Bell,
            tone: "muted",
            value: pushNotification.isLoading ? undefined : pushNotification.isSubscribed ? "활성" : "비활성",
            valueLoading: pushNotification.isLoading,
            valueSkeletonWidth: "38px",
          },
        ],
      },
    ];
  }, [
    clients.length,
    employees.length,
    messageTemplates.length,
    automationTriggerCount,
    unreadNotifCount,
    isClientsInitialLoading,
    isEmployeesInitialLoading,
    isMessageTemplatesInitialLoading,
    isAlimtalkRulesInitialLoading,
    isUnreadInitialLoading,
    pushNotification.isLoading,
    pushNotification.isSubscribed,
  ]);

  return (
    <div data-component="all-page" className="md:hidden">
      <AllSettingsRedesign menuGroups={menuGroups} />
    </div>
  );
}
