"use client";

import { 
    Paper, 
    Stack, 
    TextField, 
    FormControl, 
    InputLabel, 
    Select, 
    MenuItem, 
    FormControlLabel, 
    Checkbox,
    Typography,
    Box,
    RadioGroup,
    Radio,
    Chip
} from "@mui/material";
import { TemplateVariable, VariableType } from "@/lib/template/types";
import { DATA_SOURCES } from "@/lib/template/data-sources";
import { useLocale } from "@/app/(components)/LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

interface VariableConfiguratorProps {
    variable: TemplateVariable;
    onChange: (updatedVar: TemplateVariable) => void;
}

export const VariableConfigurator = ({ variable, onChange }: VariableConfiguratorProps) => {
    const locale = useLocale();

    const handleChange = (field: keyof TemplateVariable, value: any) => {
        onChange({ ...variable, [field]: value });
    };

    return (
        <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="subtitle1" fontWeight={600} color="primary">
                        {`{{${variable.key}}}`}
                    </Typography>
                    <FormControlLabel
                        control={
                            <Checkbox 
                                checked={variable.required} 
                                onChange={(e) => handleChange("required", e.target.checked)} 
                            />
                        }
                        label={t(locale, "template-editor.required-label")}
                    />
                </Box>

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField
                        fullWidth
                        label={t(locale, "template-editor.variable-label")}
                        value={variable.label}
                        onChange={(e) => handleChange("label", e.target.value)}
                        size="small"
                    />
                    <FormControl fullWidth size="small">
                        <InputLabel>{t(locale, "template-editor.variable-type")}</InputLabel>
                        <Select
                            value={variable.type}
                            label={t(locale, "template-editor.variable-type")}
                            onChange={(e) => handleChange("type", e.target.value as VariableType)}
                        >
                            <MenuItem value="text">텍스트</MenuItem>
                            <MenuItem value="phone">연락처</MenuItem>
                            <MenuItem value="select">선택 (드롭다운)</MenuItem>
                            <MenuItem value="date">날짜</MenuItem>
                            <MenuItem value="number">숫자</MenuItem>
                            <MenuItem value="textarea">긴 텍스트</MenuItem>
                        </Select>
                    </FormControl>
                </Stack>

                {variable.type === "select" && (
                    <Box sx={{ pl: 2, borderLeft: 2, borderColor: "divider" }}>
                        <Typography variant="body2" gutterBottom fontWeight={500}>
                            {t(locale, "template-editor.option-settings")}
                        </Typography>
                        <RadioGroup
                            row
                            value={variable.optionType || "custom"}
                            onChange={(e) => handleChange("optionType", e.target.value)}
                        >
                            <FormControlLabel value="custom" control={<Radio size="small" />} label="직접 입력" />
                            <FormControlLabel value="dataSource" control={<Radio size="small" />} label="시스템 데이터" />
                        </RadioGroup>

                        {variable.optionType === "dataSource" ? (
                            <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                                <InputLabel>데이터 소스</InputLabel>
                                <Select
                                    value={variable.dataSource || ""}
                                    label="데이터 소스"
                                    onChange={(e) => handleChange("dataSource", e.target.value)}
                                >
                                    {DATA_SOURCES.map(ds => (
                                        <MenuItem key={ds.id} value={ds.id}>{ds.label}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        ) : (
                            <TextField
                                fullWidth
                                size="small"
                                label="옵션 (쉼표로 구분)"
                                value={variable.options?.join(", ") || ""}
                                onChange={(e) => handleChange("options", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                                placeholder="예: VIP, 일반, 신규"
                                sx={{ mt: 1 }}
                            />
                        )}
                    </Box>
                )}

                {variable.type === "number" && (
                    <Stack direction="row" spacing={2}>
                        <TextField
                            type="number"
                            label="최소값"
                            value={variable.min ?? ""}
                            onChange={(e) => handleChange("min", e.target.value ? Number(e.target.value) : undefined)}
                            size="small"
                        />
                        <TextField
                            type="number"
                            label="최대값"
                            value={variable.max ?? ""}
                            onChange={(e) => handleChange("max", e.target.value ? Number(e.target.value) : undefined)}
                            size="small"
                        />
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
};
