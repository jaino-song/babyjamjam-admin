"use client";

import { useMemo } from "react";
import { normalizeApiError } from "@babyjamjam/shared";
import {
  BarChart3,
  Bell,
  Calculator,
  Calendar,
  FileText,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { MenuGroup } from "@/components/app/mobile-redesign/mockup-data";

/** Canonical data-component base for the /all route. */
const ALL_PAGE_BASE = "mobile_all_page";

function safeArrayPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === "object") {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return data as T[];
    const items = (payload as Record<string, unknown>).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

export default function AllMenuPage() {
  const clientsQuery = useAllClients();
  const employeesQuery = useEmployees();
  const messageTemplatesQuery = useMessageTemplates();
  const pushNotification = usePushNotification();
  const unreadCountQuery = useUnreadCount(true);

  const clients = safeArrayPayload(clientsQuery.data);
  const employees = safeArrayPayload(employeesQuery.data);
  const messageTemplates = safeArrayPayload(messageTemplatesQuery.data);
  const unreadNotifCount = typeof unreadCountQuery.data === "number" ? unreadCountQuery.data : undefined;
  const isClientsInitialLoading = clientsQuery.isLoading && clientsQuery.data === undefined;
  const isEmployeesInitialLoading = employeesQuery.isLoading && employeesQuery.data === undefined;
  const isMessageTemplatesInitialLoading = messageTemplatesQuery.isLoading && messageTemplatesQuery.data === undefined;
  const isUnreadInitialLoading = unreadCountQuery.isLoading && unreadCountQuery.data === undefined;
  const clientsNormalizedError = clientsQuery.error
    ? normalizeApiError(clientsQuery.error, { operation: "read", locale: "ko-KR" })
    : null;
  const messageTemplatesNormalizedError = messageTemplatesQuery.error
    ? normalizeApiError(messageTemplatesQuery.error, { operation: "read", locale: "ko-KR" })
    : null;
  const unreadNormalizedError = unreadCountQuery.error
    ? normalizeApiError(unreadCountQuery.error, { operation: "read", locale: "ko-KR" })
    : null;
  const showClientsError = clientsQuery.isError && Boolean(clientsNormalizedError) && !clientsNormalizedError?.suppress;
  const showMessageTemplatesError = messageTemplatesQuery.isError && Boolean(messageTemplatesNormalizedError) && !messageTemplatesNormalizedError?.suppress;
  const showUnreadError = unreadCountQuery.isError && Boolean(unreadNormalizedError) && !unreadNormalizedError?.suppress;
  const isClientsValueUnavailable = isClientsInitialLoading || (showClientsError && clientsQuery.data === undefined);
  const isMessageTemplatesValueUnavailable = isMessageTemplatesInitialLoading || (showMessageTemplatesError && messageTemplatesQuery.data === undefined);

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
            ...(unreadNotifCount !== undefined && unreadNotifCount > 0 ? { badge: String(unreadNotifCount) } : {}),
          },
          {
            label: "고객",
            href: "/clients",
            icon: Users,
            tone: "primary",
            value: isClientsValueUnavailable ? undefined : `${clients.length}명`,
            valueLoading: isClientsValueUnavailable,
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
            label: "전자문서",
            href: "/contracts",
            icon: FileText,
            tone: "green",
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
            href: "/messages/new",
            icon: MessageSquareText,
            tone: "primary",
            value: isMessageTemplatesValueUnavailable ? undefined : `${messageTemplates.length}건`,
            valueLoading: isMessageTemplatesValueUnavailable,
            valueSkeletonWidth: "32px",
          },
          {
            label: "발송 자동화",
            href: "/messages/automation",
            icon: Send,
            tone: "gold",
            disabled: true,
            statusLabel: "출시 예정",
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
    unreadNotifCount,
    isEmployeesInitialLoading,
    isClientsValueUnavailable,
    isMessageTemplatesValueUnavailable,
    isUnreadInitialLoading,
    pushNotification.isLoading,
    pushNotification.isSubscribed,
  ]);

  return (
    <div data-component={ALL_PAGE_BASE} data-slot="all-page" className="md:hidden">
      {showClientsError ? (
        <div className="space-y-3 px-4 pt-4">
          <Alert
            variant="warning"
            role="status"
            aria-live="polite"
            data-component="mobile_all_page_clients-read-error"
          >
            <AlertTitle>고객 수를 새로 불러오지 못했어요</AlertTitle>
            <AlertDescription>
              <p>{clientsNormalizedError?.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void clientsQuery.refetch()}
                disabled={clientsQuery.isFetching}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {showMessageTemplatesError ? (
        <div className="space-y-3 px-4 pt-4">
          <Alert
            variant="warning"
            role="status"
            aria-live="polite"
            data-component="mobile_all_page_message-templates-read-error"
          >
            <AlertTitle>메시지 템플릿 수를 새로 불러오지 못했어요</AlertTitle>
            <AlertDescription>
              <p>{messageTemplatesNormalizedError?.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void messageTemplatesQuery.refetch()}
                disabled={messageTemplatesQuery.isFetching}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {showUnreadError ? (
        <div className="space-y-3 px-4 pt-4">
          <Alert
            variant="warning"
            role="status"
            aria-live="polite"
            data-component="mobile_all_page_unread-count-read-error"
          >
            <AlertTitle>읽지 않은 알림 수를 불러오지 못했어요</AlertTitle>
            <AlertDescription>
              <p>{unreadNormalizedError?.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void unreadCountQuery.refetch()}
                disabled={unreadCountQuery.isFetching}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      <AllSettingsRedesign menuGroups={menuGroups} />
    </div>
  );
}
