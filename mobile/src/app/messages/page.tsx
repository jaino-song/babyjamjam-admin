"use client";

import { useState } from "react";
import { isAxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CardContainer } from "@/components/auth/card-container";
import { ContentPaper } from "@/components/app/root/content-paper";
import { HeaderActionButton, SectionNav } from "@/components/app/v3";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { CustomTemplateForm } from "@/components/app/messages/forms/custom-template-form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Clock3,
  FilePen,
  FileText,
  History,
  Plus,
  Settings2,
  Workflow,
} from "lucide-react";
import { GreetingMessageForm } from "@/components/app/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/components/app/messages/forms/service-info-message-form";
import { PriceInfoMessageForm } from "@/components/app/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/components/app/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/components/app/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/components/app/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/components/app/messages/forms/InfoMessageForm";
import { TriggerRulesManager } from "@/components/app/alimtalk/TriggerRulesManager";
import { MessageSenderApprovalSettings } from "@/components/app/messages/MessageSenderApprovalSettings";
import { MessagingFeatureGate } from "@/components/app/messages/MessagingFeatureGate";
import { settingsApi } from "@/services/api";

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
  { id: "triggers", label: "발송 트리거 설정", icon: Workflow },
  { id: "settings", label: "설정", icon: Settings2 },
] as const;

type MessageSectionId = (typeof MESSAGE_SECTIONS)[number]["id"];
type PlaceholderSectionId = Exclude<MessageSectionId, "templates" | "triggers">;

const PLACEHOLDER_COPY: Record<
  PlaceholderSectionId,
  { description: string; helper: string }
> = {
  scheduled: {
    description: "예약되었거나 대기 중인 메시지 발송 일정을 모아보는 영역입니다.",
    helper: "메시지 발송 스케줄 컴포넌트를 연결하면 이곳에 예정 목록이 표시됩니다.",
  },
  history: {
    description: "실제로 발송된 메시지의 이력과 결과를 추적하는 영역입니다.",
    helper: "발송 로그나 검색 필터 컴포넌트를 연결하면 이 섹션에서 기록을 확인할 수 있습니다.",
  },
  settings: {
    description: "메시지 채널, 기본 옵션, 운영 정책을 조정하는 영역입니다.",
    helper: "발송 관련 설정 컴포넌트를 추가하면 이 자리에서 한 번에 관리할 수 있습니다.",
  },
};

const FormComponents: Record<BuiltinTemplateType, React.ComponentType> = {
  "greeting": GreetingMessageForm,
  "service-info": ServiceInfoMessageForm,
  "price-info": PriceInfoMessageForm,
  "reminder": ReminderMessageForm,
  "thanks": ThanksMessageForm,
  "survey": SurveyMessageForm,
  "info": InfoMessageForm,
};

function MessageSectionPlaceholder({ sectionId }: { sectionId: PlaceholderSectionId }) {
  const section = MESSAGE_SECTIONS.find((item) => item.id === sectionId);
  if (!section) return null;

  const Icon = section.icon;
  const copy = PLACEHOLDER_COPY[sectionId];

  return (
    <ContentPaper variant="v3" className="overflow-hidden">
      <div
        data-component="messages-section-placeholder-surface"
        className="rounded-[28px] border border-v3-border/70 bg-gradient-to-br from-white via-white to-v3-primary-light/50 p-6 sm:p-7"
      >
        <div data-component="messages-section-placeholder-header" className="mb-4 flex items-center gap-3">
          <div
            data-component="messages-section-placeholder-icon"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-v3-primary/10 text-v3-primary"
          >
            <Icon className="h-5 w-5" />
          </div>
          <div data-component="messages-section-placeholder-copy" className="min-w-0">
            <h2 className="text-lg font-bold text-v3-dark">{section.label}</h2>
            <p className="text-sm text-v3-text-muted">{copy.description}</p>
          </div>
        </div>

        <Separator className="mb-6" />

        <div
          data-component="messages-section-placeholder-empty"
          className="rounded-[22px] border border-dashed border-v3-border bg-white/90 p-6 text-center sm:p-8"
        >
          <Icon className="mx-auto mb-3 h-9 w-9 text-v3-text-muted/70" />
          <p className="text-sm font-semibold text-v3-dark">이 섹션은 아직 비어 있습니다.</p>
          <p className="mt-1 text-sm leading-6 text-v3-text-muted">{copy.helper}</p>
        </div>
      </div>
    </ContentPaper>
  );
}

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
    <section data-component="messages" className="flex flex-1 flex-col bg-background">
      <section
        data-component="messages-content"
        className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-4 px-2 py-3 sm:px-3 sm:py-4 md:px-6"
      >
        <div data-component="messages-sections" className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <SectionNav
            items={MESSAGE_SECTIONS}
            activeId={activeSection}
            onSelect={(id) => setActiveSection(id as MessageSectionId)}
          />

          <div data-component="messages-section-panel" className="min-w-0 flex-1">
            {activeSection === "templates" ? (
              <section data-component="messages-templates-section">
                <CardContainer
                  title={t(locale, "msg-form.title")}
                  subtitle={t(locale, "msg-form.select-msg-type")}
                  className="flex flex-col"
                  headerActionsLeft={
                    <HeaderActionButton
                      icon={FilePen}
                      label={t(locale, "msg-form.edit-template")}
                      href="/messages/templates"
                      variant="muted"
                      data-component="messages-header-edit"
                    />
                  }
                  headerActionsRight={
                    <HeaderActionButton
                      icon={Plus}
                      label={t(locale, "msg-form.add-template")}
                      href="/messages/templates/new"
                      data-component="messages-header-add"
                    />
                  }
                >
                  <div data-component="messages-select" className="pb-6">
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
                </CardContainer>
              </section>
            ) : activeSection === "triggers" ? (
              <section data-component="messages-triggers-section">
                <MessagingFeatureGate
                  isEnabled={isMessagingApproved}
                  isLoading={isLoadingMessageSenderApproval}
                  title="발송 트리거 설정을 사용하려면 관리자 승인이 필요합니다"
                  description={lockedFeatureCopy.description}
                >
                  <TriggerRulesManager />
                </MessagingFeatureGate>
              </section>
            ) : activeSection === "settings" ? (
              <section data-component="messages-settings-section">
                <MessageSenderApprovalSettings
                  key={`${messageSenderApproval?.senderPhone ?? ""}:${messageSenderApproval?.approvalStatus ?? "loading"}:${messageSenderApproval?.requestedAt ?? ""}`}
                  approval={messageSenderApproval}
                  isLoading={isLoadingMessageSenderApproval}
                  isSubmitting={requestApprovalMutation.isPending}
                  errorMessage={approvalErrorMessage}
                  onSubmit={handleRequestApproval}
                />
              </section>
            ) : (
              <section data-component={`messages-${activeSection}-section`}>
                <MessagingFeatureGate
                  isEnabled={isMessagingApproved}
                  isLoading={isLoadingMessageSenderApproval}
                  title={lockedFeatureCopy.title}
                  description={lockedFeatureCopy.description}
                >
                  <MessageSectionPlaceholder sectionId={activeSection} />
                </MessagingFeatureGate>
              </section>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}
