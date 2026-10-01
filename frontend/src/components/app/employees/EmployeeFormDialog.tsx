"use client";
import { formatBirthdayInput, isValidBirthdayIsoDate, normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import { resolveFieldMessage } from "@babyjamjam/shared/utils/field-validation-message";
import {
    normalizeApiError,
    resolveProblemPresentation,
    type ProblemError,
    type ProblemOutcome,
} from "@babyjamjam/shared";


import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneDigits } from "@/lib/phone";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import { cn } from "@/lib/utils";
import {
    Employee,
    CreateEmployeeDto,
    UpdateEmployeeDto,
    useCreateEmployee,
    useUpdateEmployee,
    employeeQueryKeys,
} from "@/hooks/useEmployees";
import { useEmployeePhoneDuplicateCheck } from "@/hooks/useEmployeePhoneDuplicateCheck";
import { useFieldInputStates } from "@/hooks/useFieldInputStates";
import {
    resolveElevenDigitPhoneMessage,
    toFieldMessageView,
    type FieldMessageView,
} from "@/lib/forms/field-message-text";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import {
    Dialog,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import { FieldMessageText } from "@/components/app/ui/field-message";
import {
    APP_FORM_CONTROL_CLASS_NAME,
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
    onBeforeClose?: () => boolean;
    employee?: Employee | null;
    onSuccess?: (employee: Employee) => void;
}

interface EmployeeFormPanelProps extends Omit<EmployeeFormDialogProps, "open"> {
    open?: boolean;
    renderLayout?: (slots: { content: ReactNode; footer: ReactNode }) => ReactNode;
    onDirtyChange?: (dirty: boolean) => void;
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

function areFormDataEqual(left: FormData, right: FormData): boolean {
    return left.name === right.name
        && left.phone === right.phone
        && left.grade === right.grade
        && left.openToNextWork === right.openToNextWork
        && left.birthday === right.birthday
        && left.workArea.length === right.workArea.length
        && left.workArea.every((area, index) => area === right.workArea[index]);
}

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
const PANEL_FIELDS_CLASS_NAME = "grid w-full grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] md:grid-cols-2";

const EMPLOYEE_FORM_DIALOG_ERROR_ID_PREFIX = "desktop_employees_form-dialog_error";

type EmployeeFormField = "name" | "phone";

const isEmployeeFormField = (field: string): field is EmployeeFormField => field === "name" || field === "phone";

/** Text inputs that show their validation message in the label-row slot. */
type EmployeeInputField = "name" | "phone" | "birthday";

/** Listed in form order: the first one with a problem receives focus on submit. */
const EMPLOYEE_INPUT_FIELDS: readonly EmployeeInputField[] = ["name", "phone", "birthday"];

/** DOM ids by surface; the panel prefixes its inputs, the dialog uses bare names. */
const EMPLOYEE_FOCUS_ELEMENT_IDS: Record<EmployeeInputField | "workArea", { dialog: string; panel: string }> = {
    name: { dialog: "name", panel: "employee-panel-name" },
    phone: { dialog: "phone", panel: "employee-panel-phone" },
    birthday: { dialog: "birthday", panel: "employee-panel-birthday" },
    workArea: { dialog: "employee-form-work-area", panel: "employee-panel-work-area" },
};

interface EmployeeFormErrorState {
    message: string;
    fieldErrors: readonly ProblemError[];
    requestId?: string;
    outcome?: ProblemOutcome;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const getErrorResponseStatus = (error: unknown): number | undefined => {
    if (!isRecord(error)) return undefined;

    const response = isRecord(error.response) ? error.response : undefined;
    const responseStatus = response?.status;
    if (typeof responseStatus === "number" && Number.isInteger(responseStatus)) {
        return responseStatus;
    }

    const directStatus = error.status;
    if (typeof directStatus === "number" && Number.isInteger(directStatus)) {
        return directStatus;
    }

    const responseData = response?.data;
    const data = isRecord(responseData)
        ? responseData
        : isRecord(error.data)
            ? error.data
            : error;
    const statusCode = data.statusCode;
    return typeof statusCode === "number" && Number.isInteger(statusCode) ? statusCode : undefined;
};

const getErrorResponsePayload = (error: unknown): unknown => {
    if (!isRecord(error)) return undefined;
    const response = isRecord(error.response) ? error.response : undefined;
    if (response && "data" in response) return response.data;
    if ("data" in error) return error.data;
    return error;
};

const isUnstructuredLegacyEmployeeError = (
    error: unknown,
    normalized: ReturnType<typeof normalizeApiError>,
): boolean => {
    if (normalized.verified) return false;
    const status = getErrorResponseStatus(error);
    if (status === undefined || status < 400 || status >= 500) return false;

    const payload = getErrorResponsePayload(error);
    return !isRecord(payload) || (!("type" in payload) && !("requestId" in payload));
};

const fieldForProblemError = (problemError: ProblemError): EmployeeFormField | undefined => {
    if (problemError.location !== undefined && problemError.location !== "body") return undefined;
    if (problemError.pointer === "/name") return "name";
    if (problemError.pointer === "/phone") return "phone";
    return undefined;
};

const combineAriaDescribedBy = (...ids: Array<string | undefined>): string | undefined => {
    const value = ids.filter((id): id is string => Boolean(id)).join(" ");
    return value || undefined;
};

interface WorkAreaMultiSelectProps {
    id: string;
    value: string[];
    onChange: (value: string[]) => void;
    onTouched: () => void;
    invalid: boolean;
    errorId?: string;
    dataComponentPrefix: string;
}

function summarizeWorkAreas(value: string[]): string {
    const labels = value.map(formatWorkAreaLabel);

    if (labels.length === 0) return "근무 지역 선택";
    if (labels.length <= 2) return labels.join(", ");
    return `${labels[0]} 외 ${labels.length - 1}곳`;
}

function WorkAreaMultiSelect({
    id,
    value,
    onChange,
    onTouched,
    invalid,
    errorId,
    dataComponentPrefix,
}: WorkAreaMultiSelectProps) {
    const [open, setOpen] = useState(false);
    const selectedSummary = summarizeWorkAreas(value);
    const configuredWorkAreas = new Set<string>(WORK_AREAS);
    const selectableOptions = [
        ...WORK_AREA_OPTIONS,
        ...value
            .filter((area) => !configuredWorkAreas.has(area))
            .map((area) => ({ value: area, label: formatWorkAreaLabel(area) })),
    ];

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            onTouched();
        }
    };

    const setAreaChecked = (area: string, checked: boolean) => {
        const selectedAreas = new Set(value);

        if (checked) {
            selectedAreas.add(area);
        } else {
            selectedAreas.delete(area);
        }

        onChange(
            selectableOptions
                .map((option) => option.value)
                .filter((option) => selectedAreas.has(option)),
        );
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <div data-component={`${dataComponentPrefix}-select-wrap`}>
                <PopoverTrigger asChild>
                    <button
                        id={id}
                        type="button"
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={`${id}-options`}
                        aria-label={`근무 지역 선택: ${selectedSummary}`}
                        aria-invalid={invalid || undefined}
                        aria-describedby={errorId}
                        data-component={`${dataComponentPrefix}-select`}
                        className={cn(
                            APP_FORM_CONTROL_CLASS_NAME,
                            "box-border items-center justify-between gap-2 py-0 text-left",
                            value.length === 0 && "text-text-muted",
                            invalid && "border-burgundy focus-visible:border-burgundy",
                        )}
                    >
                        <span className="min-w-0 flex-1 truncate">{selectedSummary}</span>
                        <ChevronDown
                            className={cn(
                                "h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(16px*var(--glint-ui-scale,1))] shrink-0 text-text-muted transition-transform",
                                open && "rotate-180",
                            )}
                            strokeWidth={2.2}
                            data-component={`${dataComponentPrefix}-select-icon`}
                            aria-hidden="true"
                        />
                    </button>
                </PopoverTrigger>
            </div>

            <PopoverContent
                align="start"
                sideOffset={6}
                avoidCollisions
                data-component={`${dataComponentPrefix}-select-popover`}
                className="w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-[13px] border-[1.35px] border-border bg-white p-0 shadow-lg"
            >
                <div
                    data-component={`${dataComponentPrefix}-select-head`}
                    className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5"
                >
                    <span className="text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold text-text-muted">
                        {value.length}개 지역 선택
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => onChange(selectableOptions.map((option) => option.value))}
                            className="text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold text-primary hover:text-primary/80"
                            data-component={`${dataComponentPrefix}-select-all`}
                        >
                            전체 선택
                        </button>
                        <button
                            type="button"
                            onClick={() => onChange([])}
                            disabled={value.length === 0}
                            className="text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold text-text-muted hover:text-dark disabled:cursor-not-allowed disabled:opacity-45"
                            data-component={`${dataComponentPrefix}-clear`}
                        >
                            선택 해제
                        </button>
                    </div>
                </div>

                <div
                    id={`${id}-options`}
                    role="group"
                    aria-label="근무 지역 목록"
                    data-component={`${dataComponentPrefix}-options`}
                    className="grid max-h-[280px] gap-0.5 overflow-y-auto p-2"
                >
                    {selectableOptions.map((option, index) => {
                        const checkboxId = `${id}-option-${index}`;
                        const isSelected = value.includes(option.value);

                        return (
                            <label
                                key={option.value}
                                htmlFor={checkboxId}
                                className="flex min-h-[36px] cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[calc(12px*var(--glint-ui-scale,1))] font-medium text-dark hover:bg-primary/5"
                            >
                                <Checkbox
                                    id={checkboxId}
                                    checked={isSelected}
                                    onCheckedChange={(checked) => setAreaChecked(option.value, checked === true)}
                                    className="h-4 w-4 rounded-[4px] border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                                    data-component={`${dataComponentPrefix}-option-${index}`}
                                />
                                <span>{option.label}</span>
                            </label>
                        );
                    })}
                </div>

                <div className="border-t border-border p-2.5">
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => handleOpenChange(false)}
                        className="w-full"
                        data-component={`${dataComponentPrefix}-done`}
                    >
                        완료
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

/** Static guidance for the open-status field; it sits in the label-row slot. */
const OPEN_STATUS_GUIDANCE = "배정 후보에 표시돼요";

const getPhoneDuplicateCheckFailedMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "문제가 발생했어요. 새로고침 해주세요."
        : "Something went wrong. Please refresh and try again.";

const getPhoneAvailableMessage = (locale: "ko" | "en"): string =>
    locale === "ko" ? "등록 가능한 번호입니다." : "This phone number is available.";

export function EmployeeFormPanel({
    open = true,
    onClose,
    onBeforeClose,
    employee,
    onSuccess,
    renderLayout,
    onDirtyChange,
}: EmployeeFormPanelProps) {
    return (
        <EmployeeFormContent
            surface="panel"
            open={open}
            onClose={onClose}
            onBeforeClose={onBeforeClose}
            employee={employee}
            onSuccess={onSuccess}
            renderLayout={renderLayout}
            onDirtyChange={onDirtyChange}
        />
    );
}

export function EmployeeFormDialog({ open, onClose, onBeforeClose, employee, onSuccess }: EmployeeFormDialogProps) {
    return (
        <EmployeeFormContent
            surface="dialog"
            open={open}
            onClose={onClose}
            onBeforeClose={onBeforeClose}
            employee={employee}
            onSuccess={onSuccess}
        />
    );
}

function EmployeeFormContent({
    surface,
    open,
    onClose,
    onBeforeClose,
    employee,
    onSuccess,
    renderLayout,
    onDirtyChange,
}: EmployeeFormDialogProps & Pick<EmployeeFormPanelProps, "renderLayout" | "onDirtyChange"> & { surface: "dialog" | "panel" }) {
    const locale = useLocale();
    const queryClient = useQueryClient();
    const [formData, setFormData] = useState<FormData>(initialFormData);
    const [touched, setTouched] = useState({ workArea: false });
    const fields = useFieldInputStates<EmployeeInputField>();
    const resetFieldStates = fields.reset;
    const [error, setError] = useState<EmployeeFormErrorState | null>(null);
    // Fields whose server error the user already edited away; set again by each new error.
    const [editedServerErrorFields, setEditedServerErrorFields] = useState<EmployeeFormField[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const formDataBaselineRef = useRef<FormData>(initialFormData);

    const createMutation = useCreateEmployee();
    const updateMutation = useUpdateEmployee();
    const prefillName = useEmployeeDialogStore((state) => state.prefillName);

    const {
        phoneDigits,
        isCheckingPhoneDuplicate,
        isPhoneDuplicate,
        hasPhoneDuplicateCheckFailed,
        lastCheckedPhoneDigits,
        isUsingOriginalPhone,
        isPhoneCheckReady,
    } = useEmployeePhoneDuplicateCheck({
        phone: formData.phone,
        originalPhone: employee?.phone,
        enabled: open,
    });

    // 중복 검사는 서버를 직접 조회하지만 제공인력 목록은 창별 캐시를 쓴다.
    // 그래서 "이미 등록됨"인데 목록에는 안 보이는 상태가 생긴다. 이때 목록을 맞춰준다.
    useEffect(() => {
        if (!isPhoneDuplicate) return;
        void queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
    }, [isPhoneDuplicate, queryClient]);

    const isEditMode = !!employee;
    const isLoading = isSubmitting || createMutation.isPending || updateMutation.isPending;
    const isPhoneFormatValid = phoneDigits.length === 11;
    const isPhoneValid = isPhoneFormatValid && isPhoneCheckReady;
    const phoneInlineMessage = isPhoneFormatValid
        ? isUsingOriginalPhone || isPhoneCheckReady
            ? getPhoneAvailableMessage(locale)
            : isCheckingPhoneDuplicate
                ? t(locale, "form.validation.phone-checking")
                : hasPhoneDuplicateCheckFailed
                    ? getPhoneDuplicateCheckFailedMessage(locale)
                    : lastCheckedPhoneDigits !== phoneDigits
                        ? t(locale, "form.validation.phone-checking")
                        : isPhoneDuplicate
                            ? t(locale, "employees.form.error-phone-duplicate")
                            : null
        : null;
    const hasPhoneStatusError =
        isPhoneFormatValid &&
        !isUsingOriginalPhone &&
        (hasPhoneDuplicateCheckFailed ||
            (lastCheckedPhoneDigits === phoneDigits && isPhoneDuplicate));
    const isWorkAreaValid = formData.workArea.length > 0;
    // A field problem never disables submit: pressing it reveals the message on
    // every problem field. Only work in flight or an unfinished phone check does.
    const isSubmitBlocked = isPhoneFormatValid && !isPhoneCheckReady;
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
                birthday: normalizeBirthdayIsoDate(employee.birthday) ?? employee.birthday ?? "",
            }
            : {
                ...initialFormData,
                name: prefillName || "",
            };

        formDataBaselineRef.current = nextFormData;

        queueMicrotask(() => {
            if (cancelled) {
                return;
            }

            setFormData(nextFormData);
            setTouched({ workArea: false });
            resetFieldStates();
            setError(null);
        });

        return () => {
            cancelled = true;
        };
    }, [employee, open, prefillName, resetFieldStates]);

    useEffect(() => {
        if (surface !== "panel" || !open || !onDirtyChange) return;

        onDirtyChange(!areFormDataEqual(formData, formDataBaselineRef.current));
    }, [formData, onDirtyChange, open, surface]);

    const handleChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (isEmployeeFormField(field)) {
            setEditedServerErrorFields((current) => (current.includes(field) ? current : [...current, field]));
        }
    };

    const handleInputChange = (field: EmployeeInputField, value: string) => {
        fields.onChange(field, formData[field], value);
        handleChange(field, value);
    };

    /**
     * The one message a text input shows in its label-row slot. `settled`
     * evaluates only the input's own rules as if the user already left the
     * field and pressed submit; duplicate-check status is not one of them.
     */
    const resolveInputMessage = (field: EmployeeInputField, settled = false): FieldMessageView | null => {
        // Whitespace alone does not count as a value for the name.
        const baseState = fields.stateOf(field, field === "name" ? formData.name.trim() : formData[field]);
        const state = settled ? { ...baseState, focused: false } : baseState;
        const opts = { required: field !== "birthday", submitted: settled || fields.submitted };

        if (field === "name") {
            return toFieldMessageView(locale, resolveFieldMessage("text", state, opts), t(locale, "employees.form.name"));
        }
        if (field === "phone") {
            const formatMessage = toFieldMessageView(
                locale,
                resolveElevenDigitPhoneMessage(state, opts),
                t(locale, "employees.form.phone"),
            );
            if (formatMessage) return formatMessage;
            if (settled || !phoneInlineMessage) return null;
            return {
                tone: hasPhoneStatusError ? "error" : isPhoneCheckReady ? "ok" : "hint",
                text: phoneInlineMessage,
            };
        }
        const dateMessage = toFieldMessageView(locale, resolveFieldMessage("date", state, opts), t(locale, "clients.form.birthday"));
        if (dateMessage) return dateMessage;
        return formData.birthday.length === 10 && !isValidBirthdayIsoDate(formData.birthday)
            ? { tone: "error", text: t(locale, "form.validation.birthday-future") }
            : null;
    };

    // Server errors that map to a field show in that field's label-row slot
    // until the user edits the field; only unmapped ones go to the summary.
    const formErrorEntries = (error?.fieldErrors ?? []).map((fieldError, index) => ({
        fieldError,
        field: fieldForProblemError(fieldError),
        id: `${EMPLOYEE_FORM_DIALOG_ERROR_ID_PREFIX}_${index}`,
    }));
    const serverFieldMessages: Partial<Record<EmployeeFormField, FieldMessageView>> = {};
    for (const { fieldError, field } of formErrorEntries) {
        if (field && !editedServerErrorFields.includes(field) && !serverFieldMessages[field]) {
            serverFieldMessages[field] = { tone: "error", text: fieldError.detail };
        }
    }
    const summaryErrorEntries = formErrorEntries.filter(({ field }) => field === undefined);

    const inputMessages = Object.fromEntries(
        EMPLOYEE_INPUT_FIELDS.map((field) => [
            field,
            (isEmployeeFormField(field) ? serverFieldMessages[field] : undefined) ?? resolveInputMessage(field),
        ]),
    ) as Record<EmployeeInputField, FieldMessageView | null>;

    const inputMessageId = (field: EmployeeInputField) => `employees-form-${surface}-${field}-helper`;

    /** The label-row slot content for a field, or null while it has nothing to say. */
    const renderInputMessage = (field: EmployeeInputField, dataComponent: string) => {
        const message = inputMessages[field];
        return message ? (
            <FieldMessageText id={inputMessageId(field)} data-component={dataComponent} tone={message.tone}>
                {message.text}
            </FieldMessageText>
        ) : null;
    };

    /** Error state, a11y wiring and focus tracking shared by every inline-validated input. */
    const getInputProps = (field: EmployeeInputField) => {
        const message = inputMessages[field];
        return {
            error: message?.tone === "error",
            "aria-describedby": combineAriaDescribedBy(message ? inputMessageId(field) : undefined),
            ...fields.focusProps(field, formData[field]),
        };
    };

    const setMutationError = (cause: unknown) => {
        const normalized = normalizeApiError(cause, {
            locale: locale === "en" ? "en-US" : "ko-KR",
            operation: "mutation",
        });

        if (isUnstructuredLegacyEmployeeError(cause, normalized)) {
            setError({
                message: getErrorMessage(cause, locale, "employees.form.error-save-failed"),
                fieldErrors: [],
            });
            return;
        }

        setEditedServerErrorFields([]);
        setError({
            message: normalized.message,
            fieldErrors: normalized.problem?.errors ?? [],
            requestId: normalized.problem?.requestId,
            outcome: normalized.outcome,
        });
    };

    const handleSubmit = async () => {
        fields.setSubmitted(true);
        setTouched({ workArea: true });
        setError(null);

        const firstProblemField = EMPLOYEE_INPUT_FIELDS.find(
            (field) => resolveInputMessage(field, true)?.tone === "error",
        ) ?? (isWorkAreaValid ? undefined : "workArea");
        if (firstProblemField) {
            focusFormField(firstProblemField);
            return;
        }
        if (!isPhoneValid) return;

        setIsSubmitting(true);
        try {
            if (isEditMode && employee) {
                const dto: UpdateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: normalizeKoreanPhoneDigits(formData.phone),
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                    birthday: formData.birthday,
                };

                const updatedEmployee = await updateMutation.mutateAsync({ id: employee.id, dto });

                if (updatedEmployee && ("code" in updatedEmployee || "statusCode" in updatedEmployee)) {
                    setMutationError(updatedEmployee);
                    return;
                }

                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                onSuccess?.(updatedEmployee);
            } else {
                const dto: CreateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: normalizeKoreanPhoneDigits(formData.phone),
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                    birthday: formData.birthday,
                };

                const newEmployee = await createMutation.mutateAsync(dto);

                if (newEmployee && ("code" in newEmployee || "statusCode" in newEmployee)) {
                    setMutationError(newEmployee);
                    return;
                }

                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                onSuccess?.(newEmployee);
            }

            onClose();
        } catch (submitError: unknown) {
            console.error("[EmployeeFormDialog] Failed to save employee:", submitError);
            setMutationError(submitError);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        if (onBeforeClose && !onBeforeClose()) {
            return;
        }

        formDataBaselineRef.current = initialFormData;
        setFormData(initialFormData);
        setTouched({ workArea: false });
        resetFieldStates();
        setError(null);
        onDirtyChange?.(false);
        onClose();
    };

    const dialogFooter = (
        <div className="ml-auto flex w-full flex-col-reverse gap-2 sm:w-[300px] sm:flex-row sm:justify-end">
            <Button
                variant="neutral"
                size="sm"
                onClick={handleClose}
                disabled={isLoading}
                data-component="desktop_employees_form-dialog_cancel"
                className="w-full sm:flex-1"
            >
                {t(locale, "common.cancel")}
            </Button>
            <Button
                variant="positive"
                size="sm"
                onClick={handleSubmit}
                disabled={isLoading || isSubmitBlocked}
                data-component="desktop_employees_form-dialog_submit"
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
        <div className="flex w-full flex-wrap items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))]">
            <span className={DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME}>{requiredFieldProgressText}</span>
            <div className={DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME}>
                <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={handleClose}
                    disabled={isLoading}
                    data-component="desktop_employees_form-panel_cancel"
                    className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                >
                    {t(locale, "common.cancel")}
                </Button>
                <Button
                    type="button"
                    variant="positive"
                    size="sm"
                    onClick={handleSubmit}
                    disabled={isLoading || isSubmitBlocked}
                    data-component="desktop_employees_form-panel_submit"
                    className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
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

    const problemPresentation = resolveProblemPresentation(locale);

    const focusFormField = (field: EmployeeInputField | "workArea") => {
        document.getElementById(EMPLOYEE_FOCUS_ELEMENT_IDS[field][surface])?.focus();
    };

    const feedback = error ? (
        <Alert
            variant="destructive"
            data-component="desktop_employees_form-dialog_error"
            className="rounded-[18px] border-none bg-burgundy-light px-4 py-3 text-burgundy [&>svg]:text-burgundy"
        >
            <AlertDescription>
                <div className="flex flex-col gap-2">
                    <p>{error.message}</p>
                    {summaryErrorEntries.length > 0 ? (
                        <ul className="flex flex-col gap-1">
                            {summaryErrorEntries.map(({ fieldError, id }) => (
                                <li key={id} id={id}>
                                    <span>{`${problemPresentation.unmappedField}: ${fieldError.detail}`}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    {error.outcome === "UNKNOWN" ? (
                        <p>{problemPresentation.checkStatus}</p>
                    ) : null}
                    {error.requestId ? (
                        <FormHelperText data-component={`${EMPLOYEE_FORM_DIALOG_ERROR_ID_PREFIX}_request-id`}>
                            {locale === "en" ? `Request ID: ${error.requestId}` : `요청 ID: ${error.requestId}`}
                        </FormHelperText>
                    ) : null}
                </div>
            </AlertDescription>
        </Alert>
    ) : null;

    const formSections = (
        <>
            <FormSection
                data-component="desktop_employees_form-dialog_section-basic"
                title={t(locale, "employees.form.section-basic")}
                description="제공인력의 기본 정보를 입력해 주세요."
                headerDataComponent="desktop_employees_form-dialog_section-basic-head"
                titleDataComponent="desktop_employees_form-dialog_section-basic-title"
                descriptionDataComponent="desktop_employees_form-dialog_section-basic-caption"
            >
                <FormGrid data-component="desktop_employees_form-dialog_section-basic_grid">
                    <FormField
                        data-component="desktop_employees_form-dialog_section-basic_grid_field-name"
                        htmlFor="name"
                        label={t(locale, "employees.form.name")}
                        required
                        labelAccessory={renderInputMessage("name", "desktop_employees_form-dialog_section-basic_grid_field-name_helper")}
                    >
                        <FormTextInput
                            id="name"
                            value={formData.name}
                            onChange={(e) => handleInputChange("name", e.target.value)}
                            placeholder="홍길동"
                            {...getInputProps("name")}
                        />
                    </FormField>

                    <FormField
                        data-component="desktop_employees_form-dialog_section-basic_grid_field-phone"
                        htmlFor="phone"
                        label={t(locale, "employees.form.phone")}
                        required
                        labelAccessory={renderInputMessage("phone", "desktop_employees_form-dialog_section-basic_grid_field-phone_helper")}
                    >
                        <FormTextInput
                            id="phone"
                            type="tel"
                            inputMode="numeric"
                            placeholder="010-1234-5678"
                            value={formatKoreanPhoneNumber(formData.phone)}
                            onChange={(e) => handleInputChange("phone", normalizeKoreanPhoneDigits(e.target.value))}
                            maxLength={20}
                            {...getInputProps("phone")}
                        />
                    </FormField>

                    <FormField
                        data-component="desktop_employees_form-dialog_section-basic_grid_field-birthday"
                        htmlFor="birthday"
                        label={t(locale, "clients.form.birthday")}
                        labelAccessory={renderInputMessage("birthday", "desktop_employees_form-dialog_section-basic_grid_field-birthday_helper")}
                    >
                        <FormTextInput
                            id="birthday"
                            value={formData.birthday}
                            onChange={(e) => handleInputChange("birthday", formatBirthdayInput(e.target.value))}
                            placeholder="1958-03-03"
                            maxLength={10}
                            inputMode="numeric"
                            {...getInputProps("birthday")}
                        />
                    </FormField>
                </FormGrid>
            </FormSection>

            <FormSection
                data-component="desktop_employees_form-dialog_section-work"
                title={t(locale, "employees.form.section-work")}
                description="필요한 범위만 선택하고 나중에 수정할 수 있습니다."
                headerDataComponent="desktop_employees_form-dialog_section-work-head"
                titleDataComponent="desktop_employees_form-dialog_section-work-title"
                descriptionDataComponent="desktop_employees_form-dialog_section-work-caption"
            >
                <FormGrid data-component="desktop_employees_form-dialog_section-work_grid">
                    <FormField
                        data-component="desktop_employees_form-dialog_section-work_grid_field-grade"
                        htmlFor="employee-form-grade"
                        label={t(locale, "employees.form.grade")}
                        required
                    >
                        <FormNativeSelect
                            id="employee-form-grade"
                            value={formData.grade}
                            options={GRADE_OPTIONS}
                            onValueChange={(value) => handleChange("grade", value)}
                            wrapDataComponent="desktop_employees_form-dialog_section-work_grid_field-grade_select-wrap"
                            selectDataComponent="desktop_employees_form-dialog_section-work_grid_field-grade_select"
                            iconDataComponent="desktop_employees_form-dialog_section-work_grid_field-grade_select-icon"
                        />
                    </FormField>

                    <FormField
                        data-component="desktop_employees_form-dialog_section-work_grid_field-work-area"
                        htmlFor="employee-form-work-area"
                        label={t(locale, "employees.form.work-area")}
                        required
                        labelAccessory={touched.workArea && !isWorkAreaValid ? (
                            <FieldMessageText
                                id="employee-form-work-area-error"
                                tone="error"
                                data-component="desktop_employees_form-dialog_section-work_grid_field-work-area_error"
                            >
                                {t(locale, "employees.form.work-area-required")}
                            </FieldMessageText>
                        ) : null}
                    >
                        <WorkAreaMultiSelect
                            id="employee-form-work-area"
                            value={formData.workArea}
                            onChange={(value) => handleChange("workArea", value)}
                            onTouched={() => setTouched({ workArea: true })}
                            invalid={touched.workArea && !isWorkAreaValid}
                            errorId={touched.workArea && !isWorkAreaValid ? "employee-form-work-area-error" : undefined}
                            dataComponentPrefix="employees-form-dialog-field-work-area"
                        />
                    </FormField>
                </FormGrid>

                <FormField
                    data-component="desktop_employees_form-dialog_section-work_field-open-status"
                    label="다음 배정 가능 여부"
                    labelAccessory={
                        <FieldMessageText
                            id="employee-form-open-status-guidance"
                            tone="hint"
                            data-component="desktop_employees_form-dialog_section-work_field-open-status_helper"
                        >
                            {OPEN_STATUS_GUIDANCE}
                        </FieldMessageText>
                    }
                >
                    <FormSwitchRow
                        data-component="desktop_employees_form-dialog_section-work_field-open-status_control"
                        title="다음 근무 배정 가능"
                        checked={formData.openToNextWork}
                        onToggle={() => handleChange("openToNextWork", !formData.openToNextWork)}
                        buttonAriaLabel="다음 근무 배정 가능"
                        buttonDescribedBy="employee-form-open-status-guidance"
                        copyDataComponent="desktop_employees_form-dialog_field-open-status-copy"
                        titleDataComponent="desktop_employees_form-dialog_field-open-status-title"
                        buttonDataComponent="desktop_employees_form-dialog_field-open-status-switch"
                        thumbDataComponent="desktop_employees_form-dialog_field-open-status-switch-thumb"
                    />
                </FormField>

            </FormSection>
        </>
    );

    const dialogContent = (
        <div data-component="desktop_employees_form-dialog_content" className="space-y-5">
            {feedback}
            {formSections}
        </div>
    );

    const panelFields = (
        <>
            <FormField
                data-component="desktop_employees_form-panel_name-field"
                htmlFor="employee-panel-name"
                label={
                    <>
                        {t(locale, "employees.form.name")}
                        <span className="ml-1 text-burgundy">*</span>
                    </>
                }
                labelAccessory={renderInputMessage("name", "desktop_employees_form-panel_name-field_helper")}
            >
                <FormTextInput
                    id="employee-panel-name"
                    value={formData.name}
                    onChange={(event) => handleInputChange("name", event.target.value)}
                    placeholder="홍길동"
                    data-component="desktop_employees_form-panel_name-field_input"
                    {...getInputProps("name")}
                />
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_phone-field"
                htmlFor="employee-panel-phone"
                label={
                    <>
                        {t(locale, "employees.form.phone")}
                        <span className="ml-1 text-burgundy">*</span>
                    </>
                }
                labelAccessory={renderInputMessage("phone", "desktop_employees_form-panel_phone-field_helper")}
            >
                <FormTextInput
                    id="employee-panel-phone"
                    type="tel"
                    inputMode="numeric"
                    value={formatKoreanPhoneNumber(formData.phone)}
                    onChange={(event) => handleInputChange("phone", normalizeKoreanPhoneDigits(event.target.value))}
                    maxLength={20}
                    placeholder="010-1234-5678"
                    data-component="desktop_employees_form-panel_phone-field_input"
                    {...getInputProps("phone")}
                />
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_birthday-field"
                htmlFor="employee-panel-birthday"
                label={t(locale, "clients.form.birthday")}
                labelAccessory={renderInputMessage("birthday", "desktop_employees_form-panel_birthday-field_helper")}
            >
                <FormTextInput
                    id="employee-panel-birthday"
                    value={formData.birthday}
                    onChange={(event) => handleInputChange("birthday", formatBirthdayInput(event.target.value))}
                    placeholder="1958-03-03"
                    inputMode="numeric"
                    maxLength={10}
                    data-component="desktop_employees_form-panel_birthday-field_input"
                    {...getInputProps("birthday")}
                />
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_grade-field"
                htmlFor="employee-panel-grade"
                label={
                    <>
                    {t(locale, "employees.form.grade")}
                    <span className="ml-1 text-burgundy">*</span>
                    </>
                }
            >
                <FormNativeSelect
                    id="employee-panel-grade"
                    value={formData.grade}
                    options={GRADE_OPTIONS}
                    onValueChange={(value) => handleChange("grade", value)}
                    wrapDataComponent="desktop_employees_form-panel_grade-field_select-wrap"
                    selectDataComponent="desktop_employees_form-panel_grade-field_select"
                    iconDataComponent="desktop_employees_form-panel_grade-field_select-icon"
                />
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_work-area-field"
                htmlFor="employee-panel-work-area"
                label={
                    <>
                    {t(locale, "employees.form.work-area")}
                    <span className="ml-1 text-burgundy">*</span>
                    </>
                }
                labelAccessory={touched.workArea && !isWorkAreaValid ? (
                    <FieldMessageText
                        id="employee-panel-work-area-error"
                        tone="error"
                        data-component="desktop_employees_form-panel_work-area-field_error"
                    >
                        {t(locale, "employees.form.work-area-required")}
                    </FieldMessageText>
                ) : null}
            >
                <WorkAreaMultiSelect
                    id="employee-panel-work-area"
                    value={formData.workArea}
                    onChange={(value) => handleChange("workArea", value)}
                    onTouched={() => setTouched({ workArea: true })}
                    invalid={touched.workArea && !isWorkAreaValid}
                    errorId={touched.workArea && !isWorkAreaValid ? "employee-panel-work-area-error" : undefined}
                    dataComponentPrefix="employees-form-panel-work-area"
                />
            </FormField>

            <FormField
                data-component="desktop_employees_form-panel_open-status-field"
                label={t(locale, "employees.form.open-to-next-work")}
                labelAccessory={
                    <FieldMessageText
                        id="employee-panel-open-status-guidance"
                        tone="hint"
                        data-component="desktop_employees_form-panel_open-status-field_helper"
                    >
                        {OPEN_STATUS_GUIDANCE}
                    </FieldMessageText>
                }
            >
                <FormSwitchRow
                    data-component="desktop_employees_form-panel_open-status-field_control"
                    className="h-[calc(38px*var(--glint-ui-scale,1))] min-h-[calc(38px*var(--glint-ui-scale,1))] rounded-[13px] border-[1.35px] px-[calc(14px*var(--glint-ui-scale,1))] py-0"
                    title="다음 근무 배정 가능"
                    checked={formData.openToNextWork}
                    onToggle={() => handleChange("openToNextWork", !formData.openToNextWork)}
                    buttonAriaLabel="다음 근무 배정 가능"
                    buttonDescribedBy="employee-panel-open-status-guidance"
                    buttonDataComponent="desktop_employees_form-panel_open-status-switch"
                    thumbDataComponent="desktop_employees_form-panel_open-status-switch-thumb"
                />
            </FormField>
        </>
    );

    const panelContent = (
        <SteppedWizardPanelContent
            dataComponent="desktop_employees_form-panel_content"
            stepContentDataComponent="desktop_employees_form-panel_fields"
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
            <div data-component="desktop_employees_form-panel" className="flex h-full min-h-0 flex-col">
                <div data-component="desktop_employees_form-panel_content-fallback" className="min-h-0 flex-1 overflow-y-auto">
                    {panelContent}
                </div>
                <footer data-component="desktop_employees_form-panel_footer" data-slot="detail-panel-footer" className={DETAIL_PANEL_FOOTER_CLASS_NAME}>
                    {panelFooter}
                </footer>
            </div>
        );
    }

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
            <FormDialogShell
                dataComponent="desktop_employees_form-dialog"
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
