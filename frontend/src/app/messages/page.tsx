"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, MenuItem, Select, SelectChangeEvent, ListSubheader, Divider, CircularProgress } from "@mui/material";
import { ContentPaper } from "@/app/(components)/root/ContentPaper";
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { useMessageTemplates } from "@/features/message-templates";
import { UserTemplateForm } from "@/app/(components)/message-templates/UserTemplateForm";

import { GreetingMessageForm } from "@/app/(components)/messages/forms/GreetingMessageForm";
import { ServiceInfoMessageForm } from "@/app/(components)/messages/forms/ServiceInfoMessageForm";
import { PriceInfoMessageForm } from "@/app/(components)/messages/forms/PriceInfoMessageForm";
import { ReminderMessageForm } from "@/app/(components)/messages/forms/ReminderMessageForm";
import { ThanksMessageForm } from "@/app/(components)/messages/forms/ThanksMessageForm";
import { SurveyMessageForm } from "@/app/(components)/messages/forms/SurveyMessageForm";
import { InfoMessageForm } from "@/app/(components)/messages/forms/InfoMessageForm";

type BuiltinTemplateType = "greeting" | "service-info" | "price-info" | "reminder" | "thanks" | "survey" | "info";

const templateConfigs: { id: BuiltinTemplateType; labelKey: string }[] = [
  { id: "greeting", labelKey: "msg-type.greeting" },
  { id: "service-info", labelKey: "msg-type.service-info" },
  { id: "price-info", labelKey: "msg-type.price-info" },
  { id: "reminder", labelKey: "msg-type.reminder" },
  { id: "thanks", labelKey: "msg-type.thanks" },
  { id: "survey", labelKey: "msg-type.survey" },
  { id: "info", labelKey: "msg-type.info" },
];

const FormComponents: Record<BuiltinTemplateType, React.ComponentType> = {
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
  const router = useRouter();
  const [selectedValue, setSelectedValue] = useState<string>("builtin:greeting");

  const { data: userTemplatesData, isLoading: isLoadingUserTemplates } = useMessageTemplates(1, 100);
  const userTemplates = userTemplatesData?.data || [];

  const handleChange = (event: SelectChangeEvent) => {
    const value = event.target.value;
    if (value === "__create__") {
      router.push("/messages/templates/new");
      return;
    }
    if (value === "__manage_system__") {
      router.push("/messages/system-templates");
      return;
    }
    if (value === "__manage__") {
      router.push("/messages/templates");
      return;
    }
    setSelectedValue(value);
  };

  const isBuiltin = selectedValue.startsWith("builtin:");
  const builtinType = isBuiltin ? selectedValue.replace("builtin:", "") as BuiltinTemplateType : null;
  const userTemplateId = !isBuiltin && selectedValue.startsWith("user:") ? selectedValue.replace("user:", "") : null;
  const selectedUserTemplate = userTemplateId ? userTemplates.find(t => t.id === userTemplateId) : null;

  const SelectedBuiltinForm = builtinType ? FormComponents[builtinType] : null;

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
            value={selectedValue}
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
            <ListSubheader sx={{ bgcolor: "grey.100", fontWeight: 600 }}>
              기본 템플릿
            </ListSubheader>
            {templateConfigs.map((config) => (
              <MenuItem key={config.id} value={`builtin:${config.id}`}>
                {t(locale, config.labelKey)}
              </MenuItem>
            ))}

            {userTemplates.length > 0 && (
              <ListSubheader sx={{ bgcolor: "grey.100", fontWeight: 600, mt: 1 }}>
                사용자 템플릿
              </ListSubheader>
            )}
            {userTemplates.map((template) => (
              <MenuItem key={template.id} value={`user:${template.id}`}>
                {template.name}
              </MenuItem>
            ))}

            <Divider sx={{ my: 1 }} />
            <MenuItem value="__manage_system__" sx={{ color: "text.secondary" }}>
              🧩 시스템 템플릿 관리
            </MenuItem>
            <MenuItem value="__manage__" sx={{ color: "text.secondary" }}>
              📋 템플릿 관리
            </MenuItem>
            <MenuItem value="__create__" sx={{ color: "primary.main", fontWeight: 500 }}>
              + 새 템플릿 만들기
            </MenuItem>
          </Select>

          {isLoadingUserTemplates && (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {SelectedBuiltinForm && <SelectedBuiltinForm />}

          {selectedUserTemplate && <UserTemplateForm template={selectedUserTemplate} />}
        </ContentPaper>
      </Box>
    </Box>
  );
}
