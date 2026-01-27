"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    Box,
    TextField,
    Button,
    Typography,
    Checkbox,
    FormControlLabel,
    Select,
    MenuItem,
    Alert,
    CircularProgress,
    Paper,
    IconButton,
} from "@mui/material";
import { ArrowLeft, Save, X } from "lucide-react";
import { useDebouncedCallback } from "use-debounce";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import type { MessageTemplate, TemplateVariable, CreateTemplateDto, UpdateTemplateDto } from "@/features/message-templates";

interface TemplateFormProps {
    mode: "create" | "edit";
    initialData?: MessageTemplate;
    onSubmit: (data: CreateTemplateDto | UpdateTemplateDto) => Promise<void>;
    isPending: boolean;
}

const detectVariables = (content: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = Array.from(content.matchAll(regex));
    return [...new Set(matches.map(m => m[1]?.trim() ?? "").filter(Boolean))];
};

export function TemplateForm({ mode, initialData, onSubmit, isPending }: TemplateFormProps) {
    const router = useRouter();
    const [name, setName] = useState(initialData?.name || "");
    const [content, setContent] = useState(initialData?.content || "");
    const [variables, setVariables] = useState<TemplateVariable[]>(initialData?.variables || []);
    const [detectedKeys, setDetectedKeys] = useState<string[]>([]);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const validateVariables = useCallback((contentVars: string[], definedVars: TemplateVariable[]) => {
        const errors: string[] = [];
        const definedKeys = new Set(definedVars.map(v => v.key));

        for (const varKey of contentVars) {
            if (!definedKeys.has(varKey)) {
                errors.push(`템플릿에 정의되지 않은 변수: {{${varKey}}}`);
            }
        }

        const contentVarsSet = new Set(contentVars);
        for (const variable of definedVars) {
            if (!contentVarsSet.has(variable.key)) {
                errors.push(`사용되지 않는 변수 정의: ${variable.key}`);
            }
        }

        return errors;
    }, []);

    const debouncedDetect = useDebouncedCallback((text: string) => {
        const detected = detectVariables(text);
        setDetectedKeys(detected);

        setVariables(prev => {
            const existingMap = new Map(prev.map(v => [v.key, v]));
            const newVariables: TemplateVariable[] = detected.map(key => {
                if (existingMap.has(key)) {
                    return existingMap.get(key)!;
                }
                return {
                    key,
                    label: key,
                    type: "text",
                    required: true,
                };
            });
            return newVariables;
        });
    }, 300);

    useEffect(() => {
        debouncedDetect(content);
    }, [content, debouncedDetect]);

    useEffect(() => {
        const errors = validateVariables(detectedKeys, variables);
        setValidationErrors(errors);
    }, [detectedKeys, variables, validateVariables]);

    const handleVariableChange = (key: string, field: keyof TemplateVariable, value: string | boolean) => {
        setVariables(prev =>
            prev.map(v =>
                v.key === key ? { ...v, [field]: value } : v
            )
        );
    };

    const handleSubmit = async () => {
        if (validationErrors.length > 0) return;
        if (!name.trim()) return;

        await onSubmit({
            name: name.trim(),
            content,
            variables,
        });
    };

    const handleCancel = () => {
        router.push("/messages/templates");
    };

    const isValid = name.trim() !== "" && validationErrors.length === 0;

    return (
        <Box sx={{ bgcolor: "background.paper" }}>
            <Box sx={{ px: { xs: 2, sm: 3, md: 6 }, py: { xs: 3, sm: 4 }, mx: "auto" }}>
                <ContentPaper
                    sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
                    header={
                        <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                                <IconButton onClick={handleCancel} size="small">
                                    <ArrowLeft size={20} />
                                </IconButton>
                                <Box>
                                    <Box component="h5" sx={{ m: 0, color: "primary.main", fontWeight: 700, fontSize: "1.5rem" }}>
                                        {mode === "create" ? "새 템플릿 만들기" : "템플릿 수정"}
                                    </Box>
                                </Box>
                            </Box>
                            <Box sx={{ display: "flex", gap: 1 }}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={handleCancel}
                                    disabled={isPending}
                                >
                                    취소
                                </Button>
                                <Button
                                    variant="contained"
                                    size="small"
                                    startIcon={isPending ? <CircularProgress size={16} /> : <Save size={16} />}
                                    onClick={handleSubmit}
                                    disabled={isPending || !isValid}
                                >
                                    저장
                                </Button>
                            </Box>
                        </Box>
                    }
                >
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                            템플릿 이름 *
                        </Typography>
                        <TextField
                            fullWidth
                            size="small"
                            placeholder="예: 서비스 안내 메시지"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            error={name.trim() === ""}
                        />
                    </Box>

                    {validationErrors.length > 0 && (
                        <Alert severity="warning" sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                                변수 불일치 오류
                            </Typography>
                            {validationErrors.map((err, i) => (
                                <Box key={i}>• {err}</Box>
                            ))}
                            <Box sx={{ mt: 1, color: "text.secondary", fontSize: "0.875rem" }}>
                                템플릿 내용과 변수 목록이 일치해야 저장할 수 있습니다.
                            </Box>
                        </Alert>
                    )}

                    <Box sx={{ display: "flex", gap: 3, flexDirection: { xs: "column", md: "row" } }}>
                        <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                                템플릿 내용 *
                            </Typography>
                            <TextField
                                fullWidth
                                multiline
                                rows={15}
                                placeholder={`안녕하세요 {{고객명}}님,\n\n{{서비스유형}} 서비스가 {{서비스일자}}에 예정되어 있습니다.\n\n감사합니다.`}
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                sx={{
                                    "& .MuiInputBase-root": {
                                        fontFamily: "monospace",
                                        fontSize: "0.9rem",
                                    },
                                }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                                💡 {"{{변수명}}"} 형식으로 변수를 입력하면 자동으로 감지됩니다
                            </Typography>
                        </Box>

                        <Paper
                            data-component="template-variable-list-paper"
                            variant="outlined"
                            sx={{
                                flex: 1,
                                p: 2,
                                maxHeight: "500px",
                                overflowY: "auto",
                                bgcolor: "grey.50",
                            }}
                        >
                            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                                감지된 변수 ({variables.length}개)
                            </Typography>

                            {variables.length === 0 ? (
                                <Box sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
                                    템플릿에 {"{{변수명}}"} 형식으로<br />
                                    변수를 추가하세요
                                </Box>
                            ) : (
                                <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                    {variables.map((variable, index) => (
                                        <Box
                                            key={variable.key}
                                            sx={{
                                                p: 2,
                                                bgcolor: "background.paper",
                                                borderRadius: 1,
                                                border: 1,
                                                borderColor: "divider",
                                            }}
                                        >
                                            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5, color: "primary.main" }}>
                                                {index + 1}. {variable.key}
                                            </Typography>

                                            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">
                                                        라벨
                                                    </Typography>
                                                    <TextField
                                                        fullWidth
                                                        size="small"
                                                        value={variable.label}
                                                        onChange={(e) => handleVariableChange(variable.key, "label", e.target.value)}
                                                    />
                                                </Box>

                                                <Box>
                                                    <Typography variant="caption" color="text.secondary">
                                                        타입
                                                    </Typography>
                                                    <Select
                                                        fullWidth
                                                        size="small"
                                                        value={variable.type}
                                                        onChange={(e) => handleVariableChange(variable.key, "type", e.target.value)}
                                                    >
                                                        <MenuItem value="text">텍스트</MenuItem>
                                                    </Select>
                                                </Box>

                                                <FormControlLabel
                                                    control={
                                                        <Checkbox
                                                            checked={variable.required}
                                                            onChange={(e) => handleVariableChange(variable.key, "required", e.target.checked)}
                                                            size="small"
                                                        />
                                                    }
                                                    label={<Typography variant="body2">필수</Typography>}
                                                />
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            )}
                        </Paper>
                    </Box>
                </ContentPaper>
            </Box>
        </Box>
    );
}
