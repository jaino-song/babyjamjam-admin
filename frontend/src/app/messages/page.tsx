"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { CustomTemplateForm } from "@/app/(components)/messages/forms/custom-template-form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Plus, FilePen } from "lucide-react";


import { GreetingMessageForm } from "@/app/(components)/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/app/(components)/messages/forms/service-info-message-form";
import { PriceInfoMessageForm } from "@/app/(components)/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/app/(components)/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/app/(components)/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/app/(components)/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/app/(components)/messages/forms/InfoMessageForm";

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
    <div className="bg-background">
      <section
        data-component="messages"
        className="px-2 sm:px-3 md:px-6 py-3 sm:py-4 mx-auto"
      >
        <ContentPaper
          title={t(locale, "msg-form.title")}
          subtitle={t(locale, "msg-form.select-msg-type")}
          className="flex flex-col"
        >
          <div className="flex items-center justify-end gap-2 pb-6">
            <Select value={selectedValue} onValueChange={handleChange}>
              <SelectTrigger className="flex-1">
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
            <Button className="w-20 gap-2" onClick={handleCreateTemplate}>
              <Plus className="h-4 w-4" />
              {t(locale, "msg-form.add-template")}
            </Button>
            <Button variant="outline" className="w-20 gap-2" onClick={() => router.push("/messages/templates")}>
              <FilePen className="h-4 w-4" />
              {t(locale, "msg-form.edit-template")}
            </Button>
          </div>

          {isLoadingUserTemplates && (
            <div className="flex justify-center py-2">
              <Spinner className="h-6 w-6" />
            </div>
          )}

          {SelectedBuiltinForm && <SelectedBuiltinForm />}

          {selectedUserTemplate && <CustomTemplateForm template={selectedUserTemplate as never} />}
        </ContentPaper>
      </section>
    </div>
  );
}
