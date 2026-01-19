"use client";
import { useState } from "react";
import { Box, MenuItem, Select, SelectChangeEvent, Typography } from "@mui/material";
import { ContentPaper } from "@/app/(components)/root/ContentPaper";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";

// Import all message form components
import { GreetingMessageForm } from "@/app/(components)/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/app/(components)/messages/forms/ServiceInfoMessageForm";
import { PriceInfoMessageForm } from "@/app/(components)/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/app/(components)/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/app/(components)/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/app/(components)/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/app/(components)/messages/forms/InfoMessageForm";

type TemplateType = "greeting" | "service-info" | "price-info" | "reminder" | "thanks" | "survey" | "info";

const templateConfigs: { id: TemplateType; labelKey: string }[] = [
  { id: "greeting", labelKey: "msg-type.greeting" },
  { id: "service-info", labelKey: "msg-type.service-info" },
  { id: "price-info", labelKey: "msg-type.price-info" },
  { id: "reminder", labelKey: "msg-type.reminder" },
  { id: "thanks", labelKey: "msg-type.thanks" },
  { id: "survey", labelKey: "msg-type.survey" },
  { id: "info", labelKey: "msg-type.info" },
];

const FormComponents: Record<TemplateType, React.ComponentType> = {
  "greeting": GreetingMessageForm,
  "service-info": ServiceInfoMessageForm,
  "price-info": PriceInfoMessageForm,
  "reminder": ReminderMessageForm,
  "thanks": ThanksMessageForm,
  "survey": SurveyMessageForm,
  "info": InfoMessageForm,
};

export default function MessagesPage() {
  const locale = useLocale();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateType>("greeting");

  const handleChange = (event: SelectChangeEvent) => {
    setSelectedTemplate(event.target.value as TemplateType);
  };

  const SelectedForm = FormComponents[selectedTemplate];

  return (
    <Box sx={{ bgcolor: "background.paper" }}>
      <Box
        component="section"
        data-component="messages"
        sx={{
          px: { xs: 2, sm: 3, md: 6 },
          py: { xs: 3, sm: 4 },
          mx: "auto",
        }}
      >
        <ContentPaper
          title={t(locale, "msg-form.title")}
          subtitle={t(locale, "msg-form.select-msg-type")}
          sx={{ display: "flex", flexDirection: "column", gap: 3 }}
        >
          <Select
            id="msg-type-select"
            value={selectedTemplate}
            onChange={handleChange}
            fullWidth
            size="small"
            sx={{
              marginBottom: "24px",
              borderRadius: "20px",
              "& .MuiSelect-select": {
                color: "primary.main",
                fontWeight: 500,
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderRadius: "20px",
                borderColor: "primary.main",
              },
            }}
          >
            {templateConfigs.map((config) => (
              <MenuItem key={config.id} value={config.id}>
                {t(locale, config.labelKey)}
              </MenuItem>
            ))}
          </Select>
          <SelectedForm />
        </ContentPaper>
      </Box>
    </Box>
  );
}
