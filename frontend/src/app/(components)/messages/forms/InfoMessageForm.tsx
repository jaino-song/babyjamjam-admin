"use client";
import { useEffect, useState } from "react";
import {
  Fade,
  Box,
} from "@mui/material";
import { infoMsgTemplate } from "../templates/messageTemplate/infoMsg";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { GeneratedMsg } from "../templates/GeneratedMsg";


export const InfoMessageForm = () => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");


  useEffect(() => {
    const message = infoMsgTemplate();
    setGeneratedMessage(message);
  }, []);

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
              onMessageChange={setGeneratedMessage}
              handleCopy={handleCopy}
            />
          )}
        </Box>
      </Fade>
    </Box>
  );
};
