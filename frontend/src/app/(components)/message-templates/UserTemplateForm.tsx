"use client";

import { useState } from "react";
import { Box, TextField, Button, Typography } from "@mui/material";
import type { MessageTemplate } from "@/features/message-templates";
import { GeneratedMsg } from "../messages/templates/GeneratedMsg";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

interface UserTemplateFormProps {
    template: MessageTemplate;
}

const substituteVariables = (content: string, values: Record<string, string>): string => {
    return content.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
        return values[key.trim()] || `{{${key}}}`;
    });
};

export function UserTemplateForm({ template }: UserTemplateFormProps) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [generatedMessage, setGeneratedMessage] = useState("");
    const locale = useLocale();

    const handleValueChange = (key: string, value: string) => {
        setValues(prev => ({ ...prev, [key]: value }));
    };

    const handleGenerate = () => {
        const message = substituteVariables(template.content, values);
        setGeneratedMessage(message);
    };

    const allRequiredFilled = template.variables
        .filter(v => v.required)
        .every(v => values[v.key]?.trim());

    const handleCopy = async () => {
        await navigator.clipboard.writeText(generatedMessage);
    };

    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {template.variables.map((variable) => (
                    <TextField
                        key={variable.key}
                        label={variable.label}
                        required={variable.required}
                        value={values[variable.key] || ""}
                        onChange={(e) => handleValueChange(variable.key, e.target.value)}
                        size="small"
                        fullWidth
                    />
                ))}
            </Box>

            {template.variables.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                    이 템플릿에는 입력 변수가 없습니다.
                </Typography>
            )}

            <Button
                variant="contained"
                size="large"
                onClick={handleGenerate}
                disabled={!allRequiredFilled && template.variables.some(v => v.required)}
            >
                {t(locale, "common.generate-button")}
            </Button>

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
    );
}
