"use client";

import { useState, useEffect } from "react";
import { 
    Box, 
    TextField, 
    Button, 
    Stack, 
    Typography, 
    Paper, 
    Divider,
    Alert,
    AlertTitle
} from "@mui/material";
import { useRouter } from "next/navigation";
import { useCreateMessageTemplate, useUpdateMessageTemplate } from "@/app/hooks/use-message-templates";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { MessageTemplate, TemplateVariable } from "@/lib/template/types";
import { extractVariables } from "@/lib/template/variable-parser";
import { VariableConfigurator } from "./variable-configurator";
import { VariableInserter } from "./variable-inserter";
import { TemplatePreview } from "./template-preview";

interface TemplateEditorProps {
    initialData?: MessageTemplate;
}

export const TemplateEditor = ({ initialData }: TemplateEditorProps) => {
    const router = useRouter();
    const locale = useLocale();
    const { mutate: createTemplate, isPending: isCreating } = useCreateMessageTemplate();
    const { mutate: updateTemplate, isPending: isUpdating } = useUpdateMessageTemplate();

    const [name, setName] = useState(initialData?.name || "");
    const [content, setContent] = useState(initialData?.content || "");
    const [variables, setVariables] = useState<TemplateVariable[]>(initialData?.variables || []);
    const [detectedKeys, setDetectedKeys] = useState<string[]>([]);

    useEffect(() => {
        const keys = extractVariables(content);
        setDetectedKeys(keys);

        setVariables(prev => {
            const existingKeys = new Set(prev.map(v => v.key));
            const newVars = keys
                .filter(key => !existingKeys.has(key))
                .map(key => ({
                    key,
                    label: key,
                    type: "text" as const,
                    required: true
                }));
            
            const filtered = prev.filter(v => keys.includes(v.key));
            return [...filtered, ...newVars];
        });
    }, [content]);

    const handleSave = () => {
        const data = { name, content, variables };
        if (initialData) {
            updateTemplate({ id: initialData.id, request: data }, {
                onSuccess: () => router.push("/messages/templates")
            });
        } else {
            createTemplate(data, {
                onSuccess: () => router.push("/messages/templates")
            });
        }
    };

    const handleVariableChange = (updatedVar: TemplateVariable) => {
        setVariables(prev => prev.map(v => v.key === updatedVar.key ? updatedVar : v));
    };

    const insertVariable = (key: string) => {
        setContent(prev => prev + `{{${key}}}`);
    };

    const isPending = isCreating || isUpdating;

    return (
        <Stack spacing={4}>
            <Paper sx={{ p: 3 }}>
                <Stack spacing={3}>
                    <TextField
                        fullWidth
                        label={t(locale, "template-editor.name-label")}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t(locale, "template-editor.name-placeholder")}
                        required
                    />

                    <Box>
                        <Typography variant="subtitle2" gutterBottom>
                            {t(locale, "template-editor.quick-insert")}
                        </Typography>
                        <VariableInserter onInsert={insertVariable} />
                    </Box>

                    <TextField
                        fullWidth
                        multiline
                        rows={10}
                        label={t(locale, "template-editor.content-label")}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={t(locale, "template-editor.content-placeholder")}
                        required
                    />
                </Stack>
            </Paper>

            {variables.length > 0 && (
                <Box>
                    <Typography variant="h6" gutterBottom sx={{ px: 1 }}>
                        {t(locale, "template-editor.variable-settings")}
                    </Typography>
                    <Stack spacing={2}>
                        {variables.map((variable) => (
                            <VariableConfigurator
                                key={variable.key}
                                variable={variable}
                                onChange={handleVariableChange}
                            />
                        ))}
                    </Stack>
                </Box>
            )}

            {detectedKeys.length === 0 && content.length > 0 && (
                <Alert severity="info">
                    <AlertTitle>Tip</AlertTitle>
                    {t(locale, "template-editor.no-variables-hint")}
                </Alert>
            )}

            <Paper sx={{ p: 3, bgcolor: "grey.50" }}>
                <Typography variant="h6" gutterBottom>
                    {t(locale, "template-editor.preview")}
                </Typography>
                <Divider sx={{ mb: 2 }} />
                <TemplatePreview content={content} variables={variables} />
            </Paper>

            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2, pb: 5 }}>
                <Button variant="outlined" onClick={() => router.back()}>
                    {t(locale, "common.cancel")}
                </Button>
                <Button 
                    variant="contained" 
                    onClick={handleSave}
                    disabled={!name || !content || isPending}
                >
                    {isPending ? t(locale, "common.saving") : t(locale, "common.save")}
                </Button>
            </Box>
        </Stack>
    );
};
