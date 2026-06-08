"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import {
  useAlimtalkHistory,
  useUpcomingAlimtalkJobs,
} from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import { useToast } from "@/hooks/use-toast";
import type {
  AlimtalkHistoryRecord as ApiAlimtalkHistoryRecord,
  TriggerEventType,
  TriggerRecipientType,
  TriggerTemplateKey,
  UpcomingAlimtalkJob,
} from "@/features/alimtalk-triggers/types";
import { messageDeliveryApi } from "@/services/api";
import { CustomTemplateForm } from "@/components/app/messages/forms/custom-template-form";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  AnimatedSlotList,
  DetailEmptyState,
  DetailPanel,
  DetailTabs,
  HeaderActionButton,
  ListEmptyState,
  ListPanel,
  PageSection,
  SectionNav,
  SplitLayout,
} from "@/components/app/v3";
import { AlimtalkPhonePreview } from "@/components/app/alimtalk/AlimtalkPhonePreview";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Bell,
  Briefcase,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Clock3,
  CreditCard,
  FilePen,
  FileText,
  Heart,
  History,
  Info,
  MessageCircle,
  Plus,
  RotateCcw,
  Settings2,
  UserPlus,
  Users,
  Workflow,
} from "lucide-react";
import { GreetingMessageForm } from "@/components/app/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/components/app/messages/forms/service-info-message-form";
import { PriceInfoMessageForm } from "@/components/app/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/components/app/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/components/app/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/components/app/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/components/app/messages/forms/InfoMessageForm";
import { MessageTenantApplicationSettings } from "@/components/app/messages/MessageTenantApplicationSettings";
import { TriggerRulesManager } from "@/components/app/alimtalk/TriggerRulesManager";

type BuiltinTemplateType = "greeting" | "service-info" | "price-info" | "reminder" | "thanks" | "survey" | "info";
type TemplateFilter = "builtin" | "branch";

interface TemplateListItem {
  id: string;
  label: string;
  icon: typeof MessageCircle;
}

interface PlaceholderPreviewItem {
  id: string;
  label: string;
  summary: string;
  badge: string;
  detailTitle: string;
  detailDescription: string;
  checklist: string[];
  recipientName?: string;
  recipientType?: "고객" | "직원";
  recipientPhone?: string;
  templateTitle?: string;
  scheduledAt?: string;
  messageBody?: string;
  variableAssignments?: Array<{
    token: string;
    label: string;
    value: string;
  }>;
}

const BUILTIN_TEMPLATES: TemplateListItem[] = [
  { id: "builtin:greeting", label: "인사 메시지", icon: MessageCircle },
  { id: "builtin:service-info", label: "서비스 안내", icon: Briefcase },
  { id: "builtin:price-info", label: "요금 안내", icon: CreditCard },
  { id: "builtin:reminder", label: "리마인더", icon: Bell },
  { id: "builtin:thanks", label: "감사 메시지", icon: Heart },
  { id: "builtin:survey", label: "설문", icon: ClipboardList },
  { id: "builtin:info", label: "안내 메시지", icon: Info },
];

const TEMPLATE_FILTERS: Array<{ value: TemplateFilter; label: string }> = [
  { value: "builtin", label: "기본 템플릿" },
  { value: "branch", label: "지점 템플릿" },
];

const MESSAGE_SECTIONS = [
  { id: "scheduled", label: "발송 예정", icon: Clock3 },
  { id: "history", label: "발송 기록", icon: History },
  { id: "templates", label: "템플릿", icon: FileText },
  { id: "triggers", label: "발송 트리거 설정", icon: Workflow },
  { id: "settings", label: "설정", icon: Settings2 },
] as const;

type MessageSectionId = (typeof MESSAGE_SECTIONS)[number]["id"];
type PlaceholderSectionId = Exclude<MessageSectionId, "templates" | "triggers" | "history">;

type MessageHistoryStatus = "sent" | "failed" | "pending";
type MessageHistoryFilter = "all" | MessageHistoryStatus;
type MessageHistoryRelativeDateFilter = "all" | "1d" | "7d" | "30d";
type ScheduledPreviewFilter = "all" | "customer" | "staff";
type TemplateDetailTab = "details" | "preview";

interface MessageHistoryRecord {
  id: number;
  title: string;
  templateLabel: string;
  recipientName: string;
  recipientPhone: string;
  channelLabel: string;
  sentAt: string;
  status: MessageHistoryStatus;
  messagePreview: string;
  failureReason?: string;
  icon: typeof MessageCircle;
}

const PLACEHOLDER_COPY: Record<
  PlaceholderSectionId,
  { description: string; helper: string; items: PlaceholderPreviewItem[] }
> = {
  scheduled: {
    description: "발송이 예정된 메시지를 확인할 수 있어요.",
    helper: "예정 발송 목록 컴포넌트를 연결하면 이 섹션에서 예약 현황을 확인할 수 있습니다.",
    items: [
      {
        id: "scheduled-queue",
        label: "김서연",
        summary: "인사 메시지 · 3월 11일 09:00",
        badge: "고객",
        detailTitle: "김서연 예약 발송",
        detailDescription: "고객 김서연님에게 발송될 인사 메시지 예약 건으로, 템플릿 제목과 발송 예정 시각을 함께 확인하는 상세 영역입니다.",
        checklist: ["받는 사람: 고객", "템플릿: 인사 메시지", "발송 예정: 3월 11일 09:00"],
        recipientName: "김서연",
        recipientType: "고객",
        recipientPhone: "010-2481-9032",
        templateTitle: "인사 메시지",
        scheduledAt: "3월 11일 09:00",
        messageBody:
          "김서연님, 안녕하세요.\n아가잼잼 산후도우미 서비스 등록이 완료되었어요.\n담당 매니저는 한지민 매니저로 배정될 예정이며, 확정되면 다시 안내드릴게요.\n문의사항은 언제든 편하게 연락 주세요.",
        variableAssignments: [
          { token: "#{고객명}", label: "수신자 이름", value: "김서연" },
          { token: "#{서비스명}", label: "예약된 서비스", value: "산후도우미 서비스" },
          { token: "#{담당자명}", label: "배정 예정 매니저", value: "한지민 매니저" },
        ],
      },
      {
        id: "scheduled-today",
        label: "박지민",
        summary: "리마인더 · 3월 11일 14:30",
        badge: "직원",
        detailTitle: "박지민 예약 발송",
        detailDescription: "직원 박지민님에게 발송될 리마인더 예약 건으로, 발송 대상과 예약 시간을 빠르게 점검할 수 있는 상세 영역입니다.",
        checklist: ["받는 사람: 직원", "템플릿: 리마인더", "발송 예정: 3월 11일 14:30"],
        recipientName: "박지민",
        recipientType: "직원",
        recipientPhone: "010-5538-1120",
        templateTitle: "리마인더",
        scheduledAt: "3월 11일 14:30",
        messageBody:
          "박지민님, 오늘 오후 2시 30분 보호자 상담 일정이 예정되어 있어요.\n상담 시작 10분 전까지 회의실 2번으로 입장해 주세요.\n변동이 필요하면 운영팀에 바로 알려주세요.",
        variableAssignments: [
          { token: "#{수신자명}", label: "수신자 이름", value: "박지민" },
          { token: "#{상담시간}", label: "예약된 상담 시간", value: "오후 2시 30분" },
          { token: "#{상담장소}", label: "안내된 장소", value: "회의실 2번" },
        ],
      },
      {
        id: "scheduled-trigger",
        label: "이하은",
        summary: "요금 안내 · 3월 12일 10:00",
        badge: "고객",
        detailTitle: "이하은 예약 발송",
        detailDescription: "고객 이하은님에게 발송될 요금 안내 예약 건으로, 템플릿 제목과 예정 발송 시간을 확인할 수 있는 상세 영역입니다.",
        checklist: ["받는 사람: 고객", "템플릿: 요금 안내", "발송 예정: 3월 12일 10:00"],
        recipientName: "이하은",
        recipientType: "고객",
        recipientPhone: "010-8804-6621",
        templateTitle: "요금 안내",
        scheduledAt: "3월 12일 10:00",
        messageBody:
          "이하은님, 정부지원 바우처 서비스 비용을 안내드려요.\n4주 과정 기준 총 이용금액은 1,280,000원이며, 정부 지원금은 980,000원입니다.\n본인 부담금은 300,000원이고, 예약금 입금 후 일정이 최종 확정됩니다.",
        variableAssignments: [
          { token: "#{고객명}", label: "수신자 이름", value: "이하은" },
          { token: "#{서비스기간}", label: "이용 예정 기간", value: "4주 과정" },
          { token: "#{본인부담금}", label: "안내된 본인 부담금", value: "300,000원" },
        ],
      },
    ],
  },
  settings: {
    description: "메시지 발송 정책과 기본 옵션을 관리하는 영역입니다.",
    helper: "채널 설정이나 발신 정책 관련 UI를 연결하면 이곳에서 공통 설정을 다룰 수 있습니다.",
    items: [
      {
        id: "settings-channel",
        label: "채널 기본값",
        summary: "발신 채널과 기본 템플릿 정책을 정리하는 설정 목록입니다.",
        badge: "기본",
        detailTitle: "채널 기본값 상세",
        detailDescription: "각 채널의 기본 발신 규칙과 템플릿 연결 상태를 확인하는 영역입니다.",
        checklist: ["기본 채널 활성화 여부", "기본 템플릿 연결", "Fallback 정책"],
      },
      {
        id: "settings-policy",
        label: "발송 정책",
        summary: "발송 가능 시간, 중복 방지 규칙 등을 관리하는 정책 목록입니다.",
        badge: "정책",
        detailTitle: "발송 정책 상세",
        detailDescription: "운영 정책에 따른 발송 제한과 자동화 규칙을 구성하는 상세 영역입니다.",
        checklist: ["발송 허용 시간", "중복/빈도 제한", "예외 처리 기준"],
      },
      {
        id: "settings-alert",
        label: "알림 및 감사",
        summary: "오류 알림, 감사 로그, 운영자 확인 항목을 모아둔 영역입니다.",
        badge: "감사",
        detailTitle: "알림 및 감사 상세",
        detailDescription: "운영자 알림과 설정 변경 기록을 함께 관리하는 상세 영역입니다.",
        checklist: ["오류 알림 수신 대상", "설정 변경 기록", "감사 로그 보관 정책"],
      },
    ],
  },
};

const MESSAGE_HISTORY_STATUS_META: Record<
  MessageHistoryStatus,
  { label: string; icon: typeof CheckCircle2; tone: string }
> = {
  sent: {
    label: "발송 성공",
    icon: CheckCircle2,
    tone: "bg-emerald-50 text-emerald-600",
  },
  failed: {
    label: "발송 실패",
    icon: AlertCircle,
    tone: "bg-red-50 text-red-600",
  },
  pending: {
    label: "재시도 대기",
    icon: Clock3,
    tone: "bg-amber-50 text-amber-600",
  },
};

const MESSAGE_HISTORY_FILTER_META: Record<
  MessageHistoryFilter,
  {
    label: string;
    icon: typeof History;
    badgeTone: string;
    activeClassName: string;
    indicatorClassName: string;
  }
> = {
  all: {
    label: "전체",
    icon: History,
    badgeTone: "bg-v3-primary-light text-v3-primary",
    activeClassName: "text-v3-primary",
    indicatorClassName: "bg-v3-primary",
  },
  sent: {
    label: "성공",
    icon: CheckCircle2,
    badgeTone: "bg-emerald-50 text-emerald-600",
    activeClassName: "text-emerald-600",
    indicatorClassName: "bg-emerald-500",
  },
  pending: {
    label: "대기",
    icon: Clock3,
    badgeTone: "bg-amber-50 text-amber-600",
    activeClassName: "text-amber-600",
    indicatorClassName: "bg-amber-500",
  },
  failed: {
    label: "실패",
    icon: AlertCircle,
    badgeTone: "bg-red-50 text-red-600",
    activeClassName: "text-red-600",
    indicatorClassName: "bg-red-500",
  },
};

const MESSAGE_HISTORY_TABS: {
  value: MessageHistoryFilter;
  label: string;
  activeClassName: string;
  indicatorClassName: string;
}[] = (
  ["all", "sent", "pending", "failed"] as const
).map((value) => {
  const meta = MESSAGE_HISTORY_FILTER_META[value];

  return {
    value,
    label: meta.label,
    activeClassName: meta.activeClassName,
    indicatorClassName: meta.indicatorClassName,
  };
});

const MESSAGE_HISTORY_RELATIVE_DATE_OPTIONS: {
  value: MessageHistoryRelativeDateFilter;
  label: string;
}[] = [
  { value: "all", label: "전체" },
  { value: "1d", label: "1일전" },
  { value: "7d", label: "1주일 전" },
  { value: "30d", label: "한달 전" },
];

const SCHEDULED_PREVIEW_TABS: {
  value: ScheduledPreviewFilter;
  label: string;
}[] = [
  { value: "all", label: "전체" },
  { value: "customer", label: "고객" },
  { value: "staff", label: "직원" },
];

const TEMPLATE_DETAIL_TABS = [
  { key: "details", label: "상세정보" },
  { key: "preview", label: "미리보기" },
];

const BUILTIN_TEMPLATE_SYSTEM_KEYS: Record<BuiltinTemplateType, string> = {
  greeting: "GREETING",
  "service-info": "service_info",
  "price-info": "PRICE_INFO",
  reminder: "REMINDER",
  thanks: "THANKS",
  survey: "SURVEY",
  info: "INFO",
};

const BUILTIN_TEMPLATE_PREVIEW_META: Record<
  BuiltinTemplateType,
  { headline: string; subtitle: string; buttons: string[] }
> = {
  greeting: {
    headline: "등록이 완료되었어요",
    subtitle: "첫 안내 메시지",
    buttons: ["서비스 안내"],
  },
  "service-info": {
    headline: "서비스를 안내드릴게요",
    subtitle: "기본 안내 메시지",
    buttons: ["서비스 보기"],
  },
  "price-info": {
    headline: "이용 요금을 확인해 주세요",
    subtitle: "결제 전 안내",
    buttons: ["결제 안내"],
  },
  reminder: {
    headline: "일정을 다시 안내드려요",
    subtitle: "리마인더 메시지",
    buttons: ["일정 확인"],
  },
  thanks: {
    headline: "서비스 이용에 감사드려요",
    subtitle: "후속 안내 메시지",
    buttons: ["후기 남기기"],
  },
  survey: {
    headline: "만족도 조사를 부탁드려요",
    subtitle: "설문 메시지",
    buttons: ["설문 참여"],
  },
  info: {
    headline: "운영 안내를 확인해 주세요",
    subtitle: "기본 안내 메시지",
    buttons: ["안내 확인"],
  },
};


const HISTORY_EVENT_ICON_BY_TYPE: Record<TriggerEventType, typeof MessageCircle> = {
  CLIENT_CREATED: UserPlus,
  SERVICE_START: CalendarClock,
  SERVICE_END: CalendarRange,
  EMPLOYEE_ASSIGNED: Users,
};

const HISTORY_TEMPLATE_LABELS: Record<TriggerTemplateKey, string> = {
  CLIENT_WELCOME: "고객 등록 안내",
  SERVICE_START_REMINDER: "서비스 시작 리마인드",
  SERVICE_END_REMINDER: "서비스 종료 안내",
  EMPLOYEE_ASSIGNED: "직원 배정 완료",
};

const SCHEDULED_EVENT_LABELS: Record<TriggerEventType, string> = {
  CLIENT_CREATED: "고객 등록",
  SERVICE_START: "서비스 시작",
  SERVICE_END: "서비스 종료",
  EMPLOYEE_ASSIGNED: "직원 배정",
};

const SCHEDULED_VARIABLE_LABELS: Record<string, string> = {
  clientName: "고객명",
  employeeName: "직원명",
  registrationDate: "등록일",
  recipientName: "수신자명",
  serviceEndDate: "서비스 종료일",
  serviceStartDate: "서비스 시작일",
  serviceType: "서비스 유형",
  timingText: "발송 문구",
};

function getMessageHistoryEmptyStateCopy(filter: MessageHistoryFilter, hasSearchQuery: boolean) {
  const copyByFilter: Record<MessageHistoryFilter, { title: string; description: string }> = {
    all: {
      title: "발송 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 필터를 초기화해 주세요."
        : "아직 확인할 발송 기록이 없습니다.",
    },
    sent: {
      title: "성공 발송 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 다른 탭을 선택해 주세요."
        : "정상 발송된 메시지가 아직 없습니다.",
    },
    pending: {
      title: "재시도 대기 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 다른 탭을 선택해 주세요."
        : "실패 후 재시도 대기 중인 메시지가 없습니다.",
    },
    failed: {
      title: "실패 발송 기록이 없습니다.",
      description: hasSearchQuery
        ? "검색어를 바꾸거나 다른 탭을 선택해 주세요."
        : "발송 실패로 남아 있는 메시지가 없습니다.",
    },
  };

  return copyByFilter[filter];
}

function getHistoryTemplateLabel(templateKey: string) {
  return HISTORY_TEMPLATE_LABELS[templateKey as TriggerTemplateKey] ?? templateKey;
}

function getScheduledRecipientBadge(recipientType: TriggerRecipientType) {
  return recipientType === "CLIENT" ? "고객" : "직원";
}

function getScheduledRecipientLabel(recipientType: TriggerRecipientType) {
  if (recipientType === "CLIENT") return "고객";
  if (recipientType === "PRIMARY_EMPLOYEE") return "주 담당 직원";
  return "보조 직원";
}

function getScheduledEventLabel(eventType: TriggerEventType | null) {
  if (!eventType) return "기타 이벤트";
  return SCHEDULED_EVENT_LABELS[eventType];
}

function formatScheduledPreviewDate(dateString: string) {
  return new Date(dateString).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatScheduledDetailDate(dateString: string) {
  return new Date(dateString).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function matchesScheduledJobQuery(job: UpcomingAlimtalkJob, query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return true;

  const digitQuery = trimmedQuery.replace(/\D/g, "");
  const recipientPhone = (job.recipientPhone ?? job.payload.recipientPhone ?? "").replace(/\D/g, "");

  if (digitQuery && recipientPhone.includes(digitQuery)) {
    return true;
  }

  return [
    job.ruleName,
    job.payload.recipientName,
    job.payload.clientName ?? "",
    job.payload.employeeName ?? "",
    getScheduledRecipientBadge(job.recipientType),
    getHistoryTemplateLabel(job.templateKey),
    getScheduledEventLabel(job.eventType),
    formatScheduledPreviewDate(job.scheduledFor),
  ].some((field) => field && matchesKoreanSearch(field, trimmedQuery));
}

function normalizeHistoryRecord(record: ApiAlimtalkHistoryRecord): MessageHistoryRecord {
  const sentAt = record.lastAttemptAt ?? record.updatedAt ?? record.createdAt;
  const status: MessageHistoryStatus =
    record.status === "sent" || record.status === "pending" || record.status === "failed"
      ? record.status
      : "failed";

  return {
    id: record.id,
    title: record.ruleName ?? getHistoryTemplateLabel(record.templateKey),
    templateLabel: getHistoryTemplateLabel(record.templateKey),
    recipientName: record.recipientName ?? record.clientName ?? record.employeeName ?? "-",
    recipientPhone: record.receiver,
    channelLabel: record.provider,
    sentAt,
    status,
    messagePreview: record.messageBody,
    failureReason: record.errorMessage ?? undefined,
    icon: record.eventType ? HISTORY_EVENT_ICON_BY_TYPE[record.eventType] : MessageCircle,
  };
}

const FormComponents: Record<
  BuiltinTemplateType,
  React.ComponentType<{ onPreviewMessageChange?: (message: string) => void }>
> = {
  greeting: GreetingMessageForm,
  "service-info": ServiceInfoMessageForm,
  "price-info": PriceInfoMessageForm,
  reminder: ReminderMessageForm,
  thanks: ThanksMessageForm,
  survey: SurveyMessageForm,
  info: InfoMessageForm,
};

function MessageScheduledSection() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [scheduledFilter, setScheduledFilter] = useState<ScheduledPreviewFilter>("all");
  const [scheduledSearchValue, setScheduledSearchValue] = useState("");
  const deferredScheduledSearchValue = useDeferredValue(scheduledSearchValue);
  const { data: upcomingJobs = [], isLoading } = useUpcomingAlimtalkJobs();

  const filteredJobs = useMemo(() => {
    return upcomingJobs
      .filter((job) => {
        const matchesRecipientType =
          scheduledFilter === "all" ||
          (scheduledFilter === "customer"
            ? job.recipientType === "CLIENT"
            : job.recipientType === "PRIMARY_EMPLOYEE" || job.recipientType === "SECONDARY_EMPLOYEE");

        if (!matchesRecipientType) {
          return false;
        }

        return matchesScheduledJobQuery(job, deferredScheduledSearchValue);
      })
      .sort((left, right) => new Date(left.scheduledFor).getTime() - new Date(right.scheduledFor).getTime());
  }, [deferredScheduledSearchValue, scheduledFilter, upcomingJobs]);

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null;
    return filteredJobs.find((job) => job.id === selectedJobId) ?? null;
  }, [filteredJobs, selectedJobId]);

  const hasScheduledSearchQuery = deferredScheduledSearchValue.trim().length > 0;
  const hasScheduledFilters = scheduledFilter !== "all" || hasScheduledSearchQuery;
  const selectedJobPhone = selectedJob?.recipientPhone ?? selectedJob?.payload.recipientPhone ?? "-";
  const selectedJobVariables = selectedJob ? Object.entries(selectedJob.payload.templateVariables) : [];

  return (
    <div data-component="messages-scheduled-layout" className="flex min-h-[560px] flex-1 flex-col">
      <SplitLayout hasSelection={!!selectedJob} onBack={() => setSelectedJobId(null)}>
        <ListPanel
          title="발송 예정"
          subtitle="발송이 예정된 메시지를 확인할 수 있어요."
          tabs={SCHEDULED_PREVIEW_TABS}
          activeTab={scheduledFilter}
          onTabChange={(value) => {
            setScheduledFilter(value as ScheduledPreviewFilter);
            setSelectedJobId(null);
          }}
          searchValue={scheduledSearchValue}
          onSearchChange={(value) => {
            setScheduledSearchValue(value);
            setSelectedJobId(null);
          }}
          searchPlaceholder="이름, 연락처, 템플릿 검색..."
          headerActions={
            <span
              data-component="messages-scheduled-list-badge"
              className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
            >
              {(hasScheduledFilters ? filteredJobs.length : upcomingJobs.length)}개
            </span>
          }
          overlay={
            !isLoading && filteredJobs.length === 0 ? (
              <ListEmptyState
                name="messages-scheduled-list-empty"
                message={
                  hasScheduledFilters ? "조건에 맞는 예약 발송 항목이 없습니다." : "발송 예정 항목이 없습니다."
                }
                className="flex-none min-h-0"
              />
            ) : null
          }
        >
          {(isLoading || filteredJobs.length > 0) ? (
            <div data-component="messages-scheduled-list" className="space-y-3 pb-2">
              <AnimatedSlotList<UpcomingAlimtalkJob>
                items={filteredJobs}
                isLoading={isLoading}
                loadingCount={5}
                className="space-y-2"
                itemDataComponent="messages-scheduled-list-item"
                slotClassName={({ item, isLoading: slotLoading }) =>
                  cn(
                    "rounded-[18px] border-2 p-4 text-left transition-all duration-200",
                    !slotLoading && item?.id === selectedJobId
                      ? "border-v3-primary bg-v3-primary-light"
                      : "border-v3-border/70 bg-white hover:border-v3-primary/30 hover:bg-v3-primary-light/40",
                    !slotLoading && "cursor-pointer",
                  )
                }
                onSlotClick={(item) => setSelectedJobId(item.id)}
                render={({ item, isLoading: slotLoading }) => {
                  if (slotLoading) {
                    return (
                      <div data-component="messages-scheduled-list-item-body" className="flex items-start gap-3">
                        <div
                          data-component="messages-scheduled-list-item-icon"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-primary"
                        >
                          <Skeleton className="h-4 w-4 rounded-md bg-white/80" />
                        </div>
                        <div
                          data-component="messages-scheduled-list-item-copy"
                          className="min-w-0 flex-1 space-y-2"
                        >
                          <Skeleton className="h-4 w-28 bg-v3-dim-white" />
                          <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                        </div>
                      </div>
                    );
                  }

                  if (!item) return null;

                  return (
                    <div data-component="messages-scheduled-list-item-body" className="flex items-start gap-3">
                      <div
                        data-component="messages-scheduled-list-item-icon"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-primary"
                      >
                        <Clock3 className="h-4 w-4" />
                      </div>
                      <div data-component="messages-scheduled-list-item-copy" className="min-w-0 flex-1">
                        <div
                          data-component="messages-scheduled-list-item-meta"
                          className="flex items-center gap-2"
                        >
                          <p className="truncate text-[0.82rem] font-semibold text-v3-dark">
                            {item.payload.recipientName || "-"}
                          </p>
                          <span
                            data-component="messages-scheduled-list-item-badge"
                            className="inline-flex shrink-0 items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.66rem] font-semibold text-v3-primary"
                          >
                            {getScheduledRecipientBadge(item.recipientType)}
                          </span>
                        </div>
                        <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">
                          {`${getHistoryTemplateLabel(item.templateKey)} · ${formatScheduledPreviewDate(item.scheduledFor)}`}
                        </p>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          ) : null}
        </ListPanel>

        <DetailPanel
          avatar={
            <div
              data-component="messages-scheduled-detail-avatar"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
            >
              <Clock3 className="h-5 w-5" />
            </div>
          }
          title={selectedJob ? `${selectedJob.payload.recipientName || "수신자"} 예약 발송` : "발송 상세"}
          subtitle={
            selectedJob
              ? `${getHistoryTemplateLabel(selectedJob.templateKey)} · ${selectedJobPhone}`
              : "발송 예정 메시지를 선택하면 상세 정보가 표시됩니다."
          }
          badges={
            selectedJob ? (
              <span
                data-component="messages-scheduled-detail-status"
                className="rounded-full bg-emerald-500/10 px-3 py-1 text-[0.7rem] font-semibold text-emerald-600"
              >
                발송 예정
              </span>
            ) : null
          }
          trailing={
            selectedJob ? (
              <div
                data-component="messages-scheduled-detail-scheduled-at"
                className="inline-flex items-center gap-1 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {formatScheduledPreviewDate(selectedJob.scheduledFor)}
              </div>
            ) : null
          }
          emptyState={
            !isLoading && !selectedJob ? (
              <DetailEmptyState
                name="messages-scheduled-detail-empty"
                icon={Users}
                message={
                  filteredJobs.length === 0 && hasScheduledFilters
                    ? "조건에 맞는 예약 발송 항목이 없습니다."
                    : "발송 예정 메시지를 선택하면 상세 정보가 표시됩니다."
                }
                className="flex-none min-h-0"
              />
            ) : undefined
          }
        >
          {isLoading ? (
            <div data-component="messages-scheduled-detail-skeleton" className="space-y-4">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  data-component="messages-scheduled-detail-skeleton-card"
                  className="rounded-[18px] bg-v3-dim-white p-4"
                >
                  <Skeleton className="h-4 w-24 bg-white/80" />
                  <div data-component="messages-scheduled-detail-skeleton-lines" className="mt-4 space-y-3">
                    <Skeleton className="h-4 w-full bg-white/80" />
                    <Skeleton className="h-4 w-5/6 bg-white/80" />
                    <Skeleton className="h-4 w-2/3 bg-white/80" />
                  </div>
                </div>
              ))}
            </div>
          ) : selectedJob ? (
            <div data-component="messages-scheduled-detail" className="space-y-4">
              <div
                data-component="messages-scheduled-detail-overview"
                className="rounded-[20px] border border-v3-border bg-v3-dim-white/30 p-5"
              >
                <p className="text-[0.72rem] font-semibold text-v3-primary">예약 개요</p>
                <p className="mt-2 text-[0.9rem] font-bold text-v3-dark">{selectedJob.ruleName}</p>
                <p className="mt-2 text-[0.82rem] leading-6 text-v3-text-muted">
                  {`${selectedJob.payload.recipientName}님에게 ${formatScheduledDetailDate(selectedJob.scheduledFor)}에 ${getHistoryTemplateLabel(selectedJob.templateKey)} 템플릿이 발송될 예정입니다.`}
                </p>
                <p className="mt-3 text-[0.74rem] leading-6 text-v3-text-muted">
                  현재 API에서는 예약 건의 최종 메시지 본문 원문을 내려주지 않아, 이 화면에서는 수신자 정보와 템플릿 변수만 표시합니다.
                </p>
              </div>

              <div
                data-component="messages-scheduled-detail-grid"
                className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              >
                <div
                  data-component="messages-scheduled-detail-meta"
                  className="rounded-[20px] border border-v3-border bg-white p-5"
                >
                  <h3 className="text-[0.85rem] font-bold text-v3-dark">메시지 정보</h3>
                  <div data-component="messages-scheduled-detail-meta-list" className="mt-4 space-y-3">
                    <div
                      data-component="messages-scheduled-detail-meta-item"
                      className="flex items-center justify-between gap-3 text-[0.78rem]"
                    >
                      <span className="text-v3-text-muted">수신자 이름</span>
                      <span className="font-semibold text-v3-dark">{selectedJob.payload.recipientName || "-"}</span>
                    </div>
                    <div
                      data-component="messages-scheduled-detail-meta-item"
                      className="flex items-center justify-between gap-3 text-[0.78rem]"
                    >
                      <span className="text-v3-text-muted">전화번호</span>
                      <span className="font-semibold text-v3-dark">{selectedJobPhone}</span>
                    </div>
                    <div
                      data-component="messages-scheduled-detail-meta-item"
                      className="flex items-center justify-between gap-3 text-[0.78rem]"
                    >
                      <span className="text-v3-text-muted">발신 예정 시간</span>
                      <span className="font-semibold text-v3-dark">{formatScheduledDetailDate(selectedJob.scheduledFor)}</span>
                    </div>
                    <div
                      data-component="messages-scheduled-detail-meta-item"
                      className="flex items-center justify-between gap-3 text-[0.78rem]"
                    >
                      <span className="text-v3-text-muted">메시지 템플릿 이름</span>
                      <span className="font-semibold text-v3-dark">{getHistoryTemplateLabel(selectedJob.templateKey)}</span>
                    </div>
                    <div
                      data-component="messages-scheduled-detail-meta-item"
                      className="flex items-center justify-between gap-3 text-[0.78rem]"
                    >
                      <span className="text-v3-text-muted">발송 규칙명</span>
                      <span className="font-semibold text-v3-dark">{selectedJob.ruleName}</span>
                    </div>
                    <div
                      data-component="messages-scheduled-detail-meta-item"
                      className="flex items-center justify-between gap-3 text-[0.78rem]"
                    >
                      <span className="text-v3-text-muted">수신 유형</span>
                      <span className="font-semibold text-v3-dark">{getScheduledRecipientLabel(selectedJob.recipientType)}</span>
                    </div>
                    <div
                      data-component="messages-scheduled-detail-meta-item"
                      className="flex items-center justify-between gap-3 text-[0.78rem]"
                    >
                      <span className="text-v3-text-muted">이벤트 기준</span>
                      <span className="font-semibold text-v3-dark">{getScheduledEventLabel(selectedJob.eventType)}</span>
                    </div>
                  </div>
                </div>

                <div
                  data-component="messages-scheduled-detail-variables"
                  className="rounded-[20px] border border-v3-border bg-white p-5"
                >
                  <h3 className="text-[0.85rem] font-bold text-v3-dark">변수</h3>
                  <div data-component="messages-scheduled-detail-variables-body" className="mt-4">
                    {selectedJobVariables.length > 0 ? (
                      <div
                        data-component="messages-scheduled-detail-variable-list"
                        className="space-y-3"
                      >
                        {selectedJobVariables.map(([key, value]) => (
                          <div
                            key={`${selectedJob.id}-${key}`}
                            data-component="messages-scheduled-detail-variable-item"
                            className="rounded-[16px] border border-v3-border bg-v3-dim-white/30 px-4 py-3"
                          >
                            <div
                              data-component="messages-scheduled-detail-variable-meta"
                              className="flex flex-wrap items-center gap-2"
                            >
                              <span
                                data-component="messages-scheduled-detail-variable-token"
                                className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
                              >
                                {key}
                              </span>
                              <span
                                data-component="messages-scheduled-detail-variable-label"
                                className="text-[0.72rem] text-v3-text-muted"
                              >
                                {SCHEDULED_VARIABLE_LABELS[key] ?? key}
                              </span>
                            </div>
                            <p
                              data-component="messages-scheduled-detail-variable-value"
                              className="mt-2 text-[0.8rem] font-semibold text-v3-dark"
                            >
                              {value || "-"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[0.75rem] text-v3-text-muted">변수 정보가 없습니다.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DetailPanel>
      </SplitLayout>
    </div>
  );
}

function MessageSectionPlaceholder({ sectionId }: { sectionId: PlaceholderSectionId }) {
  const section = MESSAGE_SECTIONS.find((item) => item.id === sectionId);
  const copy = PLACEHOLDER_COPY[sectionId];
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [scheduledFilter, setScheduledFilter] = useState<ScheduledPreviewFilter>("all");
  const [scheduledSearchValue, setScheduledSearchValue] = useState("");
  const isScheduledSection = sectionId === "scheduled";
  const deferredScheduledSearchValue = useDeferredValue(scheduledSearchValue);
  const filteredPreviewItems = useMemo(() => {
    if (!isScheduledSection) return copy.items;

    return copy.items.filter((item) => {
      const matchesRecipientType =
        scheduledFilter === "all" ||
        (scheduledFilter === "customer" ? item.recipientType === "고객" : item.recipientType === "직원");

      if (!matchesRecipientType) {
        return false;
      }

      const trimmedQuery = deferredScheduledSearchValue.trim().toLowerCase();
      if (!trimmedQuery) {
        return true;
      }

      const digitQuery = trimmedQuery.replace(/\D/g, "");
      const recipientDigits = (item.recipientPhone ?? "").replace(/\D/g, "");
      if (digitQuery && recipientDigits.includes(digitQuery)) {
        return true;
      }

      return [
        item.recipientName ?? item.label,
        item.recipientType ?? item.badge,
        item.recipientPhone ?? "",
        item.templateTitle ?? "",
        item.scheduledAt ?? "",
        item.summary,
        item.detailTitle,
        item.detailDescription,
        item.messageBody ?? "",
      ].some((field) => field.toLowerCase().includes(trimmedQuery));
    });
  }, [copy.items, deferredScheduledSearchValue, isScheduledSection, scheduledFilter]);
  const selectedPreview = filteredPreviewItems.find((item) => item.id === selectedPreviewId) ?? null;
  const hasScheduledSearchQuery = deferredScheduledSearchValue.trim().length > 0;
  const hasScheduledFilters = scheduledFilter !== "all" || hasScheduledSearchQuery;

  if (!section) return null;

  const Icon = section.icon;
  const detailSubtitle = isScheduledSection
    ? selectedPreview
      ? `${selectedPreview.templateTitle ?? "메시지"} · ${selectedPreview.recipientPhone ?? "연락처 미정"}`
      : "왼쪽 목록에서 발송 예정 메시지를 선택해 주세요."
    : selectedPreview?.detailDescription ?? "왼쪽 목록에서 미리보기 항목을 선택하면 이 영역에 상세 구성 가이드가 표시됩니다.";

  return (
    <div data-component="messages-section-placeholder-layout" className="flex min-h-[560px] flex-1 flex-col">
      <SplitLayout hasSelection={!!selectedPreview} onBack={() => setSelectedPreviewId(null)}>
        <ListPanel
          title={section.label}
          subtitle={copy.description}
          tabs={isScheduledSection ? SCHEDULED_PREVIEW_TABS : undefined}
          activeTab={isScheduledSection ? scheduledFilter : undefined}
          onTabChange={
            isScheduledSection
              ? (value) => {
                  setScheduledFilter(value as ScheduledPreviewFilter);
                  setSelectedPreviewId(null);
                }
              : undefined
          }
          searchValue={isScheduledSection ? scheduledSearchValue : undefined}
          onSearchChange={
            isScheduledSection
              ? (value) => {
                  setScheduledSearchValue(value);
                  setSelectedPreviewId(null);
                }
              : undefined
          }
          searchPlaceholder={isScheduledSection ? "이름, 연락처, 템플릿 검색..." : undefined}
          headerActions={
            <span
              data-component="messages-section-placeholder-list-badge"
              className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
            >
              {(isScheduledSection ? filteredPreviewItems.length : copy.items.length)}개
            </span>
          }
          overlay={
            filteredPreviewItems.length === 0 ? (
              <ListEmptyState
                name="messages-section-placeholder-list-empty"
                message={
                  hasScheduledFilters ? "조건에 맞는 예약 발송 항목이 없습니다." : "발송 예정 항목이 없습니다."
                }
                className="flex-none min-h-0"
              />
            ) : null
          }
        >
          {filteredPreviewItems.length > 0 ? (
            <div data-component="messages-section-placeholder-list" className="space-y-3 pb-2">
              <AnimatedSlotList<PlaceholderPreviewItem>
                items={filteredPreviewItems}
                isLoading={false}
                className="space-y-2"
                itemDataComponent="messages-section-placeholder-list-item"
                slotClassName={({ item }) =>
                  cn(
                    "rounded-[18px] border-2 p-4 text-left transition-all duration-200",
                    item?.id === selectedPreviewId
                      ? "border-v3-primary bg-v3-primary-light"
                      : "border-v3-border/70 bg-white hover:border-v3-primary/30 hover:bg-v3-primary-light/40",
                    "cursor-pointer"
                  )
                }
                onSlotClick={(item) => {
                  setSelectedPreviewId(item.id);
                }}
                render={({ item }) => {
                  if (!item) return null;

                  const title = item.recipientName ?? item.label;
                  const badge = item.recipientType ?? item.badge;
                  const summary = item.templateTitle && item.scheduledAt
                    ? `${item.templateTitle} · ${item.scheduledAt}`
                    : item.summary;

                  return (
                    <div data-component="messages-section-placeholder-list-item-body" className="flex items-start gap-3">
                      <div
                        data-component="messages-section-placeholder-list-item-icon"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-primary"
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div
                        data-component="messages-section-placeholder-list-item-copy"
                        className="min-w-0 flex-1"
                      >
                        <div
                          data-component="messages-section-placeholder-list-item-meta"
                          className="flex items-center gap-2"
                        >
                          <p className="truncate text-[0.82rem] font-semibold text-v3-dark">{title}</p>
                          <span
                            data-component="messages-section-placeholder-list-item-badge"
                            className="inline-flex shrink-0 items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.66rem] font-semibold text-v3-primary"
                          >
                            {badge}
                          </span>
                        </div>
                        <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">{summary}</p>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          ) : null}
        </ListPanel>

        <DetailPanel
          avatar={
            <div
              data-component="messages-section-placeholder-detail-avatar"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
            >
              <Icon className="h-5 w-5" />
            </div>
          }
          title={selectedPreview?.detailTitle ?? `${section.label} 상세`}
          subtitle={detailSubtitle}
          badges={
            isScheduledSection && selectedPreview ? (
              <span
                data-component="messages-section-placeholder-detail-status"
                className="rounded-full bg-emerald-500/10 px-3 py-1 text-[0.7rem] font-semibold text-emerald-600"
              >
                발송 예정
              </span>
            ) : null
          }
          trailing={
            isScheduledSection && selectedPreview?.scheduledAt ? (
              <div
                data-component="messages-section-placeholder-detail-scheduled-at"
                className="inline-flex items-center gap-1 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                {selectedPreview.scheduledAt}
              </div>
            ) : null
          }
          emptyState={
            isScheduledSection && !selectedPreview ? (
              <DetailEmptyState
                name="messages-section-placeholder-scheduled-detail-empty"
                icon={Users}
                message={
                  filteredPreviewItems.length === 0 && hasScheduledFilters
                    ? "조건에 맞는 예약 발송 항목이 없습니다."
                    : "발송 예정 메시지를 선택하면 상세 정보가 표시됩니다."
                }
                className="flex-none min-h-0"
              />
            ) : undefined
          }
        >
          {selectedPreview ? (
            isScheduledSection ? (
              <div data-component="messages-section-placeholder-detail" className="space-y-4">
                <div
                  data-component="messages-section-placeholder-scheduled-detail-grid"
                  className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
                >
                  <div
                    data-component="messages-section-placeholder-scheduled-detail-content"
                    className="flex flex-col rounded-[20px] border border-v3-border bg-v3-dim-white/30 p-5 xl:row-span-2"
                  >
                    <div
                      data-component="messages-section-placeholder-scheduled-detail-content-header"
                      className="mb-4"
                    >
                      <div data-component="messages-section-placeholder-scheduled-detail-content-title">
                        <h3 className="text-[0.9rem] font-bold text-v3-dark">메시지 본문</h3>
                      </div>
                    </div>

                    <div
                      data-component="messages-section-placeholder-scheduled-detail-content-body"
                      className="flex min-h-[240px] flex-1 rounded-[18px] border border-v3-border bg-white p-4"
                    >
                      <pre
                        data-component="messages-section-placeholder-scheduled-detail-content-text"
                        className="whitespace-pre-wrap font-sans text-[0.78rem] leading-relaxed text-v3-dark"
                      >
                        {selectedPreview.messageBody ?? selectedPreview.detailDescription}
                      </pre>
                    </div>
                  </div>

                  <div
                    data-component="messages-section-placeholder-scheduled-detail-meta"
                    className="flex flex-col rounded-[20px] border border-v3-border bg-white p-5"
                  >
                    <h3 className="text-[0.85rem] font-bold text-v3-dark">메시지 정보</h3>
                    <div
                      data-component="messages-section-placeholder-scheduled-detail-meta-list"
                      className="mt-4 space-y-3"
                    >
                      <div
                        data-component="messages-section-placeholder-scheduled-detail-meta-item"
                        className="flex items-center justify-between gap-3 text-[0.78rem]"
                      >
                        <span className="text-v3-text-muted">수신자 이름</span>
                        <span className="font-semibold text-v3-dark">{selectedPreview.recipientName ?? "-"}</span>
                      </div>
                      <div
                        data-component="messages-section-placeholder-scheduled-detail-meta-item"
                        className="flex items-center justify-between gap-3 text-[0.78rem]"
                      >
                        <span className="text-v3-text-muted">전화번호</span>
                        <span className="font-semibold text-v3-dark">{selectedPreview.recipientPhone ?? "-"}</span>
                      </div>
                      <div
                        data-component="messages-section-placeholder-scheduled-detail-meta-item"
                        className="flex items-center justify-between gap-3 text-[0.78rem]"
                      >
                        <span className="text-v3-text-muted">발신 예정 시간</span>
                        <span className="font-semibold text-v3-dark">{selectedPreview.scheduledAt ?? "-"}</span>
                      </div>
                      <div
                        data-component="messages-section-placeholder-scheduled-detail-meta-item"
                        className="flex items-center justify-between gap-3 text-[0.78rem]"
                      >
                        <span className="text-v3-text-muted">메시지 템플릿 이름</span>
                        <span className="font-semibold text-v3-dark">{selectedPreview.templateTitle ?? "-"}</span>
                      </div>
                    </div>
                  </div>

                  <div
                    data-component="messages-section-placeholder-scheduled-detail-variables"
                    className="flex flex-col rounded-[20px] border border-v3-border bg-white p-5"
                  >
                    <h3 className="text-[0.85rem] font-bold text-v3-dark">변수</h3>
                    <div
                      data-component="messages-section-placeholder-scheduled-detail-variables-body"
                      className="mt-4 flex-1"
                    >
                      {selectedPreview.variableAssignments?.length ? (
                        <div
                          data-component="messages-section-placeholder-scheduled-detail-variable-list"
                          className="space-y-3"
                        >
                          {selectedPreview.variableAssignments.map((variable) => (
                            <div
                              key={`${selectedPreview.id}-${variable.token}`}
                              data-component="messages-section-placeholder-scheduled-detail-variable-item"
                              className="rounded-[16px] border border-v3-border bg-v3-dim-white/30 px-4 py-3"
                            >
                              <div
                                data-component="messages-section-placeholder-scheduled-detail-variable-meta"
                                className="flex flex-wrap items-center gap-2"
                              >
                                <span
                                  data-component="messages-section-placeholder-scheduled-detail-variable-token"
                                  className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
                                >
                                  {variable.token}
                                </span>
                                <span
                                  data-component="messages-section-placeholder-scheduled-detail-variable-label"
                                  className="text-[0.72rem] text-v3-text-muted"
                                >
                                  {variable.label}
                                </span>
                              </div>
                              <p
                                data-component="messages-section-placeholder-scheduled-detail-variable-value"
                                className="mt-2 text-[0.8rem] font-semibold text-v3-dark"
                              >
                                {variable.value}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[0.75rem] text-v3-text-muted">변수 정보가 없습니다.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div data-component="messages-section-placeholder-detail" className="space-y-4">
                <div
                  data-component="messages-section-placeholder-detail-overview"
                  className="rounded-[20px] bg-v3-dim-white p-5"
                >
                  <p className="text-[0.72rem] font-semibold text-v3-primary">연결 예정 콘텐츠</p>
                  <p className="mt-2 text-sm font-semibold text-v3-dark">{selectedPreview.detailTitle}</p>
                  <p className="mt-2 text-[0.82rem] leading-6 text-v3-text-muted">
                    {selectedPreview.detailDescription}
                  </p>
                </div>

                <div
                  data-component="messages-section-placeholder-detail-checklist"
                  className="rounded-[20px] bg-v3-dim-white p-5"
                >
                  <p className="text-[0.72rem] font-semibold text-v3-primary">구성 제안</p>
                  <div
                    data-component="messages-section-placeholder-detail-checklist-items"
                    className="mt-4 space-y-3"
                  >
                    {selectedPreview.checklist.map((item) => (
                      <div
                        key={item}
                        data-component="messages-section-placeholder-detail-checklist-item"
                        className="flex items-center gap-3 rounded-[16px] bg-white px-4 py-3"
                      >
                        <div
                          data-component="messages-section-placeholder-detail-checklist-marker"
                          className="h-2.5 w-2.5 rounded-full bg-v3-primary"
                        />
                        <p className="text-[0.78rem] text-v3-dark">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          ) : isScheduledSection ? null : (
            <div data-component="messages-section-placeholder-detail-empty" className="space-y-4">
              <div
                data-component="messages-section-placeholder-detail-empty-grid"
                className="grid gap-3 sm:grid-cols-2"
              >
                {copy.items.slice(0, 2).map((item) => (
                  <div
                    key={item.id}
                    data-component="messages-section-placeholder-detail-empty-grid-item"
                    className="rounded-[18px] border border-dashed border-v3-border bg-white px-4 py-4"
                  >
                    <p className="text-[0.76rem] font-semibold text-v3-dark">{item.label}</p>
                    <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">{item.summary}</p>
                  </div>
                ))}
              </div>

              <div
                data-component="messages-section-placeholder-detail-empty-note"
                className="rounded-[20px] border border-dashed border-v3-border bg-white/90 p-5"
              >
                <p className="text-[0.78rem] leading-6 text-v3-text-muted">
                  목록 패널과 상세 패널이 연결된 상태로 준비되어 있으므로, 실제 데이터 목록 컴포넌트를 붙이면 이 구조를 그대로 확장할 수 있습니다.
                </p>
              </div>
            </div>
          )}
        </DetailPanel>
      </SplitLayout>
    </div>
  );
}

function formatHistoryDate(dateString: string) {
  return new Date(dateString).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function matchesHistoryQuery(record: MessageHistoryRecord, query: string) {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) return true;

  const digitQuery = trimmedQuery.replace(/\D/g, "");
  const recipientDigits = record.recipientPhone.replace(/\D/g, "");
  if (digitQuery && recipientDigits.includes(digitQuery)) {
    return true;
  }

  return [
    record.title,
    record.templateLabel,
    record.recipientName,
    record.recipientPhone,
    record.channelLabel,
    record.messagePreview,
    record.failureReason ?? "",
  ].some((field) => field.toLowerCase().includes(trimmedQuery));
}

function matchesHistoryDate(sentAt: string, dateFilter: string) {
  const targetDate = new Date(sentAt);
  if (Number.isNaN(targetDate.getTime())) return true;
  const y = targetDate.getFullYear();
  const m = String(targetDate.getMonth() + 1).padStart(2, "0");
  const d = String(targetDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}` === dateFilter;
}

function matchesHistoryRelativeDate(sentAt: string, relativeDateFilter: MessageHistoryRelativeDateFilter) {
  if (relativeDateFilter === "all") return true;

  const targetDate = new Date(sentAt);
  if (Number.isNaN(targetDate.getTime())) return true;

  const days = relativeDateFilter === "1d" ? 1 : relativeDateFilter === "7d" ? 7 : 30;
  const threshold = new Date();
  threshold.setHours(0, 0, 0, 0);
  threshold.setDate(threshold.getDate() - days);

  return targetDate >= threshold;
}

function MessageHistorySection() {
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState<MessageHistoryFilter>("all");
  const [relativeDateFilter, setRelativeDateFilter] = useState<MessageHistoryRelativeDateFilter>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [isRetrying, setIsRetrying] = useState(false);
  const deferredSearchValue = useDeferredValue(searchValue);
  const { data: historyData = [], isLoading, isError } = useAlimtalkHistory();
  const { toast } = useToast();
  const historyRecords = useMemo(
    () => historyData.map((record) => normalizeHistoryRecord(record)),
    [historyData]
  );
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(
    historyRecords[0]?.id ?? null
  );
  const isMobile = useIsMobile();

  const filteredRecords = useMemo(
    () =>
      historyRecords.filter((record) => {
        const matchesStatus = statusFilter === "all" || record.status === statusFilter;
        const matchesRelativeDate = matchesHistoryRelativeDate(record.sentAt, relativeDateFilter);
        const matchesDate = !dateFilter || matchesHistoryDate(record.sentAt, dateFilter);
        return matchesStatus && matchesRelativeDate && matchesDate && matchesHistoryQuery(record, deferredSearchValue);
      }),
    [dateFilter, deferredSearchValue, historyRecords, relativeDateFilter, statusFilter]
  );

  const emptyStateCopy = getMessageHistoryEmptyStateCopy(
    statusFilter,
    deferredSearchValue.trim().length > 0
  );
  const activeFilterMeta = MESSAGE_HISTORY_FILTER_META[statusFilter];

  const selectedRecord = useMemo(() => {
    if (filteredRecords.length === 0) {
      return null;
    }

    if (selectedRecordId !== null) {
      const matchedRecord = filteredRecords.find((record) => record.id === selectedRecordId);
      if (matchedRecord) {
        return matchedRecord;
      }
    }

    if (isMobile) {
      return null;
    }

    return filteredRecords[0];
  }, [filteredRecords, isMobile, selectedRecordId]);

  const canRetry = !!selectedRecord && selectedRecord.status !== "sent";

  const handleRetry = useCallback(async () => {
    if (!selectedRecord) return;

    setIsRetrying(true);
    try {
      await messageDeliveryApi.sendSms({
        receiver: selectedRecord.recipientPhone,
        recipientName: selectedRecord.recipientName,
        message: selectedRecord.messagePreview,
        msgType: "AUTO",
      });

      toast({ description: "재발송 요청을 전송했습니다." });
    } catch (error) {
      toast({
        variant: "destructive",
        description: error instanceof Error ? error.message : "재발송 요청 중 오류가 발생했습니다.",
      });
    } finally {
      setIsRetrying(false);
    }
  }, [selectedRecord, toast]);

  return (
    <SplitLayout hasSelection={!!selectedRecord} onBack={() => setSelectedRecordId(null)}>
      <ListPanel
        title="발송 기록"
        subtitle="발송된 메시지 기록을 볼 수 있어요."
        overlay={
          !isLoading && filteredRecords.length === 0 ? (
            <ListEmptyState
              name="messages-history-list-empty"
              message={emptyStateCopy.title}
              className="flex-none min-h-0"
            />
          ) : null
        }
        tabs={MESSAGE_HISTORY_TABS}
        activeTab={statusFilter}
        onTabChange={(value) => {
          setStatusFilter(value as MessageHistoryFilter);
          setSelectedRecordId(null);
        }}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="고객명, 연락처, 템플릿, 내용 검색..."
        headerActions={
          <span
            data-component="messages-history-list-count"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.72rem] font-semibold",
              activeFilterMeta.badgeTone
            )}
          >
            <activeFilterMeta.icon className="h-3.5 w-3.5" />
            {filteredRecords.length}건
          </span>
        }
        subHeader={
          !isError ? (
            <div data-component="messages-history-list-filters" className="flex items-center gap-2">
              <div data-component="messages-history-list-filter-relative" className="w-[110px] shrink-0">
                <Select value={relativeDateFilter} onValueChange={(value) => setRelativeDateFilter(value as MessageHistoryRelativeDateFilter)}>
                  <SelectTrigger
                    size="sm"
                    data-component="messages-history-list-filter-relative-trigger"
                    className="w-full"
                  >
                    <SelectValue placeholder="기간 선택" />
                  </SelectTrigger>
                  <SelectContent data-component="messages-history-list-filter-relative-content">
                    {MESSAGE_HISTORY_RELATIVE_DATE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <input
                data-component="messages-history-list-filter-date"
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="h-8 flex-1 rounded-[10px] border border-v3-border bg-white px-3 text-[0.76rem] text-v3-dark shadow-xs outline-none focus:border-v3-primary focus:ring-1 focus:ring-v3-primary/30"
              />
              {(dateFilter || relativeDateFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFilter("");
                    setRelativeDateFilter("all");
                  }}
                  className="shrink-0 rounded-[8px] px-2 py-1 text-[0.72rem] font-medium text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-dark"
                >
                  초기화
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {isError ? (
          <div
            data-component="messages-history-list-error"
            className="rounded-[18px] border border-red-200 bg-red-50 p-6 text-center"
          >
            <p className="text-sm font-semibold text-red-700">발송 기록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-[0.8rem] text-red-600">잠시 후 다시 시도해 주세요.</p>
          </div>
        ) : !isLoading && filteredRecords.length === 0 ? (
          null
        ) : (
          <>
            <AnimatedSlotList<MessageHistoryRecord>
              items={filteredRecords}
              isLoading={isLoading}
              loadingCount={4}
              className="space-y-2"
              slotClassName={({ item, isLoading: slotLoading }) => {
                const isActive = !slotLoading && item && item.id === selectedRecord?.id;
                return cn(
                  "flex items-center gap-2.5 rounded-[16px] border-2 border-transparent bg-white p-3 text-left transition-all duration-200",
                  !slotLoading && "cursor-pointer",
                  isActive
                    ? "border-v3-primary bg-v3-primary-light"
                    : !slotLoading && "hover:border-v3-primary/30 hover:bg-v3-primary-light/50"
                );
              }}
              onSlotClick={(record) => setSelectedRecordId(record.id)}
              render={({ item: record, isLoading: slotLoading }) => {
                if (slotLoading) {
                  return (
                    <>
                      <div
                        data-component="messages-history-list-skeleton-icon"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                      >
                        <Skeleton className="h-4 w-4 rounded-md bg-white/80" />
                      </div>
                      <div data-component="messages-history-list-skeleton-copy" className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-36 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-44 bg-v3-dim-white" />
                      </div>
                    </>
                  );
                }

                if (!record) return null;
                const statusMeta = MESSAGE_HISTORY_STATUS_META[record.status];
                const ItemIcon = record.icon;

                return (
                  <>
                    <div
                      data-component="messages-history-list-item-icon"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white text-v3-primary"
                    >
                      <ItemIcon className="h-4 w-4" />
                    </div>

                    <div data-component="messages-history-list-item-copy" className="min-w-0 flex-1">
                      <p className="truncate text-[0.82rem] font-semibold text-v3-dark">{record.title}</p>
                      <p className="mt-0.5 truncate text-[0.72rem] text-v3-text-muted">
                        {record.recipientName} · {record.recipientPhone} · {formatHistoryDate(record.sentAt)}
                      </p>
                    </div>

                    <span
                      data-component="messages-history-list-item-status"
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.64rem] font-semibold",
                        statusMeta.tone
                      )}
                    >
                      {statusMeta.label}
                    </span>
                  </>
                );
              }}
            />
          </>
        )}
      </ListPanel>

      <DetailPanel
        overlay={
          !selectedRecord ? (
            <ListEmptyState
              name="messages-history-detail-empty"
              icon={Users}
              message="발송 기록을 선택하면 상세 정보가 표시됩니다."
              className="flex-none min-h-0"
            />
          ) : null
        }
        avatar={
          <div
            data-component="messages-history-detail-avatar"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
          >
            <History className="h-5 w-5" />
          </div>
        }
        title={selectedRecord?.title ?? "발송 상세"}
        subtitle={
          selectedRecord
            ? `${selectedRecord.channelLabel} · ${formatHistoryDate(selectedRecord.sentAt)}`
            : "왼쪽 목록에서 발송 기록을 선택해 주세요."
        }
        badges={
          selectedRecord ? (
            <span
              data-component="messages-history-detail-status"
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.68rem] font-semibold",
                MESSAGE_HISTORY_STATUS_META[selectedRecord.status].tone
              )}
            >
              {(() => {
                const StatusIcon = MESSAGE_HISTORY_STATUS_META[selectedRecord.status].icon;
                return <StatusIcon className="h-3.5 w-3.5" />;
              })()}
              {MESSAGE_HISTORY_STATUS_META[selectedRecord.status].label}
            </span>
          ) : null
        }
        trailing={
          canRetry ? (
            <Button
              data-component="messages-history-detail-retry"
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRetry}
              disabled={isRetrying}
              className="rounded-full"
            >
              <RotateCcw className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")} />
              {isRetrying ? "재시도 중" : "재발송"}
            </Button>
          ) : null
        }
      >
        {!selectedRecord ? null : (
          <div data-component="messages-history-detail-content" className="space-y-4">
            <div
              data-component="messages-history-detail-preview-card"
              className="rounded-[18px] border border-v3-border bg-v3-dim-white/30 p-4"
            >
              <p className="text-[0.75rem] font-semibold text-v3-text-muted">메시지 내용</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-v3-dark">{selectedRecord.messagePreview}</p>
            </div>

            <div data-component="messages-history-detail-meta-grid" className="grid gap-3 sm:grid-cols-2">
              <div
                data-component="messages-history-detail-meta-recipient"
                className="rounded-[16px] border border-v3-border bg-white p-4"
              >
                <p className="text-[0.72rem] font-semibold text-v3-text-muted">수신자</p>
                <p className="mt-2 text-sm font-semibold text-v3-dark">{selectedRecord.recipientName}</p>
                <p className="mt-1 text-[0.8rem] text-v3-text-muted">{selectedRecord.recipientPhone}</p>
              </div>

              <div
                data-component="messages-history-detail-meta-template"
                className="rounded-[16px] border border-v3-border bg-white p-4"
              >
                <p className="text-[0.72rem] font-semibold text-v3-text-muted">템플릿</p>
                <p className="mt-2 text-sm font-semibold text-v3-dark">{selectedRecord.templateLabel}</p>
                <p className="mt-1 text-[0.8rem] text-v3-text-muted">채널: {selectedRecord.channelLabel}</p>
              </div>
            </div>

            {selectedRecord.failureReason ? (
              <div
                data-component="messages-history-detail-error"
                className="rounded-[16px] border border-red-200 bg-red-50 p-4"
              >
                <p className="text-[0.72rem] font-semibold text-red-600">실패 사유</p>
                <p className="mt-2 text-sm text-red-700">{selectedRecord.failureReason}</p>
              </div>
            ) : null}
          </div>
        )}
      </DetailPanel>
    </SplitLayout>
  );
}

export default function MessagesPage() {
  const locale = useLocale();
  const [activeSection, setActiveSection] = useState<MessageSectionId>("templates");
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>("builtin");
  const [selectedValue, setSelectedValue] = useState<string | null>("builtin:greeting");
  const [templateDetailTab, setTemplateDetailTab] = useState<TemplateDetailTab>("details");
  const [templatePreviewOverride, setTemplatePreviewOverride] = useState<string | null>(null);

  const { data: userTemplatesData, isLoading: isLoadingUserTemplates } = useMessageTemplates(1, 100);
  const userTemplates = useMemo(() => userTemplatesData?.data ?? [], [userTemplatesData]);

  const userTemplateItems = useMemo<TemplateListItem[]>(() => {
    return userTemplates.map((template) => ({
      id: `user:${template.id}`,
      label: template.name,
      icon: FileText,
    }));
  }, [userTemplates]);

  const visibleItems = useMemo(
    () => (templateFilter === "builtin" ? BUILTIN_TEMPLATES : userTemplateItems),
    [templateFilter, userTemplateItems]
  );
  const isTemplateListLoading = templateFilter === "branch" && isLoadingUserTemplates;

  const handleTemplateSelect = useCallback((id: string) => {
    setSelectedValue(id);
    setTemplateDetailTab("details");
    setTemplatePreviewOverride(null);
  }, []);

  const handleTemplateFilterChange = useCallback(
    (nextFilter: TemplateFilter) => {
      const nextItems = nextFilter === "builtin" ? BUILTIN_TEMPLATES : userTemplateItems;

      setTemplateFilter(nextFilter);
      setTemplateDetailTab("details");
      setTemplatePreviewOverride(null);
      setSelectedValue((current) => {
        if (current && nextItems.some((item) => item.id === current)) {
          return current;
        }

        return nextItems[0]?.id ?? null;
      });
    },
    [userTemplateItems]
  );

  const activeTemplateId = useMemo(() => {
    if (!selectedValue) {
      return null;
    }

    return visibleItems.find((item) => item.id === selectedValue)?.id ?? visibleItems[0]?.id ?? null;
  }, [selectedValue, visibleItems]);

  const isBuiltin = activeTemplateId?.startsWith("builtin:") ?? false;
  const builtinType = isBuiltin && activeTemplateId ? (activeTemplateId.replace("builtin:", "") as BuiltinTemplateType) : null;
  const userTemplateId = !isBuiltin && activeTemplateId?.startsWith("user:") ? activeTemplateId.replace("user:", "") : null;
  const selectedUserTemplate = userTemplateId ? userTemplates.find((template) => template.id === userTemplateId) : null;
  const SelectedBuiltinForm = builtinType ? FormComponents[builtinType] : null;
  const selectedTemplateItem = useMemo(
    () => visibleItems.find((item) => item.id === activeTemplateId) ?? null,
    [activeTemplateId, visibleItems]
  );
  const selectedTemplateIcon = selectedTemplateItem?.icon ?? FileText;
  const SelectedTemplateIcon = selectedTemplateIcon;
  const selectedTemplateTitle = selectedTemplateItem?.label ?? selectedUserTemplate?.name ?? "메시지 템플릿";
  const selectedTemplateSubtitle = selectedUserTemplate
    ? `지점 템플릿 · ${selectedUserTemplate.variables.length}개 변수`
    : "기본 템플릿은 오너 관리자 페이지에서 관리됩니다.";
  const selectedBuiltinSystemKey = builtinType ? BUILTIN_TEMPLATE_SYSTEM_KEYS[builtinType] : "";
  const { data: selectedBuiltinSystemTemplate } = useSystemTemplate(selectedBuiltinSystemKey);
  const builtinPreviewMeta = builtinType ? BUILTIN_TEMPLATE_PREVIEW_META[builtinType] : null;
  const templatePreviewMessage =
    templatePreviewOverride ??
    selectedUserTemplate?.content ??
    selectedBuiltinSystemTemplate?.content ??
    "";
  const templatePreviewHeadline = selectedUserTemplate ? selectedTemplateTitle : builtinPreviewMeta?.headline;
  const templatePreviewSubtitle = selectedUserTemplate ? "지점 템플릿" : builtinPreviewMeta?.subtitle;

  return (
    <PageSection name="messages">
      <div
        data-component="messages-sections"
        className="flex flex-1 min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch"
      >
        <SectionNav
          items={MESSAGE_SECTIONS}
          activeId={activeSection}
          onSelect={(id) => setActiveSection(id as MessageSectionId)}
        />

        <div data-component="messages-section-content" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {activeSection === "scheduled" ? (
            <section data-component="messages-scheduled-section" className="flex min-h-0 flex-1 flex-col">
              <MessageScheduledSection />
            </section>
          ) : activeSection === "templates" ? (
            <section data-component="messages-templates-section" className="flex min-h-0 flex-1 flex-col">
              <SplitLayout
                hasSelection={!!activeTemplateId}
                onBack={() => {
                  setSelectedValue(null);
                  setTemplateDetailTab("details");
                  setTemplatePreviewOverride(null);
                }}
              >
                <ListPanel
                  title="메시지 템플릿"
                  tabs={TEMPLATE_FILTERS}
                  activeTab={templateFilter}
                  onTabChange={(value) => handleTemplateFilterChange(value as TemplateFilter)}
                  headerActions={
                    templateFilter === "branch" ? (
                      <div data-component="messages-templates-actions" className="flex items-center gap-1.5">
                        <HeaderActionButton
                          icon={Plus}
                          label={t(locale, "msg-form.add-template")}
                          href="/messages/templates/new"
                        />
                        <HeaderActionButton
                          icon={FilePen}
                          label={t(locale, "msg-form.edit-template")}
                          href="/messages/templates"
                          variant="muted"
                        />
                      </div>
                    ) : undefined
                  }
                >
                  <div data-component="messages-templates-list" className="space-y-2 pb-2">
                    {isTemplateListLoading || visibleItems.length > 0 ? (
                      <AnimatedSlotList<TemplateListItem>
                        items={visibleItems}
                        isLoading={isTemplateListLoading}
                        className="space-y-2"
                        slotClassName={({ item, isLoading }) =>
                          cn(
                            "flex items-center gap-3 rounded-[16px] border-2 p-3 text-left transition-all duration-200",
                            !isLoading && item?.id === activeTemplateId
                              ? "border-v3-primary bg-v3-primary-light"
                              : "border-transparent bg-white",
                            !isLoading && "cursor-pointer hover:border-v3-primary/30 hover:bg-v3-primary-light/50"
                          )
                        }
                        onSlotClick={(item) => handleTemplateSelect(item.id)}
                        render={({ item, isLoading }) => {
                          if (isLoading) {
                            return (
                              <>
                                <div
                                  data-component="messages-template-skeleton-icon"
                                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                                >
                                  <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                                </div>
                                <div data-component="messages-template-skeleton-copy" className="min-w-0 flex-1">
                                  <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                                </div>
                              </>
                            );
                          }

                          if (!item) return null;
                          const Icon = item.icon;

                          return (
                            <>
                              <div
                                data-component="messages-template-item-icon"
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white text-v3-text-muted"
                              >
                                <Icon className="h-4 w-4" />
                              </div>
                              <span className="truncate text-[0.8rem] font-semibold text-v3-dark">{item.label}</span>
                            </>
                          );
                        }}
                      />
                    ) : null}
                    {templateFilter === "branch" && !isLoadingUserTemplates && visibleItems.length === 0 ? (
                      <ListEmptyState
                        name="messages-templates-list-empty"
                        message="등록된 지점 템플릿이 없습니다."
                      />
                    ) : null}
                  </div>
                </ListPanel>

                <DetailPanel
                  avatar={
                    activeTemplateId ? (
                      <div
                        data-component="messages-template-detail-avatar"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
                      >
                        <SelectedTemplateIcon className="h-5 w-5" />
                      </div>
                    ) : undefined
                  }
                  title={activeTemplateId ? selectedTemplateTitle : undefined}
                  subtitle={activeTemplateId ? selectedTemplateSubtitle : undefined}
                  badges={
                    activeTemplateId ? (
                      <span
                        data-component="messages-template-detail-badge"
                        className={cn(
                          "inline-flex items-center rounded-full px-3 py-1 text-[0.68rem] font-semibold",
                          selectedUserTemplate
                            ? "bg-v3-dim-white text-v3-text-muted"
                            : "bg-v3-primary-light text-v3-primary"
                        )}
                      >
                        {selectedUserTemplate ? "지점 템플릿" : "기본 템플릿"}
                      </span>
                    ) : undefined
                  }
                  trailing={
                    activeTemplateId && selectedUserTemplate ? (
                      <div
                        data-component="messages-template-detail-summary"
                        className="inline-flex items-center gap-1 rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {`${selectedUserTemplate.variables.length}개 변수`}
                      </div>
                    ) : undefined
                  }
                  tabs={
                    activeTemplateId ? (
                      <DetailTabs
                        tabs={TEMPLATE_DETAIL_TABS}
                        activeTab={templateDetailTab}
                        onTabChange={(key) => setTemplateDetailTab(key as TemplateDetailTab)}
                      />
                    ) : undefined
                  }
                >
                  {!activeTemplateId ? (
                    <div
                      data-component="messages-template-empty-selection"
                      className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-sm text-v3-text-muted"
                    >
                      왼쪽 목록에서 템플릿을 선택해 주세요.
                    </div>
                  ) : (
                    <div data-component="messages-template-detail-tabpanes" className="flex min-h-0 flex-col">
                      <div
                        data-component="messages-template-detail-pane"
                        className={cn(templateDetailTab === "details" ? "block" : "hidden")}
                      >
                        {SelectedBuiltinForm ? (
                          <SelectedBuiltinForm
                            onPreviewMessageChange={(message) => setTemplatePreviewOverride(message)}
                          />
                        ) : null}

                        {selectedUserTemplate ? (
                          <CustomTemplateForm
                            template={selectedUserTemplate as never}
                            onPreviewMessageChange={(message) => setTemplatePreviewOverride(message)}
                          />
                        ) : null}

                        {!SelectedBuiltinForm && !selectedUserTemplate ? (
                          <div
                            data-component="messages-template-missing"
                            className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-sm text-v3-text-muted"
                          >
                            선택한 템플릿 정보를 불러오지 못했습니다.
                          </div>
                        ) : null}
                      </div>

                      <div
                        data-component="messages-template-preview-pane"
                        className={cn(templateDetailTab === "preview" ? "block" : "hidden")}
                      >
                        <div
                          data-component="messages-template-preview-shell"
                          className="rounded-[20px] border border-v3-border bg-v3-dim-white/30 p-5"
                        >
                          <p className="text-[0.72rem] font-semibold text-v3-primary">실시간 미리보기</p>
                          <p className="mt-2 text-[0.82rem] leading-6 text-v3-text-muted">
                            템플릿 본문을 알림톡 화면 형태로 렌더링합니다.
                          </p>
                          <AlimtalkPhonePreview
                            className="pt-5"
                            content={templatePreviewMessage}
                            templateName={selectedTemplateTitle}
                            headline={templatePreviewHeadline}
                            subtitle={templatePreviewSubtitle}
                            dataComponentPrefix="message"
                            panelDataComponent="messages-template-preview-phone-panel"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </DetailPanel>
              </SplitLayout>
            </section>
          ) : activeSection === "history" ? (
            <section data-component="messages-history-section" className="flex min-h-0 flex-1 flex-col">
              <MessageHistorySection />
            </section>
          ) : activeSection === "triggers" ? (
            <section data-component="messages-triggers-section">
              <TriggerRulesManager dataComponentPrefix="message" />
            </section>
          ) : activeSection === "settings" ? (
            <section data-component="messages-settings-section" className="flex min-h-0 flex-1 flex-col">
              <MessageTenantApplicationSettings />
            </section>
          ) : (
            <section
              data-component={`messages-${activeSection}-section`}
              className="flex min-h-0 flex-1 flex-col"
            >
              <MessageSectionPlaceholder sectionId={activeSection} />
            </section>
          )}
        </div>
      </div>
    </PageSection>
  );
}
