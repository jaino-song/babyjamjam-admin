"use client";
import { useEffect, useState } from "react";
import {
  Paper,
  Typography,
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
    <Paper elevation={2} data-component="info-message-form" sx={{ display: "flex", flexDirection: "column", justifyContent: "center", borderTopLeftRadius: 0, borderTopRightRadius: 0, p: 3, flexGrow: 1, width: "100%", height: "100%", bgcolor: "background.default" }}>
      <Fade in appear timeout={500}>
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* title */}
          <Typography variant="h5" color="primary.main" fontWeight={700} gutterBottom>
            {t(locale, "msg-type.info")}
          </Typography>
          {/* subtitle */}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t(locale, "info-msg.subtitle")}
          </Typography>

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
    </Paper>
  );
};
