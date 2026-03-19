"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import {
    Employee,
    CreateEmployeeDto,
    UpdateEmployeeDto,
    useCreateEmployee,
    useUpdateEmployee,
    employeeQueryKeys,
} from "@/hooks/useEmployees";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import {
    Dialog,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { TitleDescChildrenMolecule } from "@/components/app/ui/TitleDescChildrenMolecule";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import {
    DEFAULT_EMPLOYEE_GRADE,
    formatWorkAreaLabel,
    GRADES,
    WORK_AREAS,
    normalizeEmployeeGrade,
} from "@/components/app/employees/employee-form.constants";

interface EmployeeFormDialogProps {
    open: boolean;
    onClose: () => void;
    employee?: Employee | null;
    onSuccess?: (employee: Employee) => void;
}

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
    grade: DEFAULT_EMPLOYEE_GRADE,
    openToNextWork: true,
};

const FIELD_GRID_CLASS_NAME = "grid grid-cols-1 gap-4 sm:grid-cols-2";
const LABEL_CLASS_NAME = "text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-v3-text-muted";
const V3_INPUT_CLASS_NAME = "h-12 rounded-[16px] border-[1.5px] border-v3-border bg-white px-4 text-[0.85rem] text-v3-dark shadow-none transition-all focus-visible:border-v3-primary focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]";
const OPTION_CLASS_NAME = "rounded-[14px] border-[1.5px] px-4 py-2.5 text-[0.8rem] font-semibold transition-all";

function formatPhoneNumber(value: string): string {
    const numbers = value.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
}

function parsePhoneNumber(value: string): string {
    return value.replace(/[^\d]/g, "");
}

export function EmployeeFormDialog({ open, onClose, employee, onSuccess }: EmployeeFormDialogProps) {
    const locale = useLocale();
    const queryClient = useQueryClient();
    const [formData, setFormData] = useState<FormData>(initialFormData);
    const [touched, setTouched] = useState({
        phone: false,
        workArea: false,
    });
    const [error, setError] = useState<string | null>(null);

    const createMutation = useCreateEmployee();
    const updateMutation = useUpdateEmployee();
    const prefillName = useEmployeeDialogStore((state) => state.prefillName);

    const isEditMode = !!employee;
    const isLoading = createMutation.isPending || updateMutation.isPending;
    const isPhoneValid = formData.phone.length > 0;
    const isWorkAreaValid = formData.workArea.length > 0;
    const isFormValid = !!formData.name.trim() && isPhoneValid && isWorkAreaValid;

    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;
        const nextFormData = employee
            ? {
                name: employee.name,
                workArea: employee.workArea,
                phone: employee.phone,
                grade: normalizeEmployeeGrade(employee.grade),
                openToNextWork: employee.openToNextWork,
            }
            : {
                ...initialFormData,
                name: prefillName || "",
            };

        queueMicrotask(() => {
            if (cancelled) {
                return;
            }

            setFormData(nextFormData);
            setTouched({ phone: false, workArea: false });
            setError(null);
        });

        return () => {
            cancelled = true;
        };
    }, [employee, open, prefillName]);

    const handleChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const toggleWorkArea = (area: string) => {
        setFormData((prev) => ({
            ...prev,
            workArea: prev.workArea.includes(area)
                ? prev.workArea.filter((selectedArea) => selectedArea !== area)
                : [...prev.workArea, area],
        }));
    };

    const handleSubmit = async () => {
        setTouched({ phone: true, workArea: true });
        setError(null);

        if (!formData.name.trim() || !isPhoneValid || !isWorkAreaValid) {
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

                const updatedEmployee = await updateMutation.mutateAsync({ id: employee.id, dto });

                if (updatedEmployee && ("code" in updatedEmployee || "statusCode" in updatedEmployee)) {
                    setError(getErrorMessage(updatedEmployee, locale, "employees.form.error-update-failed"));
                    return;
                }

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

                const newEmployee = await createMutation.mutateAsync(dto);

                if (newEmployee && ("code" in newEmployee || "statusCode" in newEmployee)) {
                    setError(getErrorMessage(newEmployee, locale, "employees.form.error-create-failed"));
                    return;
                }

                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                onSuccess?.(newEmployee);
            }

            onClose();
        } catch (submitError: unknown) {
            console.error("[EmployeeFormDialog] Failed to save employee:", submitError);
            setError(getErrorMessage(submitError, locale, "employees.form.error-save-failed"));
        }
    };

    const handleClose = () => {
        setFormData(initialFormData);
        setTouched({ phone: false, workArea: false });
        setError(null);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
            <FormDialogShell
                dataComponent="employees-form-dialog"
                eyebrow="Employee Profile"
                title={
                    isEditMode
                        ? t(locale, "employees.form.edit-title")
                        : t(locale, "employees.form.create-title")
                }
                description="이름, 연락처, 등급과 근무 가능 지역을 한 번에 정리합니다."
                dialogClassName="w-[min(720px,calc(100vw-1.5rem))] max-w-[720px] max-h-[90vh]"
                footer={
                    <div className="ml-auto flex w-full flex-col-reverse gap-2 sm:w-[360px] sm:flex-row sm:justify-end">
                        <Button
                            variant="neutral"
                            size="md"
                            onClick={handleClose}
                            disabled={isLoading}
                            data-component="employees-form-dialog-cancel"
                            className="w-full sm:flex-1"
                        >
                            {t(locale, "common.cancel")}
                        </Button>
                        <Button
                            variant="positive"
                            size="md"
                            onClick={handleSubmit}
                            disabled={isLoading || !isFormValid}
                            data-component="employees-form-dialog-submit"
                            className="w-full sm:flex-1"
                        >
                            {isLoading ? (
                                <Spinner className="h-4 w-4" />
                            ) : isEditMode ? (
                                t(locale, "common.save")
                            ) : (
                                t(locale, "common.create")
                            )}
                        </Button>
                    </div>
                }
            >
                    {error && (
                        <Alert
                            variant="destructive"
                            data-component="employees-form-dialog-error"
                            className="rounded-[18px] border-none bg-v3-burgundy-light px-4 py-3 text-v3-burgundy [&>svg]:text-v3-burgundy"
                        >
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <TitleDescChildrenMolecule
                        data-component="employees-form-dialog-section-basic"
                        title={t(locale, "employees.form.section-basic")}
                        description="제공인력의 기본 정보를 입력해 주세요."
                        className="rounded-[24px] border border-v3-border/70 bg-white p-5"
                    >
                        <div data-component="employees-form-dialog-field-name" className="space-y-2">
                            <Label htmlFor="name" className={LABEL_CLASS_NAME}>
                                {t(locale, "employees.form.name")}
                                <span className="ml-1 text-v3-burgundy">*</span>
                            </Label>
                            <Input
                                id="name"
                                variant="v3"
                                value={formData.name}
                                onChange={(e) => handleChange("name", e.target.value)}
                                placeholder="홍길동"
                                className={V3_INPUT_CLASS_NAME}
                            />
                        </div>

                        <div data-component="employees-form-dialog-grid" className={FIELD_GRID_CLASS_NAME}>
                            <div data-component="employees-form-dialog-field-phone" className="space-y-2">
                                <Label htmlFor="phone" className={LABEL_CLASS_NAME}>
                                    {t(locale, "employees.form.phone")}
                                    <span className="ml-1 text-v3-burgundy">*</span>
                                </Label>
                                <Input
                                    id="phone"
                                    variant="v3"
                                    placeholder="010-1234-5678"
                                    value={formatPhoneNumber(formData.phone)}
                                    onChange={(e) => handleChange("phone", parsePhoneNumber(e.target.value))}
                                    onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                                    maxLength={13}
                                    className={cn(
                                        V3_INPUT_CLASS_NAME,
                                        touched.phone && !isPhoneValid && "border-v3-burgundy focus-visible:border-v3-burgundy"
                                    )}
                                />
                                {touched.phone && !isPhoneValid && (
                                    <p className="text-[0.75rem] font-medium text-v3-burgundy">
                                        {t(locale, "employees.form.phone-required")}
                                    </p>
                                )}
                            </div>

                            <div data-component="employees-form-dialog-field-grade" className="space-y-2">
                                <Label className={LABEL_CLASS_NAME}>
                                    {t(locale, "employees.form.grade")}
                                    <span className="ml-1 text-v3-burgundy">*</span>
                                </Label>
                                <Select value={formData.grade} onValueChange={(value) => handleChange("grade", value)}>
                                    <SelectTrigger className="h-12 w-full">
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
                    </TitleDescChildrenMolecule>

                    <TitleDescChildrenMolecule
                        data-component="employees-form-dialog-section-work"
                        title={t(locale, "employees.form.section-work")}
                        description="근무 가능 지역과 근무 가능 여부를 설정해 주세요."
                        className="rounded-[24px] border border-v3-border/70 bg-white p-5"
                    >
                        <fieldset
                            className="space-y-3"
                            onBlurCapture={() => setTouched((prev) => ({ ...prev, workArea: true }))}
                        >
                            <legend className={LABEL_CLASS_NAME}>
                                {t(locale, "employees.form.work-area")}
                                <span className="ml-1 text-v3-burgundy">*</span>
                            </legend>

                            <div
                                data-component="employees-form-dialog-field-work-area-options"
                                className={cn(
                                    "flex flex-wrap gap-3"
                                )}
                            >
                                {WORK_AREAS.map((area) => {
                                    const isSelected = formData.workArea.includes(area);

                                    return (
                                        <button
                                            key={area}
                                            type="button"
                                            onClick={() => toggleWorkArea(area)}
                                            className={cn(
                                                OPTION_CLASS_NAME,
                                                isSelected
                                                    ? "border-v3-primary bg-v3-primary-light text-v3-primary"
                                                    : "border-v3-border bg-white text-v3-text-muted hover:border-v3-primary/40 hover:text-v3-dark"
                                            )}
                                        >
                                            {isSelected && <Check className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={2.5} />}
                                            {formatWorkAreaLabel(area)}
                                        </button>
                                    );
                                })}
                            </div>

                            {touched.workArea && !isWorkAreaValid && (
                                <p className="text-[0.75rem] font-medium text-v3-burgundy">
                                    {t(locale, "employees.form.work-area-required")}
                                </p>
                            )}
                        </fieldset>

                        <TitleDescChildrenMolecule
                            data-component="employees-form-dialog-field-open-status"
                            title={t(locale, "employees.form.open-to-next-work")}
                            className="space-y-3"
                            bodyClassName="space-y-0"
                            titleClassName={LABEL_CLASS_NAME}
                        >
                            <div className="flex flex-wrap gap-3">
                                {[
                                    { value: true, label: "가능" },
                                    { value: false, label: "불가" },
                                ].map((option) => (
                                    <button
                                        key={String(option.value)}
                                        type="button"
                                        onClick={() => handleChange("openToNextWork", option.value)}
                                        className={cn(
                                            OPTION_CLASS_NAME,
                                            formData.openToNextWork === option.value
                                                ? "border-v3-primary bg-v3-primary-light text-v3-primary"
                                                : "border-v3-border bg-white text-v3-text-muted hover:border-v3-primary/40 hover:text-v3-dark"
                                        )}
                                    >
                                        {formData.openToNextWork === option.value && (
                                            <Check className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={2.5} />
                                        )}
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </TitleDescChildrenMolecule>
                    </TitleDescChildrenMolecule>
            </FormDialogShell>
        </Dialog>
    );
}
