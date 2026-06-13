"use client";
import { useEffect, useState } from "react";
import { thanksMsgTemplate } from "../templates/messageTemplate/thanksMsg";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { AutoFillMsgCard } from "../templates/AutoFillMsgCard";
import { NameInput } from "./form-components/NameInput";

interface ThanksMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
}

export const ThanksMessageForm = ({ onPreviewMessageChange }: ThanksMessageFormProps) => {
  const locale = useLocale();
  const [messageOverride, setMessageOverride] = useState<string | null>(null);
  const { name, setName } = useFormStore();
  const { data: systemTemplate } = useSystemTemplate("THANKS");
  const normalizedName = name.trim();
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, { name: normalizedName })
    : thanksMsgTemplate({ name: normalizedName || "{{name}}" });
  const generatedMessage = messageOverride ?? templateMessage;

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  const variableItems = [
    { token: "{{name}}", label: t(locale, "thanks-msg.name-label"), value: name.trim() || "-" },
  ];

  useEffect(() => {
    if (generatedMessage) {
      onPreviewMessageChange?.(generatedMessage);
    }
  }, [generatedMessage, onPreviewMessageChange]);

  return (
    <div
      data-component="messages-thanks-form"
      className="flex flex-col animate-fade-in"
    >
      <div className="flex flex-col gap-4">
          <NameInput
            name={name}
            setName={(value) => {
              setName(value);
              setMessageOverride(null);
            }}
            label={t(locale, "thanks-msg.name-label")}
            placeholder={t(locale, "thanks-msg.name-placeholder")}
          />

        <AutoFillMsgCard
          title={t(locale, "common.generated-message-title")}
          copyButtonText={t(locale, "common.copy-button")}
          message={generatedMessage}
          bodyDescription={systemTemplate?.description || "감사 메시지를 검토하고 수신자 기준으로 다듬을 수 있습니다."}
          metaItems={[
            { label: "템플릿 유형", value: "감사 메시지" },
            { label: t(locale, "thanks-msg.name-label"), value: name.trim() || "-" },
          ]}
          variableItems={variableItems}
          onMessageChange={setMessageOverride}
          handleCopy={handleCopy}
        />
      </div>
    </div>
  );
};
