"use client";
import { useEffect, useState } from "react";
import {
  Paper,
  Fade,
  Box,
} from "@mui/material";
import { greetingMsgTemplate } from "../templates/messageTemplate/greetingMsg";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { GeneratedMsg } from "../templates/GeneratedMsg";


export const GreetingMessageForm = () => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");


  useEffect(() => {
    const message = greetingMsgTemplate();
    setGeneratedMessage(message);
  }, []);

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
              onMessageChange={setGeneratedMessage}
              handleCopy={handleCopy}
            />
          )}
        </Box>
      </Fade>
    </Box>
  );
};
