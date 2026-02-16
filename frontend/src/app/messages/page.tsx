"use client";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { CustomTemplateForm } from "@/components/app/messages/forms/custom-template-form";
import { SplitLayout, ListPanel, DetailPanel, AnimatedSlotList, HeaderActionButton } from "@/components/app/v3";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  MessageCircle,
  Briefcase,
  CreditCard,
  Bell,
  Heart,
  ClipboardList,
  Info,
  FileText,
  Plus,
  FilePen,
} from "lucide-react";

import { GreetingMessageForm } from "@/components/app/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/components/app/messages/forms/service-info-message-form";
import { PriceInfoMessageForm } from "@/components/app/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/components/app/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/components/app/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/components/app/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/components/app/messages/forms/InfoMessageForm";

type BuiltinTemplateType = "greeting" | "service-info" | "price-info" | "reminder" | "thanks" | "survey" | "info";
type TemplateGroup = "builtin" | "user";

interface TemplateListItem {
  id: string;
  label: string;
  icon: typeof MessageCircle;
  group: TemplateGroup;
}

const BUILTIN_TEMPLATES: TemplateListItem[] = [
  { id: "builtin:greeting", label: "인사 메시지", icon: MessageCircle, group: "builtin" },
  { id: "builtin:service-info", label: "서비스 안내", icon: Briefcase, group: "builtin" },
  { id: "builtin:price-info", label: "요금 안내", icon: CreditCard, group: "builtin" },
  { id: "builtin:reminder", label: "리마인더", icon: Bell, group: "builtin" },
  { id: "builtin:thanks", label: "감사 메시지", icon: Heart, group: "builtin" },
  { id: "builtin:survey", label: "설문", icon: ClipboardList, group: "builtin" },
  { id: "builtin:info", label: "안내 메시지", icon: Info, group: "builtin" },
];

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
  const router = useRouter();
  const [selectedValue, setSelectedValue] = useState<string | null>("builtin:greeting");
  const [activeGroup, setActiveGroup] = useState<TemplateGroup>("builtin");

  const { data: userTemplatesData, isLoading: isLoadingUserTemplates } = useMessageTemplates(1, 100);
  const userTemplates = userTemplatesData?.data || [];

  const userTemplateItems = useMemo<TemplateListItem[]>(() => {
    return userTemplates.map((template) => ({
      id: `user:${template.id}`,
      label: template.name,
      icon: FileText,
      group: "user",
    }));
  }, [userTemplates]);

  const listTabs = useMemo(
    () => [
      { value: "builtin", label: "기본 템플릿" },
      {
        value: "user",
        label: userTemplateItems.length > 0 ? `사용자 템플릿 (${userTemplateItems.length})` : "사용자 템플릿",
      },
    ],
    [userTemplateItems.length]
  );

  const visibleItems = activeGroup === "builtin" ? BUILTIN_TEMPLATES : userTemplateItems;
  const isListLoading = activeGroup === "user" && isLoadingUserTemplates;

  const handleGroupChange = useCallback(
    (value: string) => {
      if (value !== "builtin" && value !== "user") return;

      const nextGroup = value as TemplateGroup;
      setActiveGroup(nextGroup);

      setSelectedValue((previous) => {
        if (nextGroup === "builtin") {
          if (previous?.startsWith("builtin:")) return previous;
          return BUILTIN_TEMPLATES[0]?.id ?? null;
        }

        if (previous?.startsWith("user:")) return previous;
        return userTemplateItems[0]?.id ?? null;
      });
    },
    [userTemplateItems]
  );

  const handleTemplateSelect = useCallback((id: string) => {
    setSelectedValue(id);
    setActiveGroup(id.startsWith("user:") ? "user" : "builtin");
  }, []);

  const isBuiltin = selectedValue?.startsWith("builtin:") ?? false;
  const builtinType = isBuiltin && selectedValue ? selectedValue.replace("builtin:", "") as BuiltinTemplateType : null;
  const userTemplateId = !isBuiltin && selectedValue?.startsWith("user:") ? selectedValue.replace("user:", "") : null;
  const selectedUserTemplate = userTemplateId ? userTemplates.find((template) => template.id === userTemplateId) : null;
  const SelectedBuiltinForm = builtinType ? FormComponents[builtinType] : null;

  return (
    <section data-component="messages">
      <SplitLayout hasSelection={!!selectedValue} onBack={() => setSelectedValue(null)}>
        <ListPanel
          title="메시지 템플릿"
          tabs={listTabs}
          activeTab={activeGroup}
          onTabChange={handleGroupChange}
          headerActions={
            <div className="flex items-center gap-1.5">
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
          }
        >
          <div className="space-y-2 pb-2">
            {!isListLoading && visibleItems.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-v3-border p-4 text-center text-[0.8rem] text-v3-text-muted">
                등록된 사용자 템플릿이 없습니다.
              </div>
            ) : (
              <AnimatedSlotList<TemplateListItem>
                items={visibleItems}
                isLoading={isListLoading}
                loadingCount={6}
                className="space-y-2"
                slotClassName={({ item, isLoading }) =>
                  cn(
                    "flex items-center gap-3 p-3 rounded-[16px] border-2 text-left transition-all duration-200",
                    !isLoading && item?.id === selectedValue
                      ? "bg-v3-primary-light border-v3-primary"
                      : "bg-white border-transparent",
                    !isLoading && "cursor-pointer hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                  )
                }
                onSlotClick={(item) => handleTemplateSelect(item.id)}
                render={({ item, isLoading }) => {
                  if (isLoading) {
                    return (
                      <>
                        <div className="w-9 h-9 rounded-[12px] bg-v3-dim-white flex items-center justify-center shrink-0">
                          <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                        </div>
                      </>
                    );
                  }

                  if (!item) return null;
                  const Icon = item.icon;

                  return (
                    <>
                      <div className="w-9 h-9 rounded-[12px] bg-v3-dim-white text-v3-text-muted flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-[0.8rem] font-semibold text-v3-dark truncate">{item.label}</span>
                    </>
                  );
                }}
              />
            )}
          </div>
        </ListPanel>

        <DetailPanel>
          {!selectedValue && (
            <div className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-sm text-v3-text-muted">
              왼쪽 목록에서 템플릿을 선택해 주세요.
            </div>
          )}

          {SelectedBuiltinForm && <SelectedBuiltinForm />}

          {selectedUserTemplate && <CustomTemplateForm template={selectedUserTemplate as never} />}

          {!SelectedBuiltinForm && !selectedUserTemplate && selectedValue && (
            <div className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-sm text-v3-text-muted">
              선택한 템플릿 정보를 불러오지 못했습니다.
            </div>
          )}
        </DetailPanel>
      </SplitLayout>
    </section>
  );
}
