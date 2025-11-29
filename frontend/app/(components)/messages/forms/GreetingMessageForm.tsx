"use client";
import { useEffect, useState } from "react";
import {
  Paper,
  Typography,
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
    <Paper elevation={2} data-component="greeting-message-form" sx={{ display: "flex", flexDirection: "column", justifyContent: "center", borderTopLeftRadius: 0, borderTopRightRadius: 0, p: 3, flexGrow: 1, width: "100%", height: "100%", bgcolor: "background.default" }}>
      <Fade in appear timeout={500}>
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* title */}
          <Typography variant="h5" color="primary.main" fontWeight={700} gutterBottom>
            {t(locale, "msg-type.greeting")}
          </Typography>
          {/* subtitle */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t(locale, "greeting-msg.subtitle")}
          </Typography>

          {/* generated message */}
          {generatedMessage && (
            <GeneratedMsg title={t(locale, "common.generated-message-title")} copyButtonText={t(locale, "common.copy-button")} handleCopy={handleCopy}>
              {generatedMessage}
            </GeneratedMsg>
          )}
        </Box>
      </Fade>
    </Paper>
  );
};
