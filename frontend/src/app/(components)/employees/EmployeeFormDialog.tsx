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
    Alert,
} from "@mui/material";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { getErrorMessage } from "@/app/lib/errors/prisma-error-mapper";
import {
    Employee,
    CreateEmployeeDto,
    UpdateEmployeeDto,
    useCreateEmployee,
    useUpdateEmployee,
    employeeQueryKeys,
} from "@/app/hooks/useEmployees";
import { useQueryClient } from "@tanstack/react-query";
import { useEmployeeDialogStore } from "@/app/store/employee-dialog-store";

interface EmployeeFormDialogProps {
    open: boolean;
    onClose: () => void;
    employee?: Employee | null;
    onSuccess?: (employee: Employee) => void;
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
    grade: "3급", // Default to 3급
    openToNextWork: true,
};

export function EmployeeFormDialog({ open, onClose, employee, onSuccess }: EmployeeFormDialogProps) {
    const locale = useLocale();
    const queryClient = useQueryClient();
    const [formData, setFormData] = useState<FormData>(initialFormData);

    // Track which fields have been touched for validation display
    const [touched, setTouched] = useState({
        phone: false,
        workArea: false,
    });

    // Error state for displaying API errors
    const [error, setError] = useState<string | null>(null);

    const createMutation = useCreateEmployee();
    const updateMutation = useUpdateEmployee();

    // Read pre-filled name from Zustand store
    const prefillName = useEmployeeDialogStore((state) => state.prefillName);

    const isEditMode = !!employee;
    const isLoading = createMutation.isPending || updateMutation.isPending;

    // Validation helpers
    const isPhoneValid = formData.phone.length > 0;
    const isWorkAreaValid = formData.workArea.length > 0;
    const isFormValid = formData.name.trim() && isPhoneValid && isWorkAreaValid;

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
            // In create mode, use prefillName from store if available
            setFormData({
                ...initialFormData,
                name: prefillName || "",
            });
        }
        // Reset touched state and error when dialog opens
        setTouched({ phone: false, workArea: false });
        setError(null);
    }, [employee, open, prefillName]);

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
        // Mark all fields as touched to show any validation errors
        setTouched({ phone: true, workArea: true });
        setError(null); // Clear any previous error

        console.log("[EmployeeFormDialog] handleSubmit called, formData:", formData);
        console.log("[EmployeeFormDialog] Validation: name=", formData.name.trim(), "phone=", isPhoneValid, "workArea=", isWorkAreaValid);

        // Validate all required fields
        if (!formData.name.trim() || !isPhoneValid || !isWorkAreaValid) {
            console.log("[EmployeeFormDialog] Validation failed, returning early");
            return;
        }

        try {
            if (isEditMode && employee) {
                const dto: UpdateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: parsePhoneNumber(formData.phone),
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                };
                console.log("[EmployeeFormDialog] Updating employee with dto:", dto);
                const updatedEmployee = await updateMutation.mutateAsync({ id: employee.id, dto });
                console.log("[EmployeeFormDialog] Update result:", updatedEmployee);

                // Check if the response is an error (has statusCode or code property)
                if (updatedEmployee && ('code' in updatedEmployee || 'statusCode' in updatedEmployee)) {
                    console.error("[EmployeeFormDialog] Update returned error:", updatedEmployee);
                    setError(getErrorMessage(updatedEmployee, locale, "employees.form.error-update-failed"));
                    return;
                }

                // Wait for the employees query to refetch so the Autocomplete can find the employee
                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                onSuccess?.(updatedEmployee);
            } else {
                const dto: CreateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: parsePhoneNumber(formData.phone),
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                };
                console.log("[EmployeeFormDialog] Creating employee with dto:", dto);
                const newEmployee = await createMutation.mutateAsync(dto);
                console.log("[EmployeeFormDialog] Create result:", newEmployee);

                // Check if the response is an error (has statusCode or code property)
                if (newEmployee && ('code' in newEmployee || 'statusCode' in newEmployee)) {
                    console.error("[EmployeeFormDialog] Create returned error:", newEmployee);
                    setError(getErrorMessage(newEmployee, locale, "employees.form.error-create-failed"));
                    return;
                }

                // Wait for the employees query to refetch so the Autocomplete can find the new employee
                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                console.log("[EmployeeFormDialog] Calling onSuccess with:", newEmployee);
                onSuccess?.(newEmployee);
            }
            console.log("[EmployeeFormDialog] Calling onClose");
            onClose();
        } catch (error: unknown) {
            console.error("[EmployeeFormDialog] Failed to save employee:", error);
            setError(getErrorMessage(error, locale, "employees.form.error-save-failed"));
        }
    };

    const handleClose = () => {
        setFormData(initialFormData);
        setError(null);
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth data-component="EmployeeFormDialog">
            <DialogTitle>
                {isEditMode
                    ? t(locale, "employees.form.edit-title")
                    : t(locale, "employees.form.create-title")}
            </DialogTitle>
            <DialogContent dividers data-component="EmployeeFormDialog-Content">
                {/* Error Alert */}
                {error && (
                    <Alert
                        severity="error"
                        sx={{ mb: 2 }}
                        onClose={() => setError(null)}
                        data-component="EmployeeFormDialog-ErrorAlert"
                    >
                        {error}
                    </Alert>
                )}
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
                            required
                            label={t(locale, "employees.form.phone")}
                            value={formatPhoneNumber(formData.phone)}
                            onChange={(e) => handleChange("phone", parsePhoneNumber(e.target.value))}
                            onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                            placeholder="010-1234-5678"
                            inputProps={{ maxLength: 13 }}
                            error={touched.phone && !isPhoneValid}
                            helperText={touched.phone && !isPhoneValid ? t(locale, "employees.form.phone-required") : undefined}
                        />
                    </Grid>

                    {/* Work Area - Multi-select */}
                    <Grid size={{ xs: 12 }}>
                        <FormControl fullWidth required error={touched.workArea && !isWorkAreaValid}>
                            <InputLabel>{t(locale, "employees.form.work-area")}</InputLabel>
                            <Select<string[]>
                                multiple
                                value={formData.workArea}
                                label={t(locale, "employees.form.work-area")}
                                onChange={(e: SelectChangeEvent<string[]>) => {
                                    const value = e.target.value;
                                    handleChange("workArea", typeof value === "string" ? value.split(",") : value);
                                }}
                                onBlur={() => setTouched((prev) => ({ ...prev, workArea: true }))}
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
                            {touched.workArea && !isWorkAreaValid && (
                                <Box component="span" sx={{ color: "error.main", fontSize: "0.75rem", mt: 0.5, ml: 1.75 }}>
                                    {t(locale, "employees.form.work-area-required")}
                                </Box>
                            )}
                        </FormControl>
                    </Grid>

                    {/* Grade */}
                    <Grid size={{ xs: 12, sm: 6 }}>
                        <FormControl fullWidth required>
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
            <DialogActions data-component="EmployeeFormDialog-Actions">
                <Button onClick={handleClose} disabled={isLoading} data-component="EmployeeFormDialog-CancelButton">
                    {t(locale, "common.cancel")}
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={isLoading || !isFormValid}
                    data-component="EmployeeFormDialog-SubmitButton"
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

