"use client";
import { useEffect, useState } from "react";
import {
  Fade,
  Box,
} from "@mui/material";
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
    <Box data-component="greeting-message-form" sx={{ display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1, width: "100%", height: "100%", bgcolor: "background.default" }}>
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
