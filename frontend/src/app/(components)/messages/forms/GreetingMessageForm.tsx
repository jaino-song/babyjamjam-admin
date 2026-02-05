"use client";
import { useEffect, useState } from "react";
import { greetingMsgTemplate } from "../templates/messageTemplate/greetingMsg";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { GeneratedMsg } from "../templates/GeneratedMsg";


export const GreetingMessageForm = () => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const { data: systemTemplate } = useSystemTemplate("GREETING");

  useEffect(() => {
    if (isDirty) return;

    const message = systemTemplate?.content
      ? renderTemplate(systemTemplate.content, {})
      : greetingMsgTemplate();

    setGeneratedMessage(message);
  }, [isDirty, systemTemplate?.content]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  return (
    <div
      data-component="greeting-message-form"
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
