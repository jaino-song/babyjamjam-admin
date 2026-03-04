"use client";
import { useState } from "react";
import { serviceInfoMsgTemplate } from "../templates/messageTemplate/serviceInfoMsg";
import { t } from "@/lib/i18n/translations";
import { useFormStore } from "@/stores/form-store";
import { useLocale } from "@/providers/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { useToast } from "@/hooks/use-toast";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export const ServiceInfoMessageForm = () => {
  const locale = useLocale();
  const { toast } = useToast();
  const { name, setName } = useFormStore();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const { data: systemTemplate } = useSystemTemplate("service_info");

  const handleGenerate = () => {
    const message = systemTemplate?.content
      ? renderTemplate(systemTemplate.content, { name })
      : serviceInfoMsgTemplate({ name });
    setGeneratedMessage(message);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    toast({ description: t(locale, "common.copy-success-message") });
  };

  return (
    <div
      data-component="messages-service-info-form"
      className="flex flex-col grow h-full animate-fade-in"
    >
      <div className="flex flex-col h-full gap-4">
        <div className="space-y-2">
          <Label htmlFor="client-name">{t(locale, "service-info-msg.name-label")}</Label>
          <Input
            id="client-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(locale, "service-info-msg.name-placeholder")}
          />
        </div>

        <Button
          size="lg"
          onClick={handleGenerate}
          disabled={!name}
        >
          {t(locale, "common.generate-button")}
        </Button>

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
