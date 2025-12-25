"use client";

import { useState, useEffect } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Grid,
    FormControlLabel,
    Switch,
    Chip,
    Box,
    OutlinedInput,
    SelectChangeEvent,
} from "@mui/material";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import {
    Employee,
    CreateEmployeeDto,
    UpdateEmployeeDto,
    useCreateEmployee,
    useUpdateEmployee,
} from "@/app/hooks/useEmployees";

interface EmployeeFormDialogProps {
    open: boolean;
    onClose: () => void;
    employee?: Employee | null;
}

const WORK_AREAS = ["인천 연수구", "인천 남동구", "인천 부평구", "인천 계양구", "인천 미추홀구", "인천 서구"];
const GRADES = ["1급", "2급", "3급"];

interface FormData {
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
}

const initialFormData: FormData = {
    name: "",
    workArea: [],
    phone: "",
    grade: "",
    openToNextWork: true,
};

export function EmployeeFormDialog({ open, onClose, employee }: EmployeeFormDialogProps) {
    const locale = useLocale();
    const [formData, setFormData] = useState<FormData>(initialFormData);
    
    const createMutation = useCreateEmployee();
    const updateMutation = useUpdateEmployee();
    
    const isEditMode = !!employee;
    const isLoading = createMutation.isPending || updateMutation.isPending;

    useEffect(() => {
        if (employee) {
            setFormData({
                name: employee.name,
                workArea: employee.workArea,
                phone: employee.phone,
                grade: employee.grade,
                openToNextWork: employee.openToNextWork,
            });
        } else {
            setFormData(initialFormData);
        }
    }, [employee, open]);

    const handleChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const formatPhoneNumber = (value: string): string => {
        const numbers = value.replace(/[^\d]/g, "");
        if (numbers.length <= 3) return numbers;
        if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
        return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
    };

    const parsePhoneNumber = (value: string): string => {
        return value.replace(/[^\d]/g, "");
    };

    const handleSubmit = async () => {
        if (!formData.name.trim()) return;
        
        try {
            if (isEditMode && employee) {
                const dto: UpdateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: parsePhoneNumber(formData.phone),
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                };
                await updateMutation.mutateAsync({ id: employee.id, dto });
            } else {
                const dto: CreateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: parsePhoneNumber(formData.phone),
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                };
                await createMutation.mutateAsync(dto);
            }
            onClose();
        } catch (error) {
            console.error("Failed to save employee:", error);
        }
    };

    const handleClose = () => {
        setFormData(initialFormData);
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                {isEditMode 
                    ? t(locale, "employees.form.edit-title")
                    : t(locale, "employees.form.create-title")}
            </DialogTitle>
            <DialogContent dividers>
                <Grid container spacing={2} sx={{ mt: 0.5 }}>
                    {/* Name */}
                    <Grid size={{ xs: 12 }}>
                        <TextField
                            fullWidth
                            required
                            label={t(locale, "employees.form.name")}
                            value={formData.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                        />
                    </Grid>

                    {/* Phone */}
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField
                            fullWidth
                            label={t(locale, "employees.form.phone")}
                            value={formatPhoneNumber(formData.phone)}
                            onChange={(e) => handleChange("phone", parsePhoneNumber(e.target.value))}
                            placeholder="010-1234-5678"
                            inputProps={{ maxLength: 13 }}
                        />
                    </Grid>

                    {/* Work Area - Multi-select */}
                    <Grid size={{ xs: 12 }}>
                        <FormControl fullWidth>
                            <InputLabel>{t(locale, "employees.form.work-area")}</InputLabel>
                            <Select<string[]>
                                multiple
                                value={formData.workArea}
                                label={t(locale, "employees.form.work-area")}
                                onChange={(e: SelectChangeEvent<string[]>) => {
                                    const value = e.target.value;
                                    handleChange("workArea", typeof value === "string" ? value.split(",") : value);
                                }}
                                input={<OutlinedInput label={t(locale, "employees.form.work-area")} />}
                                renderValue={(selected: string[]) => (
                                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                        {selected.map((value: string) => (
                                            <Chip key={value} label={value} size="small" />
                                        ))}
                                    </Box>
                                )}
                            >
                                {WORK_AREAS.map((area) => (
                                    <MenuItem key={area} value={area}>
                                        {area}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Grade */}
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <FormControl fullWidth>
                            <InputLabel>{t(locale, "employees.form.grade")}</InputLabel>
                            <Select
                                value={formData.grade}
                                label={t(locale, "employees.form.grade")}
                                onChange={(e) => handleChange("grade", e.target.value)}
                            >
                                {GRADES.map((grade) => (
                                    <MenuItem key={grade} value={grade}>
                                        {grade}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Open to Next Work */}
                    <Grid size={{ xs: 12, sm: 6 }} sx={{ display: "flex", alignItems: "center" }}>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={formData.openToNextWork}
                                    onChange={(e) => handleChange("openToNextWork", e.target.checked)}
                                    color="primary"
                                />
                            }
                            label={t(locale, "employees.form.open-to-next-work")}
                        />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={isLoading}>
                    {t(locale, "common.cancel")}
                </Button>
                <Button 
                    variant="contained" 
                    onClick={handleSubmit} 
                    disabled={isLoading || !formData.name.trim()}
                >
                    {isLoading 
                        ? t(locale, "common.saving")
                        : isEditMode 
                            ? t(locale, "common.save")
                            : t(locale, "common.create")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

