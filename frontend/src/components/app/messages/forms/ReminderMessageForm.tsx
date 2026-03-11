"use client";
import { useEffect, useState } from "react";
import { reminderMsgTemplate } from "../templates/messageTemplate/reminderMsg";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import { NameInput } from "./form-components/NameInput";

interface ReminderMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
}

export const ReminderMessageForm = ({ onPreviewMessageChange }: ReminderMessageFormProps) => {
  const locale = useLocale();
  const [messageOverride, setMessageOverride] = useState<string | null>(null);
  const { name, setName } = useFormStore();
  const { data: systemTemplate } = useSystemTemplate("REMINDER");
  const normalizedName = name.trim();
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, { name: normalizedName })
    : reminderMsgTemplate({ name: normalizedName || "{{name}}" });
  const generatedMessage = messageOverride ?? templateMessage;

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  const variableItems = [
    { token: "{{name}}", label: t(locale, "reminder-msg.name-label"), value: name.trim() || "-" },
  ];

  useEffect(() => {
    if (generatedMessage) {
      onPreviewMessageChange?.(generatedMessage);
    }
  }, [generatedMessage, onPreviewMessageChange]);

  return (
    <div
      data-component="messages-reminder-form"
      className="flex flex-col grow h-full animate-fade-in"
    >
      <div className="flex flex-col h-full gap-4">
          <NameInput
            name={name}
            setName={(value) => {
              setName(value);
              setMessageOverride(null);
            }}
            label={t(locale, "reminder-msg.name-label")}
            placeholder={t(locale, "reminder-msg.name-placeholder")}
          />

        <GeneratedMsg
          title={t(locale, "common.generated-message-title")}
          copyButtonText={t(locale, "common.copy-button")}
          message={generatedMessage}
          bodyDescription={systemTemplate?.description || "리마인더 메시지를 검토하고 개인화된 문구를 조정할 수 있습니다."}
          metaItems={[
            { label: "템플릿 유형", value: "리마인더" },
            { label: t(locale, "reminder-msg.name-label"), value: name.trim() || "-" },
          ]}
          variableItems={variableItems}
          onMessageChange={setMessageOverride}
          handleCopy={handleCopy}
        />
      </div>
    </div>
  );
};
