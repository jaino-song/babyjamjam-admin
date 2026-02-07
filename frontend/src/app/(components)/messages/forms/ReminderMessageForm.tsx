"use client";
import { useState } from "react";
import { reminderMsgTemplate } from "../templates/messageTemplate/reminderMsg";
import { t } from "@/app/lib/i18n/translations";
import { useFormStore } from "@/app/store/form-store";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import { NameInput } from "./form-components/NameInput";
import { Button } from "@/components/ui/button";


export const ReminderMessageForm = () => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const { name, setName } = useFormStore();
  const { data: systemTemplate } = useSystemTemplate("REMINDER");


  const handleGenerate = () => {
    const message = systemTemplate?.content
      ? renderTemplate(systemTemplate.content, { name })
      : reminderMsgTemplate({ name });

    setGeneratedMessage(message);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  return (
    <div
      data-component="messages-reminder-form"
      className="flex flex-col grow h-full bg-background animate-fade-in"
    >
      <div className="flex flex-col grow">
        {/* form */}
        <div className="flex flex-col gap-6">
          <NameInput
            name={name}
            setName={setName}
            label={t(locale, "reminder-msg.name-label")}
            placeholder={t(locale, "reminder-msg.name-placeholder")}
          />
          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={!name}
            data-component="messages-reminder-form-generate"
          >
            {t(locale, "common.generate-button")}
          </Button>
        </div>

        {/* generated message */}
        {generatedMessage && (
          <GeneratedMsg
            title={t(locale, "common.generated-message-title")}
            copyButtonText={t(locale, "common.copy-button")}
            message={generatedMessage}
            onMessageChange={setGeneratedMessage}
            handleCopy={handleCopy}
          />
        )}
      </div>
    </div>
  );
};

