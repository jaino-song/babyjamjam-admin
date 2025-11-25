"use client";
import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Paper,
  Stack,
  TextField,
  Typography,
  Fade,
  Box,
} from "@mui/material";
import { serviceInfoMsgTemplate } from "../templates/messageTemplate/serviceInfoMsg";
import { t } from "@/app/lib/i18n/translations";
import { useFormStore } from "@/app/store/form-store";
import { GeneratedMsg } from "../templates/GeneratedMsg";


export const ServiceInfoMessageForm = () => {
  const [generatedMessage, setGeneratedMessage] = useState("");
  const { name, setName } = useFormStore();


  const handleGenerate = () => {
    const message = serviceInfoMsgTemplate({ name });
    setGeneratedMessage(message);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t("ko", "common.copy-success-message"));
  };

  return (
    <Paper elevation={2} sx={{ display: "flex", flexDirection: "column", justifyContent: "center", borderTopLeftRadius: 0, borderTopRightRadius: 0, p: 3, flexGrow: 1, width: "100%", height: "100%" }}>
      <Fade in appear timeout={500}>
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* title */}
          <Typography variant="h5" color="primary.main" fontWeight={700} gutterBottom>
            {t("ko", "msg-type.service-info")}
          </Typography>
      {/* subtitle */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t("ko", "service-info-msg.subtitle")}
      </Typography>

      {/* form */}
      <Card elevation={0}>
        <CardContent>
          <Stack spacing={3}>
            {/* name */}
            <TextField
              fullWidth
              label={t("ko", "service-info-msg.name-label")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("ko", "service-info-msg.name-placeholder")}
            />

            {/* generate button */}
            <Button
              variant="contained"
              size="large"
              onClick={handleGenerate}
              disabled={!name}
            >
              {t("ko", "common.generate-button")}
            </Button>
          </Stack>
        </CardContent>
      </Card>

          {/* generated message */}
          {generatedMessage && (
            <GeneratedMsg title={t("ko", "common.generated-message-title")} copyButtonText={t("ko", "common.copy-button")} handleCopy={handleCopy}>
              {generatedMessage}
            </GeneratedMsg>
          )}
        </Box>
      </Fade>
    </Paper>
  );
};
