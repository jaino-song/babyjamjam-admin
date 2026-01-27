"use client";
import { useEffect, useState } from "react";
import { Fade, Box, TextField } from "@mui/material";
import { serviceInfoMsgTemplate } from "../templates/messageTemplate/serviceInfoMsg";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { GeneratedMsg } from "../templates/GeneratedMsg";

export const ServiceInfoMessageForm = () => {
  const locale = useLocale();
  const [name, setName] = useState("");
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const { data: systemTemplate } = useSystemTemplate("service_info");

  useEffect(() => {
    if (isDirty) return;
    const message = systemTemplate?.content
      ? renderTemplate(systemTemplate.content, { name: name || "{{name}}" })
      : serviceInfoMsgTemplate({ name: name || "{{name}}" });
    setGeneratedMessage(message);
  }, [isDirty, systemTemplate?.content, name]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  return (
    <Box data-component="service-info-message-form" sx={{ display: "flex", flexDirection: "column", flexGrow: 1, height: "100%", bgcolor: "background.default" }}>
      <Fade in appear timeout={500}>
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", gap: 2 }}>
          <TextField
            label={t(locale, "form.client-name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
          />
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
        </Box>
      </Fade>
    </Box>
  );
};
