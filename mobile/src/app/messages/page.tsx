"use client";

import { useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Clock3,
  FilePen,
  FileText,
  History,
  Plus,
  Settings2,
  Workflow,
} from "lucide-react";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { GreetingMessageForm } from "@/components/app/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/components/app/messages/forms/service-info-message-form";
import { PriceInfoMessageForm } from "@/components/app/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/components/app/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/components/app/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/components/app/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/components/app/messages/forms/InfoMessageForm";
import { CustomTemplateForm } from "@/components/app/messages/forms/custom-template-form";
import { TriggerRulesManager } from "@/components/app/alimtalk/TriggerRulesManager";
import { MessageSenderApprovalSettings } from "@/components/app/messages/MessageSenderApprovalSettings";
import { MessagingFeatureGate } from "@/components/app/messages/MessagingFeatureGate";
import { settingsApi } from "@/services/api";
import { api } from "@/lib/api/client";
import "@/components/app/mobile-redesign/redesign.css";

interface AlimtalkLogRecord {
  id: number;
  provider: string;
  templateKey: string;
  receiver: string;
  clientId: number | null;
  messageBody: string;
  status: "pending" | "sent" | "failed";
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  ruleName: string | null;
  eventType: string | null;
  recipientName: string | null;
  clientName: string | null;
  employeeName: string | null;
}

const LOG_STATUS_LABEL: Record<AlimtalkLogRecord["status"], string> = {
  pending: "대기",
  sent: "성공",
  failed: "실패",
};

const LOG_STATUS_TONE: Record<AlimtalkLogRecord["status"], "green" | "orange" | "burgundy"> = {
  pending: "orange",
  sent: "green",
  failed: "burgundy",
};

const LOG_AVATAR_BG: Record<AlimtalkLogRecord["status"], string> = {
  pending: "bg-v3-orange",
  sent: "bg-v3-green",
  failed: "bg-v3-burgundy",
};

interface UpcomingAlimtalkJob {
  id: string;
  ruleId: string;
  ruleName: string;
  eventType: string | null;
  recipientType: string;
  recipientPhone: string | null;
  templateKey: string;
  status: string;
  scheduledFor: string;
  clientId: number | null;
  employeeScheduleId: number | null;
  payload: Record<string, unknown> | null;
}

const RECIPIENT_TYPE_LABEL: Record<string, string> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "제공인력 1",
  SECONDARY_EMPLOYEE: "제공인력 2",
};

function formatScheduledFor(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type BuiltinTemplateType = "greeting" | "service-info" | "price-info" | "reminder" | "thanks" | "survey" | "info";

const templateConfigs: { id: BuiltinTemplateType; labelKey: string }[] = [
  { id: "greeting", labelKey: "msg-type.greeting" },
  { id: "service-info", labelKey: "msg-type.service-info" },
  { id: "price-info", labelKey: "msg-type.price-info" },
  { id: "reminder", labelKey: "msg-type.reminder" },
  { id: "thanks", labelKey: "msg-type.thanks" },
  { id: "survey", labelKey: "msg-type.survey" },
  { id: "info", labelKey: "msg-type.info" },
];

const MESSAGE_SECTIONS = [
  { id: "scheduled", label: "발송 예정", icon: Clock3 },
  { id: "history", label: "발송 기록", icon: History },
  { id: "templates", label: "템플릿", icon: FileText },
  { id: "triggers", label: "트리거", icon: Workflow },
  { id: "settings", label: "설정", icon: Settings2 },
] as const;

type MessageSectionId = (typeof MESSAGE_SECTIONS)[number]["id"];

const FormComponents: Record<BuiltinTemplateType, React.ComponentType> = {
  "greeting": GreetingMessageForm,
  "service-info": ServiceInfoMessageForm,
  "price-info": PriceInfoMessageForm,
  "reminder": ReminderMessageForm,
  "thanks": ThanksMessageForm,
  "survey": SurveyMessageForm,
  "info": InfoMessageForm,
};

export default function MessagesPage() {
  const locale = useLocale();
  const [activeSection, setActiveSection] = useState<MessageSectionId>("templates");
  const [selectedValue, setSelectedValue] = useState<string>("builtin:greeting");
  const [approvalErrorMessage, setApprovalErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    data: messageSenderApproval,
    isLoading: isLoadingMessageSenderApproval,
  } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });

  const requestApprovalMutation = useMutation({
    mutationFn: settingsApi.requestMessageSenderApproval,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "message-sender-approval"], data);
      setApprovalErrorMessage(null);
    },
    onError: (error) => {
      if (isAxiosError<{ error?: string }>(error)) {
        setApprovalErrorMessage(
          error.response?.data?.error ?? "승인 신청에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }
      setApprovalErrorMessage("승인 신청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    },
  });

  const { data: userTemplatesData, isLoading: isLoadingUserTemplates } = useMessageTemplates(1, 100);
  const userTemplates = userTemplatesData?.data || [];

  const {
    data: upcomingJobs = [],
    isLoading: isUpcomingLoading,
    isError: isUpcomingError,
  } = useQuery<UpcomingAlimtalkJob[]>({
    queryKey: ["alimtalk", "upcoming", 100],
    queryFn: async () => {
      const res = await api.get<UpcomingAlimtalkJob[]>("/alimtalk-trigger-jobs/upcoming", { params: { limit: 100 } });
      return res.data;
    },
    enabled: activeSection === "scheduled",
  });

  const {
    data: historyLogs = [],
    isLoading: isHistoryLoading,
    isError: isHistoryError,
  } = useQuery<AlimtalkLogRecord[]>({
    queryKey: ["alimtalk", "logs", 200],
    queryFn: async () => {
      const res = await api.get<AlimtalkLogRecord[]>("/alimtalk-logs", { params: { limit: 200 } });
      return res.data;
    },
    enabled: activeSection === "history",
  });

  const isBuiltin = selectedValue.startsWith("builtin:");
  const builtinType = isBuiltin ? (selectedValue.replace("builtin:", "") as BuiltinTemplateType) : null;
  const userTemplateId = !isBuiltin && selectedValue.startsWith("user:") ? selectedValue.replace("user:", "") : null;
  const selectedUserTemplate = userTemplateId ? userTemplates.find((template) => template.id === userTemplateId) : null;
  const SelectedBuiltinForm = builtinType ? FormComponents[builtinType] : null;
  const isMessagingApproved = messageSenderApproval?.isApproved ?? false;

  const lockedFeatureCopy = isLoadingMessageSenderApproval
    ? {
        title: "승인 상태를 확인하는 중입니다",
        description: "조직의 발신번호 승인 상태를 확인한 뒤 기능 접근 여부를 결정합니다.",
      }
    : messageSenderApproval?.approvalStatus === "pending"
      ? {
          title: "조직 오너 승인이 완료되면 사용할 수 있습니다",
          description:
            "발신번호 승인 요청이 접수되었습니다. 승인 전까지 발송 예정, 발송 기록, 발송 트리거 설정은 잠겨 있습니다.",
        }
      : {
          title: "설정 탭에서 발신번호를 등록하고 승인 신청을 진행해 주세요",
          description:
            "문자 발송 기능은 조직 단위 승인 이후에만 활성화됩니다. 등록 번호가 승인되면 같은 조직 계정 전체에 적용됩니다.",
        };

  const handleRequestApproval = (senderPhone: string) => {
    requestApprovalMutation.mutate(senderPhone);
  };

  return (
    <section data-component="messages" className="flex h-full min-h-0 flex-col">
      <div className="filter-row pt-3" data-component="messages-section-nav">
        {MESSAGE_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              className={`filter-pill ${isActive ? "active" : ""}`}
              aria-pressed={isActive}
              onClick={() => setActiveSection(section.id)}
              data-component="messages-section-pill"
            >
              <Icon size={12} strokeWidth={2.5} />
              {section.label}
            </button>
          );
        })}
      </div>

      <div className="shell-content" data-component="messages-content">
        {activeSection === "templates" ? (
          <div className="list-card flex-1 min-h-0 flex flex-col" data-component="messages-templates-card">
            <div className="list-title">
              <span className="list-title-text">
                {t(locale, "msg-form.title")}
                <span className="list-count">{t(locale, "msg-form.select-msg-type")}</span>
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <Link href="/messages/templates" className="list-action" data-component="messages-templates-edit">
                  <FilePen size={12} strokeWidth={3} />
                  {t(locale, "msg-form.edit-template")}
                </Link>
                <Link href="/messages/templates/new" className="list-action" data-component="messages-templates-add">
                  <Plus size={12} strokeWidth={3} />
                  {t(locale, "msg-form.add-template")}
                </Link>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-2 space-y-4">
              <div data-component="messages-select">
                <Select value={selectedValue} onValueChange={setSelectedValue}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="템플릿 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {templateConfigs.map((config) => (
                      <SelectItem key={config.id} value={`builtin:${config.id}`}>
                        {t(locale, config.labelKey)}
                      </SelectItem>
                    ))}

                    {userTemplates.length > 0 && (
                      <SelectGroup>
                        <SelectLabel className="mt-1 bg-muted font-semibold">사용자 템플릿</SelectLabel>
                        {userTemplates.map((template) => (
                          <SelectItem key={template.id} value={`user:${template.id}`}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {isLoadingUserTemplates && (
                <div data-component="messages-loading" className="flex justify-center py-2">
                  <Spinner className="h-6 w-6" />
                </div>
              )}

              {SelectedBuiltinForm && <SelectedBuiltinForm />}
              {selectedUserTemplate && <CustomTemplateForm template={selectedUserTemplate as never} />}
            </div>
          </div>
        ) : activeSection === "triggers" ? (
          <div className="flex-1 min-h-0 overflow-y-auto" data-component="messages-triggers-area">
            <MessagingFeatureGate
              isEnabled={isMessagingApproved}
              isLoading={isLoadingMessageSenderApproval}
              title="발송 트리거 설정을 사용하려면 관리자 승인이 필요합니다"
              description={lockedFeatureCopy.description}
            >
              <TriggerRulesManager />
            </MessagingFeatureGate>
          </div>
        ) : activeSection === "settings" ? (
          <div className="flex-1 min-h-0 overflow-y-auto" data-component="messages-settings-area">
            <MessageSenderApprovalSettings
              key={`${messageSenderApproval?.senderPhone ?? ""}:${messageSenderApproval?.approvalStatus ?? "loading"}:${messageSenderApproval?.requestedAt ?? ""}`}
              approval={messageSenderApproval}
              isLoading={isLoadingMessageSenderApproval}
              isSubmitting={requestApprovalMutation.isPending}
              errorMessage={approvalErrorMessage}
              onSubmit={handleRequestApproval}
            />
          </div>
        ) : activeSection === "scheduled" ? (
          <div className="flex-1 min-h-0 flex flex-col" data-component="messages-scheduled-area">
            <MessagingFeatureGate
              isEnabled={isMessagingApproved}
              isLoading={isLoadingMessageSenderApproval}
              title={lockedFeatureCopy.title}
              description={lockedFeatureCopy.description}
            >
              <div className="list-card flex-1 min-h-0 flex flex-col">
                <div className="list-title">
                  <span className="list-title-text">
                    발송 예정
                    <span className="list-count">{isUpcomingLoading ? "불러오는 중" : `${upcomingJobs.length}건`}</span>
                  </span>
                </div>
                <div className="list-card-scroll">
                  {isUpcomingLoading ? (
                    <div className="flex flex-col items-center py-10 text-v3-text-muted">
                      <Clock3 className="mb-3 h-9 w-9 opacity-30 animate-pulse" />
                      <p className="text-[0.85rem] font-semibold">발송 예정 불러오는 중…</p>
                    </div>
                  ) : isUpcomingError ? (
                    <div className="flex flex-col items-center py-10">
                      <p className="text-[0.85rem] font-semibold text-v3-burgundy">발송 예정을 불러오지 못했습니다</p>
                      <p className="mt-1 text-[0.75rem] text-v3-text-muted">잠시 후 다시 시도해 주세요.</p>
                    </div>
                  ) : upcomingJobs.length === 0 ? (
                    <div className="flex flex-col items-center py-10 text-v3-text-muted">
                      <Clock3 className="mb-3 h-9 w-9 opacity-30" />
                      <p className="text-[0.85rem] font-semibold">예약된 발송이 없습니다</p>
                      <p className="mt-1 text-[0.75rem]">트리거 규칙을 활성화하면 예정된 알림톡이 표시됩니다.</p>
                    </div>
                  ) : (
                    upcomingJobs.map((job) => (
                      <div
                        key={job.id}
                        className="list-item"
                        data-component="messages-scheduled-row"
                      >
                        <div className="list-avatar bg-v3-primary">
                          <Clock3 size={16} strokeWidth={2.5} />
                        </div>
                        <div className="list-info">
                          <div className="list-name">
                            {job.ruleName}
                            <span className="badge badge-primary">
                              {RECIPIENT_TYPE_LABEL[job.recipientType] ?? job.recipientType}
                            </span>
                          </div>
                          <div className="list-meta">
                            {job.templateKey}
                            {job.eventType ? ` · ${job.eventType}` : ""}
                            {job.recipientPhone ? ` · ${job.recipientPhone}` : ""}
                          </div>
                        </div>
                        <div className="list-right">
                          <span className="dday-sub">{formatScheduledFor(job.scheduledFor)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </MessagingFeatureGate>
          </div>
        ) : activeSection === "history" ? (
          <div className="flex-1 min-h-0 flex flex-col" data-component="messages-history-area">
            <MessagingFeatureGate
              isEnabled={isMessagingApproved}
              isLoading={isLoadingMessageSenderApproval}
              title={lockedFeatureCopy.title}
              description={lockedFeatureCopy.description}
            >
              <div className="list-card flex-1 min-h-0 flex flex-col">
                <div className="list-title">
                  <span className="list-title-text">
                    발송 기록
                    <span className="list-count">{isHistoryLoading ? "불러오는 중" : `${historyLogs.length}건`}</span>
                  </span>
                </div>
                <div className="list-card-scroll">
                  {isHistoryLoading ? (
                    <div className="flex flex-col items-center py-10 text-v3-text-muted">
                      <History className="mb-3 h-9 w-9 opacity-30 animate-pulse" />
                      <p className="text-[0.85rem] font-semibold">발송 기록 불러오는 중…</p>
                    </div>
                  ) : isHistoryError ? (
                    <div className="flex flex-col items-center py-10">
                      <p className="text-[0.85rem] font-semibold text-v3-burgundy">발송 기록을 불러오지 못했습니다</p>
                      <p className="mt-1 text-[0.75rem] text-v3-text-muted">잠시 후 다시 시도해 주세요.</p>
                    </div>
                  ) : historyLogs.length === 0 ? (
                    <div className="flex flex-col items-center py-10 text-v3-text-muted">
                      <History className="mb-3 h-9 w-9 opacity-30" />
                      <p className="text-[0.85rem] font-semibold">발송 기록이 없습니다</p>
                      <p className="mt-1 text-[0.75rem]">메시지를 발송하면 기록이 표시됩니다.</p>
                    </div>
                  ) : (
                    historyLogs.map((log) => {
                      const recipient = log.recipientName ?? log.clientName ?? log.employeeName ?? log.receiver;
                      const initial = recipient.charAt(0) || "?";
                      const tone = LOG_STATUS_TONE[log.status];
                      return (
                        <div
                          key={log.id}
                          className="list-item"
                          data-component="messages-history-row"
                        >
                          <div className={`list-avatar ${LOG_AVATAR_BG[log.status]}`}>{initial}</div>
                          <div className="list-info">
                            <div className="list-name">
                              {recipient}
                              <span className={`badge badge-${tone}`}>{LOG_STATUS_LABEL[log.status]}</span>
                            </div>
                            <div className="list-meta">
                              {log.ruleName ?? log.templateKey}
                              {log.eventType ? ` · ${log.eventType}` : ""}
                              {` · ${formatScheduledFor(log.createdAt)}`}
                            </div>
                            {log.errorMessage ? (
                              <div className="list-meta text-v3-burgundy mt-1">{log.errorMessage}</div>
                            ) : null}
                          </div>
                          <div className="list-right">
                            <span className="dday-sub">{log.receiver}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </MessagingFeatureGate>
          </div>
        ) : null}
      </div>
    </section>
  );
}
