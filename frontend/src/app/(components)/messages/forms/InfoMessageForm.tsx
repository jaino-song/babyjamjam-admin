"use client";
import { useEffect, useState } from "react";
import {
  Fade,
  Box,
} from "@mui/material";
import { infoMsgTemplate } from "../templates/messageTemplate/infoMsg";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { renderTemplate } from "@/lib/template-utils";
import { GeneratedMsg } from "../templates/GeneratedMsg";


export const InfoMessageForm = () => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const { data: systemTemplate } = useSystemTemplate("INFO");

  useEffect(() => {
    if (isDirty) return;

    const message = systemTemplate?.content
      ? renderTemplate(systemTemplate.content, {})
      : infoMsgTemplate();

    setGeneratedMessage(message);
  }, [isDirty, systemTemplate?.content]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  return (
    <Box data-component="info-message-form" sx={{ display: "flex", flexDirection: "column", flexGrow: 1, height: "100%", bgcolor: "background.default" }}>
      <Fade in appear timeout={500}>
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
        </Box>
      </Fade>
    </Box>
  );
};
