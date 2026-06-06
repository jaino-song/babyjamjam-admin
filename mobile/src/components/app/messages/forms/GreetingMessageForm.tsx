"use client";
import { useState } from "react";
import { greetingMsgTemplate } from "../templates/messageTemplate/greetingMsg";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { useToast } from "@/hooks/use-toast";
import { GeneratedMsg } from "../templates/GeneratedMsg";


export const GreetingMessageForm = () => {
  const locale = useLocale();
  const { toast } = useToast();
  const [editedMessage, setEditedMessage] = useState<string | null>(null);
  const { data: systemTemplate } = useSystemTemplate("GREETING");

  const defaultMessage = systemTemplate?.content
    ? renderTemplate(systemTemplate.content, {})
    : greetingMsgTemplate();
  const generatedMessage = editedMessage ?? defaultMessage;

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    toast({ description: t(locale, "common.copy-success-message") });
  };

  return (
    <div
      data-component="messages-greeting-form"
      className="flex flex-col justify-center grow w-full h-full animate-fade-in"
    >
      <div className="flex flex-col h-full">
        {/* generated message */}
        {generatedMessage && (
          <GeneratedMsg
            title={t(locale, "common.generated-message-title")}
            copyButtonText={t(locale, "common.copy-button")}
            message={generatedMessage}
            onMessageChange={(message) => {
              setEditedMessage(message);
            }}
            handleCopy={handleCopy}
          />
        )}
      </div>
    </div>
  );
};
