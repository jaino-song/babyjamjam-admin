"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Spinner } from "@/components/ui/spinner";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import {
    FormField,
    FormGrid,
    FormHelperText,
    FormNativeSelect,
    FormSection,
    FormSwitchRow,
    FormTextInput,
} from "@/components/app/ui/form-section";
import {
    SteppedWizardPanelContent,
} from "@/components/app/v3/SteppedWizardPanelLayout";
import {
    DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME,
    DETAIL_PANEL_FOOTER_CLASS_NAME,
    DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME,
} from "@/components/app/v3/DetailPanel";
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

interface EmployeeFormPanelProps extends Omit<EmployeeFormDialogProps, "open"> {
    open?: boolean;
    renderLayout?: (slots: { content: ReactNode; footer: ReactNode }) => ReactNode;
}

interface FormData {
    name: string;
    workArea: string[];
    phone: string;
    grade: string;
    openToNextWork: boolean;
    birthday: string;
}

const initialFormData: FormData = {
    name: "",
    workArea: [],
    phone: "",
    grade: DEFAULT_EMPLOYEE_GRADE,
    openToNextWork: true,
    birthday: "",
};

const GRADE_OPTIONS = [
    { value: GRADES[2], label: GRADES[2] },
    { value: GRADES[1], label: GRADES[1] },
    { value: GRADES[0], label: GRADES[0] },
] as const;

const WORK_AREA_OPTIONS = WORK_AREAS.map((area) => ({
    value: area,
    label: formatWorkAreaLabel(area),
}));

const PANEL_CONTENT_CLASS_NAME = "h-auto min-h-full";
const PANEL_FIELDS_CLASS_NAME = "grid w-full grid-cols-1 gap-[calc(16px*var(--v3-ui-scale,1))] pb-[calc(24px*var(--v3-ui-scale,1))] md:grid-cols-2";
const PANEL_FULL_FIELD_CLASS_NAME = "md:col-span-2";

function formatPhoneNumber(value: string): string {
    const numbers = value.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
}

function parsePhoneNumber(value: string): string {
    return value.replace(/[^\d]/g, "");
}

export function EmployeeFormPanel({
    open = true,
    onClose,
    employee,
    onSuccess,
    renderLayout,
}: EmployeeFormPanelProps) {
    return (
        <EmployeeFormContent
            surface="panel"
            open={open}
            onClose={onClose}
            employee={employee}
            onSuccess={onSuccess}
            renderLayout={renderLayout}
        />
    );
}

export function EmployeeFormDialog({ open, onClose, employee, onSuccess }: EmployeeFormDialogProps) {
    return (
        <EmployeeFormContent
            surface="dialog"
            open={open}
            onClose={onClose}
            employee={employee}
            onSuccess={onSuccess}
        />
    );
}

function EmployeeFormContent({
    surface,
    open,
    onClose,
    employee,
    onSuccess,
    renderLayout,
}: EmployeeFormDialogProps & Pick<EmployeeFormPanelProps, "renderLayout"> & { surface: "dialog" | "panel" }) {
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
    const requiredFieldProgressText = `필수 항목 4개 중 ${
        [
            Boolean(formData.name.trim()),
            isPhoneValid,
            Boolean(formData.grade),
            isWorkAreaValid,
        ].filter(Boolean).length
    }개 입력됨`;

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
                birthday: employee.birthday ?? "",
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
                    birthday: formData.birthday,
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
                    birthday: formData.birthday,
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

    const dialogFooter = (
        <div className="ml-auto flex w-full flex-col-reverse gap-2 sm:w-[300px] sm:flex-row sm:justify-end">
            <Button
                variant="neutral"
                size="sm"
                onClick={handleClose}
                disabled={isLoading}
                data-component="employees-form-dialog-cancel"
                className="w-full sm:flex-1"
            >
                {t(locale, "common.cancel")}
            </Button>
            <Button
                variant="positive"
                size="sm"
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
    );

    const panelFooter = (
        <div className="flex w-full flex-wrap items-center justify-between gap-[calc(12px*var(--v3-ui-scale,1))]">
            <span className={DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME}>{requiredFieldProgressText}</span>
            <div className={DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME}>
                <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={handleClose}
                    disabled={isLoading}
                    data-component="employees-form-panel-cancel"
                    className="min-w-[calc(132px*var(--v3-ui-scale,1))]"
                >
                    {t(locale, "common.cancel")}
                </Button>
                <Button
                    type="button"
                    variant="positive"
                    size="sm"
                    onClick={handleSubmit}
                    disabled={isLoading || !isFormValid}
                    data-component="employees-form-panel-submit"
                    className="min-w-[calc(132px*var(--v3-ui-scale,1))]"
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
        </div>
    );

    const feedback = error ? (
        <Alert
            variant="destructive"
            data-component="employees-form-dialog-error"
            className="rounded-[18px] border-none bg-v3-burgundy-light px-4 py-3 text-v3-burgundy [&>svg]:text-v3-burgundy"
        >
            <AlertDescription>{error}</AlertDescription>
        </Alert>
    ) : null;

    const formSections = (
        <>
            <FormSection
                data-component="employees-form-dialog-section-basic"
                title={t(locale, "employees.form.section-basic")}
                description="제공인력의 기본 정보를 입력해 주세요."
                headerDataComponent="employees-form-dialog-section-basic-head"
                titleDataComponent="employees-form-dialog-section-basic-title"
                descriptionDataComponent="employees-form-dialog-section-basic-caption"
            >
                <FormGrid data-component="employees-form-dialog-grid">
                    <FormField
                        data-component="employees-form-dialog-field-name"
                        htmlFor="name"
                        label={t(locale, "employees.form.name")}
                        required
                    >
                        <FormTextInput
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleChange("name", e.target.value)}
                            placeholder="홍길동"
                        />
                    </FormField>

                    <FormField
                        data-component="employees-form-dialog-field-phone"
                        htmlFor="phone"
                        label={t(locale, "employees.form.phone")}
                        required
                    >
                        <FormTextInput
                            id="phone"
                            placeholder="010-1234-5678"
                            value={formatPhoneNumber(formData.phone)}
                            onChange={(e) => handleChange("phone", parsePhoneNumber(e.target.value))}
                            onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                            maxLength={13}
                            error={touched.phone && !isPhoneValid}
                        />
                        {touched.phone && !isPhoneValid && (
                            <FormHelperText tone="error" data-component="employees-form-dialog-field-phone-error">
                                {t(locale, "employees.form.phone-required")}
                            </FormHelperText>
                        )}
                    </FormField>

                    <FormField
                        data-component="employees-form-dialog-field-birthday"
                        htmlFor="birthday"
                        label="생년월일 (YYMMDD)"
                    >
                        <FormTextInput
                            id="birthday"
                            value={formData.birthday}
                            onChange={(e) => handleChange("birthday", e.target.value)}
                            placeholder="YYMMDD"
                            maxLength={6}
                            inputMode="numeric"
                        />
                    </FormField>
                </FormGrid>
            </FormSection>

            <FormSection
                data-component="employees-form-dialog-section-work"
                title={t(locale, "employees.form.section-work")}
                description="필요한 범위만 선택하고 나중에 수정할 수 있습니다."
                headerDataComponent="employees-form-dialog-section-work-head"
                titleDataComponent="employees-form-dialog-section-work-title"
                descriptionDataComponent="employees-form-dialog-section-work-caption"
            >
                <FormGrid data-component="employees-form-dialog-work-grid">
                    <FormField
                        data-component="employees-form-dialog-field-grade"
                        htmlFor="employee-form-grade"
                        label={t(locale, "employees.form.grade")}
                        required
                    >
                        <FormNativeSelect
                            id="employee-form-grade"
                            value={formData.grade}
                            options={GRADE_OPTIONS}
                            onValueChange={(value) => handleChange("grade", value)}
                            wrapDataComponent="employees-form-dialog-field-grade-select-wrap"
                            selectDataComponent="employees-form-dialog-field-grade-select"
                            iconDataComponent="employees-form-dialog-field-grade-select-icon"
                        />
                    </FormField>

                    <FormField
                        data-component="employees-form-dialog-field-work-area"
                        htmlFor="employee-form-work-area"
                        label={t(locale, "employees.form.work-area")}
                        required
                        onBlurCapture={() => setTouched((prev) => ({ ...prev, workArea: true }))}
                    >
                        <FormNativeSelect
                            id="employee-form-work-area"
                            value={formData.workArea[0] ?? ""}
                            options={WORK_AREA_OPTIONS}
                            placeholder="근무 지역 선택"
                            onValueChange={(value) => {
                                handleChange("workArea", value ? [value] : []);
                                setTouched((prev) => ({ ...prev, workArea: true }));
                            }}
                            wrapDataComponent="employees-form-dialog-field-work-area-select-wrap"
                            selectDataComponent="employees-form-dialog-field-work-area-select"
                            iconDataComponent="employees-form-dialog-field-work-area-select-icon"
                        />

                        {touched.workArea && !isWorkAreaValid && (
                            <FormHelperText tone="error" data-component="employees-form-dialog-field-work-area-error">
                                {t(locale, "employees.form.work-area-required")}
                            </FormHelperText>
                        )}
                    </FormField>
                </FormGrid>

                <FormField data-component="employees-form-dialog-field-open-status" label="근무 가능 여부">
                    <FormSwitchRow
                        data-component="employees-form-dialog-field-open-status-control"
                        title="다음 근무 배정 가능"
                        description="고객 생성 완료 후 배정 후보에 표시합니다."
                        checked={formData.openToNextWork}
                        onToggle={() => handleChange("openToNextWork", !formData.openToNextWork)}
                        buttonAriaLabel="다음 근무 배정 가능"
                        copyDataComponent="employees-form-dialog-field-open-status-copy"
                        titleDataComponent="employees-form-dialog-field-open-status-title"
                        descriptionDataComponent="employees-form-dialog-field-open-status-description"
                        buttonDataComponent="employees-form-dialog-field-open-status-switch"
                        thumbDataComponent="employees-form-dialog-field-open-status-switch-thumb"
                    />
                </FormField>

            </FormSection>
        </>
    );

    const dialogContent = (
        <div data-component="employees-form-content" className="space-y-5">
            {feedback}
            {formSections}
        </div>
    );

    const panelFields = (
        <>
            <FormField
                data-component="employees-form-panel-name-field"
                htmlFor="employee-panel-name"
                label={
                    <>
                        {t(locale, "employees.form.name")}
                        <span className="ml-1 text-v3-burgundy">*</span>
                    </>
                }
            >
                <FormTextInput
                    id="employee-panel-name"
                    value={formData.name}
                    onChange={(event) => handleChange("name", event.target.value)}
                    placeholder="홍길동"
                    data-component="employees-form-panel-name-input"
                />
            </FormField>

            <FormField
                data-component="employees-form-panel-phone-field"
                htmlFor="employee-panel-phone"
                label={
                    <>
                        {t(locale, "employees.form.phone")}
                        <span className="ml-1 text-v3-burgundy">*</span>
                    </>
                }
            >
                <FormTextInput
                    id="employee-panel-phone"
                    value={formatPhoneNumber(formData.phone)}
                    onChange={(event) => handleChange("phone", parsePhoneNumber(event.target.value))}
                    onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                    maxLength={13}
                    placeholder="010-1234-5678"
                    error={touched.phone && !isPhoneValid}
                    data-component="employees-form-panel-phone-input"
                />
                {touched.phone && !isPhoneValid && (
                    <FormHelperText tone="error" data-component="employees-form-panel-phone-error">
                        {t(locale, "employees.form.phone-required")}
                    </FormHelperText>
                )}
            </FormField>

            <FormField
                data-component="employees-form-panel-birthday-field"
                htmlFor="employee-panel-birthday"
                label="생년월일 (YYMMDD)"
            >
                <FormTextInput
                    id="employee-panel-birthday"
                    value={formData.birthday}
                    onChange={(event) => handleChange("birthday", event.target.value)}
                    placeholder="YYMMDD"
                    maxLength={6}
                    data-component="employees-form-panel-birthday-input"
                />
            </FormField>

            <FormField
                data-component="employees-form-panel-grade-field"
                htmlFor="employee-panel-grade"
                label={
                    <>
                    {t(locale, "employees.form.grade")}
                    <span className="ml-1 text-v3-burgundy">*</span>
                    </>
                }
            >
                <FormNativeSelect
                    id="employee-panel-grade"
                    value={formData.grade}
                    options={GRADE_OPTIONS}
                    onValueChange={(value) => handleChange("grade", value)}
                    wrapDataComponent="employees-form-panel-grade-select-wrap"
                    selectDataComponent="employees-form-panel-grade-select"
                    iconDataComponent="employees-form-panel-grade-select-icon"
                />
            </FormField>

            <FormField
                data-component="employees-form-panel-work-area-field"
                htmlFor="employee-panel-work-area"
                label={
                    <>
                    {t(locale, "employees.form.work-area")}
                    <span className="ml-1 text-v3-burgundy">*</span>
                    </>
                }
            >
                <FormNativeSelect
                    id="employee-panel-work-area"
                    value={formData.workArea[0] ?? ""}
                    options={WORK_AREA_OPTIONS}
                    placeholder="근무 지역 선택"
                    onValueChange={(value) => {
                        handleChange("workArea", value ? [value] : []);
                        setTouched((prev) => ({ ...prev, workArea: true }));
                    }}
                    wrapDataComponent="employees-form-panel-work-area-select-wrap"
                    selectDataComponent="employees-form-panel-work-area-select"
                    iconDataComponent="employees-form-panel-work-area-select-icon"
                />
                {touched.workArea && !isWorkAreaValid && (
                    <FormHelperText tone="error" data-component="employees-form-panel-work-area-error">
                        {t(locale, "employees.form.work-area-required")}
                    </FormHelperText>
                )}
            </FormField>

            <FormSwitchRow
                data-component="employees-form-panel-open-status-field"
                className={PANEL_FULL_FIELD_CLASS_NAME}
                title={t(locale, "employees.form.open-to-next-work")}
                checked={formData.openToNextWork}
                onToggle={() => handleChange("openToNextWork", !formData.openToNextWork)}
                buttonAriaLabel={t(locale, "employees.form.open-to-next-work")}
                buttonDataComponent="employees-form-panel-open-status-switch"
                thumbDataComponent="employees-form-panel-open-status-switch-thumb"
            />
        </>
    );

    const panelContent = (
        <SteppedWizardPanelContent
            dataComponent="employees-form-panel-content"
            stepContentDataComponent="employees-form-panel-fields"
            className={PANEL_CONTENT_CLASS_NAME}
            stepContentClassName={PANEL_FIELDS_CLASS_NAME}
            feedback={feedback}
        >
            {panelFields}
        </SteppedWizardPanelContent>
    );

    if (surface === "panel") {
        if (!open) return null;

        return renderLayout ? (
            <>{renderLayout({ content: panelContent, footer: panelFooter })}</>
        ) : (
            <div data-component="employees-form-panel" className="flex h-full min-h-0 flex-col">
                <div data-component="employees-form-panel-content-fallback" className="min-h-0 flex-1 overflow-y-auto">
                    {panelContent}
                </div>
                <footer data-component="detail-panel-footer" className={DETAIL_PANEL_FOOTER_CLASS_NAME}>
                    {panelFooter}
                </footer>
            </div>
        );
    }

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
            <FormDialogShell
                dataComponent="employees-form-dialog"
                title={
                    isEditMode
                        ? t(locale, "employees.form.edit-title")
                        : t(locale, "employees.form.create-title")
                }
                footer={dialogFooter}
            >
                {dialogContent}
            </FormDialogShell>
        </Dialog>
    );
}
