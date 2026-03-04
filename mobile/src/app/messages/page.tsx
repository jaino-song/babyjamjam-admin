"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CardContainer } from "@/components/auth/card-container";
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
import { Spinner } from "@/components/ui/spinner";
import { Plus, FilePen } from "lucide-react";
import { HeaderActionButton } from "@/components/app/v3/HeaderActionButton";


import { GreetingMessageForm } from "@/components/app/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/components/app/messages/forms/service-info-message-form";
import { PriceInfoMessageForm } from "@/components/app/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/components/app/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/components/app/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/components/app/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/components/app/messages/forms/InfoMessageForm";

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
  const [selectedValue, setSelectedValue] = useState<string>("builtin:greeting");

  const { data: userTemplatesData, isLoading: isLoadingUserTemplates } = useMessageTemplates(1, 100);
  const userTemplates = userTemplatesData?.data || [];

  const handleChange = (value: string) => {
    setSelectedValue(value);
  };

  const handleCreateTemplate = () => {
    router.push("/messages/templates/new");
  };

  const isBuiltin = selectedValue.startsWith("builtin:");
  const builtinType = isBuiltin ? selectedValue.replace("builtin:", "") as BuiltinTemplateType : null;
  const userTemplateId = !isBuiltin && selectedValue.startsWith("user:") ? selectedValue.replace("user:", "") : null;
  const selectedUserTemplate = userTemplateId ? userTemplates.find(t => t.id === userTemplateId) : null;

  const SelectedBuiltinForm = builtinType ? FormComponents[builtinType] : null;

  return (
    <section data-component="messages" className="flex flex-col flex-1 bg-background">
      <section
        data-component="messages-content"
        className="flex flex-col flex-1 px-2 sm:px-3 md:px-6 py-3 sm:py-4 mx-auto w-full"
      >
        <CardContainer
          title={t(locale, "msg-form.title")}
          subtitle={t(locale, "msg-form.select-msg-type")}
          className="flex flex-col"
          headerActionsLeft={
            <HeaderActionButton
              icon={FilePen}
              label={t(locale, "msg-form.edit-template")}
              onClick={() => router.push("/messages/templates")}
              variant="muted"
              data-component="messages-header-edit"
            />
          }
          headerActionsRight={
            <HeaderActionButton
              icon={Plus}
              label={t(locale, "msg-form.add-template")}
              onClick={handleCreateTemplate}
              data-component="messages-header-add"
            />
          }
        >
          <div data-component="messages-select" className="pb-6">
            <Select value={selectedValue} onValueChange={handleChange}>
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
                    <SelectLabel className="bg-muted font-semibold mt-1">
                      사용자 템플릿
                    </SelectLabel>
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
    </section>
  );
}
