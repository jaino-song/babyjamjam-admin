"use client";

import { useState, useEffect } from "react";
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

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

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

    const toggleWorkArea = (area: string) => {
        setFormData((prev) => {
            const newAreas = prev.workArea.includes(area)
                ? prev.workArea.filter((a) => a !== area)
                : [...prev.workArea, area];
            return { ...prev, workArea: newAreas };
        });
    };

    const removeWorkArea = (area: string) => {
        setFormData((prev) => ({
            ...prev,
            workArea: prev.workArea.filter((a) => a !== area),
        }));
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
        <Dialog
            open={open}
            onOpenChange={(isOpen) => !isOpen && handleClose()}
        >
            <DialogContent
                data-component="EmployeeFormDialog"
                className="max-w-lg max-h-[90vh] overflow-y-auto rounded-lg shadow-xl"
            >
                <DialogHeader>
                    <DialogTitle>
                        {isEditMode
                            ? t(locale, "employees.form.edit-title")
                            : t(locale, "employees.form.create-title")}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {isEditMode
                            ? t(locale, "employees.form.edit-description")
                            : t(locale, "employees.form.create-description")}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4" data-component="EmployeeFormDialog-Content">
                    {/* Error Alert */}
                    {error && (
                        <Alert
                            variant="destructive"
                            data-component="EmployeeFormDialog-ErrorAlert"
                        >
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Name */}
                    <div className="space-y-2">
                        <Label htmlFor="name">
                            {t(locale, "employees.form.name")}
                            <span className="text-destructive ml-1">*</span>
                        </Label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Phone */}
                        <div className="space-y-2">
                            <Label htmlFor="phone">
                                {t(locale, "employees.form.phone")}
                                <span className="text-destructive ml-1">*</span>
                            </Label>
                            <Input
                                id="phone"
                                placeholder="010-1234-5678"
                                value={formatPhoneNumber(formData.phone)}
                                onChange={(e) => handleChange("phone", parsePhoneNumber(e.target.value))}
                                onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                                maxLength={13}
                                className={cn(
                                    touched.phone && !isPhoneValid && "border-destructive focus-visible:ring-destructive"
                                )}
                            />
                            {touched.phone && !isPhoneValid && (
                                <p className="text-xs text-destructive">
                                    {t(locale, "employees.form.phone-required")}
                                </p>
                            )}
                        </div>

                        {/* Grade */}
                        <div className="space-y-2">
                            <Label>
                                {t(locale, "employees.form.grade")}
                                <span className="text-destructive ml-1">*</span>
                            </Label>
                            <Select
                                value={formData.grade}
                                onValueChange={(value) => handleChange("grade", value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t(locale, "employees.form.grade")} />
                                </SelectTrigger>
                                <SelectContent>
                                    {GRADES.map((grade) => (
                                        <SelectItem key={grade} value={grade}>
                                            {grade}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <Separator />

                    {/* Work Area - Multi-select */}
                    <div className="space-y-2">
                        <Label>
                            {t(locale, "employees.form.work-area")}
                            <span className="text-destructive ml-1">*</span>
                        </Label>

                        {/* Selected areas as badges */}
                        {formData.workArea.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                                {formData.workArea.map((area) => (
                                    <Badge key={area} variant="secondary" className="gap-1">
                                        {area}
                                        <button
                                            type="button"
                                            onClick={() => removeWorkArea(area)}
                                            className="ml-1 hover:text-destructive"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                        )}

                        {/* Clickable area options */}
                        <div
                            className={cn(
                                "flex flex-wrap gap-2 p-3 rounded-md border",
                                touched.workArea && !isWorkAreaValid && "border-destructive"
                            )}
                            onBlur={() => setTouched((prev) => ({ ...prev, workArea: true }))}
                        >
                            {WORK_AREAS.map((area) => {
                                const isSelected = formData.workArea.includes(area);
                                return (
                                    <Badge
                                        key={area}
                                        variant={isSelected ? "default" : "outline"}
                                        className={cn(
                                            "cursor-pointer transition-colors",
                                            isSelected
                                                ? "bg-primary text-primary-foreground"
                                                : "hover:bg-muted"
                                        )}
                                        onClick={() => toggleWorkArea(area)}
                                    >
                                        {area}
                                    </Badge>
                                );
                            })}
                        </div>
                        {touched.workArea && !isWorkAreaValid && (
                            <p className="text-xs text-destructive">
                                {t(locale, "employees.form.work-area-required")}
                            </p>
                        )}
                    </div>

                    <Separator />

                    {/* Open to Next Work - Switch */}
                    <div className="flex items-center justify-between">
                        <Label htmlFor="openToNextWork" className="cursor-pointer">
                            {t(locale, "employees.form.open-to-next-work")}
                        </Label>
                        <Switch
                            id="openToNextWork"
                            checked={formData.openToNextWork}
                            onCheckedChange={(checked) => handleChange("openToNextWork", checked)}
                        />
                    </div>
                </div>

                <DialogFooter data-component="EmployeeFormDialog-Actions">
                    <Button
                        variant="outline"
                        onClick={handleClose}
                        disabled={isLoading}
                        data-component="EmployeeFormDialog-CancelButton"
                    >
                        {t(locale, "common.cancel")}
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={isLoading || !isFormValid}
                        data-component="EmployeeFormDialog-SubmitButton"
                    >
                        {isLoading ? (
                            <Spinner className="h-4 w-4" />
                        ) : isEditMode ? (
                            t(locale, "common.save")
                        ) : (
                            t(locale, "common.create")
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
