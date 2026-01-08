"use client";
import { useState } from "react";
import {
  Button,
  Stack,
  Fade,
  Box,
} from "@mui/material";
import { serviceInfoMsgTemplate } from "../templates/messageTemplate/serviceInfoMsg";
import { t } from "@/app/lib/i18n/translations";
import { useFormStore } from "@/app/store/form-store";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { GeneratedMsg } from "../templates/GeneratedMsg";
import { NameInput } from "./form-components/NameInput";


export const ServiceInfoMessageForm = () => {
  const locale = useLocale();
  const [generatedMessage, setGeneratedMessage] = useState("");
  const { name, setName } = useFormStore();


  const handleGenerate = () => {
    const message = serviceInfoMsgTemplate({ name });
    setGeneratedMessage(message);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    alert(t(locale, "common.copy-success-message"));
  };

  return (
    <Box data-component="service-info-message-form" sx={{ display: "flex", flexDirection: "column", flexGrow: 1, height: "100%", bgcolor: "background.default" }}>
      <Fade in appear timeout={500}>
        <Box sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
          {/* form */}
          <Stack spacing={3}>
            <NameInput name={name} setName={setName} label={t(locale, "service-info-msg.name-label")} placeholder={t(locale, "service-info-msg.name-placeholder")} />
            <Button
              variant="contained"
              size="large"
              onClick={handleGenerate}
              disabled={!name}
              data-component="service-info-message-form-generate-button"
            >
              {t(locale, "common.generate-button")}
            </Button>
          </Stack>

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
