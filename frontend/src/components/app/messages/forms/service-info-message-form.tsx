"use client";
import { useEffect, useState } from "react";
import { serviceInfoMsgTemplate } from "../templates/messageTemplate/serviceInfoMsg";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import { TitleTextInputMolecule } from "./form-components/TitleTextInputMolecule";

interface ServiceInfoMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
}

export const ServiceInfoMessageForm = ({ onPreviewMessageChange }: ServiceInfoMessageFormProps) => {
  const locale = useLocale();
  const [name, setName] = useState("");
  const [messageOverride, setMessageOverride] = useState<string | null>(null);
  const { data: systemTemplate } = useSystemTemplate("service_info");

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  const variableItems = [
    { token: "{{name}}", label: t(locale, "service-info-msg.name-label"), value: name.trim() || "-" },
  ];

  const normalizedName = name.trim();
  const templateMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, { name: normalizedName })
    : serviceInfoMsgTemplate({ name: normalizedName || "{{name}}" });

  const generatedMessage = messageOverride ?? templateMessage;

  useEffect(() => {
    if (generatedMessage) {
      onPreviewMessageChange?.(generatedMessage);
    }
  }, [generatedMessage, onPreviewMessageChange]);

  return (
    <div
      data-component="messages-service-info-form"
      className="flex flex-col grow h-full animate-fade-in"
    >
      <div className="flex flex-col h-full gap-4">
        <TitleTextInputMolecule
          id="client-name"
          label={t(locale, "service-info-msg.name-label")}
          value={name}
          onValueChange={(value) => {
            setName(value);
            setMessageOverride(null);
          }}
          placeholder={t(locale, "service-info-msg.name-placeholder")}
          dataComponent="messages-service-info-name-input"
        />

        <GeneratedMsg
          title={t(locale, "common.generated-message-title")}
          copyButtonText={t(locale, "common.copy-button")}
          message={generatedMessage}
          bodyDescription={systemTemplate?.description || "메시지 문구를 직접 수정할 수 있어요."}
          metaItems={[
            { label: "템플릿 유형", value: "서비스 안내" },
            { label: t(locale, "service-info-msg.name-label"), value: name.trim() || "-" },
          ]}
          variableItems={variableItems}
          onMessageChange={setMessageOverride}
          handleCopy={handleCopy}
        />
      </div>
    </div>
  );
};
