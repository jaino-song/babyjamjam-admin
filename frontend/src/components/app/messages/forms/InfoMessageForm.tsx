"use client";
import { useEffect, useState } from "react";
import { infoMsgTemplate } from "../templates/messageTemplate/infoMsg";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { GeneratedMsg } from "../templates/GeneratedMsg";


interface InfoMessageFormProps {
  onPreviewMessageChange?: (message: string) => void;
}

export const InfoMessageForm = ({ onPreviewMessageChange }: InfoMessageFormProps) => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const { data: systemTemplate } = useSystemTemplate("INFO");

  const initialMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {})
    : infoMsgTemplate();

  const displayMessage = isDirty ? generatedMessage : initialMessage;

  useEffect(() => {
    onPreviewMessageChange?.(displayMessage);
  }, [displayMessage, onPreviewMessageChange]);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  return (
    <div
      data-component="messages-info-form"
      className="flex flex-col grow h-full animate-fade-in"
    >
      <div className="flex flex-col h-full">
        {/* generated message */}
        {displayMessage && (
          <GeneratedMsg
            title={t(locale, "common.generated-message-title")}
            copyButtonText={t(locale, "common.copy-button")}
            message={displayMessage}
            bodyDescription={systemTemplate?.description || "기본 안내 문구를 검토하고 바로 수정할 수 있습니다."}
            onMessageChange={(message) => {
              setIsDirty(true);
              setGeneratedMessage(message);
            }}
            handleCopy={handleCopy}
          />
        )}
      </div>
    </div>
  );
};
