"use client";
import {
    getUserErrorMessage,
    normalizeApiError,
    resolveProblemPresentation,
    type ProblemError,
    type ProblemOutcome,
} from "@babyjamjam/shared";


import { useState, useEffect, useMemo } from "react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/errors/api-error-mapper";
import {
    Employee,
    CreateEmployeeDto,
    UpdateEmployeeDto,
    useCreateEmployee,
    useUpdateEmployee,
    employeeQueryKeys,
} from "@/hooks/useEmployees";
import { useQueryClient } from "@tanstack/react-query";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { api } from "@/lib/api/client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { MobileDetailSlideUp } from "@/components/app/mobile-redesign/mobile-detail-slideup";
import { DEFAULT_EMPLOYEE_GRADE, normalizeEmployeeGrade } from "@/features/employees/grade";
import { EmployeeFormCard, type EmployeeFormCardData, type EmployeeFormCardTouched } from "./EmployeeFormCard";
import styles from "./EmployeeFormDialog.module.css";

interface EmployeeFormDialogProps {
    open: boolean;
    onClose: () => void;
    employee?: Employee | null;
    onSuccess?: (employee: Employee) => void;
    assignmentLabel?: string;
    assignmentDescription?: string;
}

type FormData = EmployeeFormCardData;

const PHONE_DUPLICATE_CHECK_MAX_RETRIES = 3;
const PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS = 1000;

const EMPLOYEE_FORM_DIALOG_BASE = "mobile_employees_form-dialog";
const EMPLOYEE_FORM_DIALOG_ERROR_ID_PREFIX = "mobile_employees_form-dialog_error";

type EmployeeFormField = "name" | "phone";

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

const normalizePhoneNumber = (value: string): string => value.replace(/[^\d]/g, "");

const getPhoneDuplicateCheckFailedMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "문제가 발생했어요. 새로고침 해주세요."
        : "Something went wrong. Please refresh and try again.";

const getPhoneDuplicateCheckPendingMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "연락처 중복 확인 중입니다. 잠시만 기다려주세요."
        : "Checking for duplicate phone number. Please wait.";

const initialFormData: FormData = {
    name: "",
    workArea: [],
    phone: "",
    grade: DEFAULT_EMPLOYEE_GRADE,
    openToNextWork: true,
    birthday: "",
};

export function EmployeeFormDialog({
    open,
    onClose,
    employee,
    onSuccess,
    assignmentLabel,
    assignmentDescription,
}: EmployeeFormDialogProps) {
    const locale = useLocale();
    const queryClient = useQueryClient();
    const [formData, setFormData] = useState<FormData>(initialFormData);

    // Track which fields have been touched for validation display
    const [touched, setTouched] = useState<EmployeeFormCardTouched>({
        phone: false,
        workArea: false,
    });

    // Error state for displaying API errors
    const [error, setError] = useState<EmployeeFormErrorState | null>(null);
    const [isCheckingPhoneDuplicate, setIsCheckingPhoneDuplicate] = useState(false);
    const [isPhoneDuplicate, setIsPhoneDuplicate] = useState(false);
    const [hasPhoneDuplicateCheckFailed, setHasPhoneDuplicateCheckFailed] = useState(false);
    const [lastCheckedPhoneDigits, setLastCheckedPhoneDigits] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const createMutation = useCreateEmployee();
    const updateMutation = useUpdateEmployee();

    // Read pre-filled name from Zustand store
    const prefillName = useEmployeeDialogStore((state) => state.prefillName);

    const isEditMode = !!employee;
    const isLoading = isSubmitting || createMutation.isPending || updateMutation.isPending;
    const phoneDigits = useMemo(() => normalizePhoneNumber(formData.phone), [formData.phone]);
    const employeePhoneDigits = useMemo(() => normalizePhoneNumber(employee?.phone ?? ""), [employee?.phone]);
    const isUnchangedEmployeePhone = isEditMode && phoneDigits.length === 11 && phoneDigits === employeePhoneDigits;

    // Validation helpers
    const isPhoneValid = phoneDigits.length === 11;
    const isWorkAreaValid = formData.workArea.length > 0;
    const isPhoneDuplicateCheckReady =
        isUnchangedEmployeePhone ||
        (
            phoneDigits.length === 11 &&
            lastCheckedPhoneDigits === phoneDigits &&
            !isCheckingPhoneDuplicate &&
            !hasPhoneDuplicateCheckFailed
        );
    const shouldShowPhoneDuplicateStatus = !isUnchangedEmployeePhone && phoneDigits.length === 11;
    const hasPhoneError = shouldShowPhoneDuplicateStatus && (hasPhoneDuplicateCheckFailed || isPhoneDuplicate);
    const isFormValid =
        Boolean(formData.name.trim()) &&
        isPhoneValid &&
        isWorkAreaValid &&
        isPhoneDuplicateCheckReady &&
        !hasPhoneError;
    const phoneHelperTone = !shouldShowPhoneDuplicateStatus
        ? null
        : hasPhoneDuplicateCheckFailed || isPhoneDuplicate
        ? "err"
        : isCheckingPhoneDuplicate
            ? "pending"
            : phoneDigits.length === 11 && lastCheckedPhoneDigits === phoneDigits
                ? "ok"
                : null;
    const phoneHelperMessage = !shouldShowPhoneDuplicateStatus
        ? null
        : isCheckingPhoneDuplicate
        ? getPhoneDuplicateCheckPendingMessage(locale)
        : hasPhoneDuplicateCheckFailed
            ? getPhoneDuplicateCheckFailedMessage(locale)
            : isPhoneDuplicate
                ? t(locale, "employees.form.error-phone-duplicate")
                : phoneDigits.length === 11 && lastCheckedPhoneDigits === phoneDigits
                    ? "등록 가능한 번호입니다."
                    : null;

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
            setIsCheckingPhoneDuplicate(false);
            setIsPhoneDuplicate(false);
            setHasPhoneDuplicateCheckFailed(false);
            setLastCheckedPhoneDigits(null);
        });

        return () => {
            cancelled = true;
        };
    }, [employee, open, prefillName]);

    useEffect(() => {
        if (!open || phoneDigits.length !== 11 || isUnchangedEmployeePhone) {
            return;
        }

        const abortController = new AbortController();

        const waitForRetryDelay = () =>
            new Promise<void>((resolve) => {
                const finish = () => {
                    abortController.signal.removeEventListener("abort", handleAbort);
                    resolve();
                };

                const timeoutId = setTimeout(finish, PHONE_DUPLICATE_CHECK_RETRY_DELAY_MS);

                const handleAbort = () => {
                    clearTimeout(timeoutId);
                    finish();
                };

                if (abortController.signal.aborted) {
                    handleAbort();
                    return;
                }

                abortController.signal.addEventListener("abort", handleAbort, { once: true });
            });

        const checkPhoneDuplicate = async () => {
            setIsCheckingPhoneDuplicate(true);
            setIsPhoneDuplicate(false);
            setHasPhoneDuplicateCheckFailed(false);
            setLastCheckedPhoneDigits(null);

            let attempt = 0;

            while (!abortController.signal.aborted && attempt <= PHONE_DUPLICATE_CHECK_MAX_RETRIES) {
                try {
                    const response = await api.get("/employees/check-phone", {
                        params: { phone: phoneDigits },
                        signal: abortController.signal,
                    });

                    if (!abortController.signal.aborted) {
                        setIsPhoneDuplicate(response.data?.exists === true);
                        setHasPhoneDuplicateCheckFailed(false);
                        setLastCheckedPhoneDigits(phoneDigits);
                    }
                    return;
                } catch {
                    if (abortController.signal.aborted) {
                        return;
                    }

                    attempt += 1;
                    if (attempt > PHONE_DUPLICATE_CHECK_MAX_RETRIES) {
                        setIsPhoneDuplicate(false);
                        setHasPhoneDuplicateCheckFailed(true);
                        return;
                    }

                    await waitForRetryDelay();
                }
            }
        };

        void checkPhoneDuplicate().finally(() => {
            if (!abortController.signal.aborted) {
                setIsCheckingPhoneDuplicate(false);
            }
        });

        return () => {
            abortController.abort();
            setIsCheckingPhoneDuplicate(false);
        };
    }, [isUnchangedEmployeePhone, open, phoneDigits]);

    const handleChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setError(null);
        if (field === "phone") {
            setIsCheckingPhoneDuplicate(false);
            setIsPhoneDuplicate(false);
            setHasPhoneDuplicateCheckFailed(false);
            setLastCheckedPhoneDigits(null);
        }
    };

    const handleClose = () => {
        setFormData(initialFormData);
        setError(null);
        setIsCheckingPhoneDuplicate(false);
        setIsPhoneDuplicate(false);
        setHasPhoneDuplicateCheckFailed(false);
        setLastCheckedPhoneDigits(null);
        onClose();
    };

    const handleSubmit = async () => {
        // Mark all fields as touched to show any validation errors
        setTouched({ phone: true, workArea: true });
        setError(null); // Clear any previous error

        // Validate all required fields
        if (!formData.name.trim() || !isPhoneValid || !isWorkAreaValid) {
            return;
        }
        if (hasPhoneDuplicateCheckFailed) {
            setError({ message: getUserErrorMessage(getPhoneDuplicateCheckFailedMessage(locale)), fieldErrors: [] });
            return;
        }
        if (isPhoneDuplicate) {
            setError({ message: getUserErrorMessage(t(locale, "employees.form.error-phone-duplicate")), fieldErrors: [] });
            return;
        }
        if (!isPhoneDuplicateCheckReady) {
            setError({ message: getUserErrorMessage(getPhoneDuplicateCheckPendingMessage(locale)), fieldErrors: [] });
            return;
        }

        setIsSubmitting(true);
        try {
            if (isEditMode && employee) {
                const dto: UpdateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: phoneDigits,
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                    birthday: formData.birthday,
                };
                const updatedEmployee = await updateMutation.mutateAsync({ id: employee.id, dto });

                // Check if the response is an error (has statusCode or code property)
                if (updatedEmployee && ('code' in updatedEmployee || 'statusCode' in updatedEmployee)) {
                    console.error("[EmployeeFormDialog] Update returned error:", updatedEmployee);
                    setMutationError(updatedEmployee);
                    return;
                }

                // Wait for the employees query to refetch so the Autocomplete can find the employee
                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                onSuccess?.(updatedEmployee);
            } else {
                const dto: CreateEmployeeDto = {
                    name: formData.name,
                    workArea: formData.workArea,
                    phone: phoneDigits,
                    grade: formData.grade,
                    openToNextWork: formData.openToNextWork,
                    birthday: formData.birthday,
                };
                const newEmployee = await createMutation.mutateAsync(dto);

                // Check if the response is an error (has statusCode or code property)
                if (newEmployee && ('code' in newEmployee || 'statusCode' in newEmployee)) {
                    console.error("[EmployeeFormDialog] Create returned error:", newEmployee);
                    setMutationError(newEmployee);
                    return;
                }

                // Wait for the employees query to refetch so the Autocomplete can find the new employee
                await queryClient.refetchQueries({ queryKey: employeeQueryKeys.all });
                onSuccess?.(newEmployee);
            }
            handleClose();
        } catch (error: unknown) {
            console.error("[EmployeeFormDialog] Failed to save employee:", error);
            setMutationError(error);
        } finally {
            setIsSubmitting(false);
        }
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

        setError({
            message: normalized.message,
            fieldErrors: normalized.problem?.errors ?? [],
            requestId: normalized.problem?.requestId,
            outcome: normalized.outcome,
        });
    };

    const dialogTitle = isEditMode
        ? t(locale, "employees.form.edit-title")
        : t(locale, "employees.form.create-title");
    const submitLabel = isEditMode ? t(locale, "common.save") : "등록";

    const problemPresentation = resolveProblemPresentation(locale);
    const formErrorEntries = (error?.fieldErrors ?? []).map((fieldError, index) => ({
        fieldError,
        field: fieldForProblemError(fieldError),
        id: `${EMPLOYEE_FORM_DIALOG_ERROR_ID_PREFIX}_${index}`,
    }));

    const focusFormField = (field: EmployeeFormField) => {
        document.getElementById(`employee-form-${field}`)?.focus();
    };

    return (
        <MobileDetailSlideUp
            name="employees-form-dialog"
            open={open}
            onClose={handleClose}
            title={dialogTitle}
            closeLabel="새 제공인력 등록 닫기"
            closeDisabled={isLoading}
            secondaryAction={{
                label: t(locale, "common.cancel"),
                onClick: handleClose,
                disabled: isLoading,
                dataComponent: "employees-form-dialog-cancel",
            }}
            primaryAction={{
                label: submitLabel,
                onClick: handleSubmit,
                disabled: isLoading || !isFormValid,
                busy: isLoading,
                dataComponent: "employees-form-dialog-submit",
            }}
        >
            {error && (
                <Alert
                    variant="destructive"
                    data-component={`${EMPLOYEE_FORM_DIALOG_BASE}_error`}
                    className={styles.error}
                >
                    <AlertDescription>
                        <div className="flex flex-col gap-2">
                            <p>{error.message}</p>
                            {formErrorEntries.length > 0 ? (
                                <ul className="flex flex-col gap-1">
                                    {formErrorEntries.map(({ fieldError, field, id }) => {
                                        const fieldLabel = field === "name"
                                            ? t(locale, "employees.form.name")
                                            : field === "phone"
                                                ? t(locale, "employees.form.phone")
                                                : problemPresentation.unmappedField;
                                        const detail = `${fieldLabel}: ${fieldError.detail}`;

                                        return (
                                            <li key={id} id={id}>
                                                {field ? (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="whitespace-normal p-0 text-left"
                                                        onClick={() => focusFormField(field)}
                                                        data-component={`${EMPLOYEE_FORM_DIALOG_ERROR_ID_PREFIX}_entry_${field}`}
                                                    >
                                                        {detail}
                                                    </Button>
                                                ) : (
                                                    <span>{detail}</span>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : null}
                            {error.outcome === "UNKNOWN" ? (
                                <p>{problemPresentation.checkStatus}</p>
                            ) : null}
                            {error.requestId ? (
                                <p className="text-xs opacity-80">
                                    {locale === "en" ? `Request ID: ${error.requestId}` : `요청 ID: ${error.requestId}`}
                                </p>
                            ) : null}
                        </div>
                    </AlertDescription>
                </Alert>
            )}

            <EmployeeFormCard
                data-component={`${EMPLOYEE_FORM_DIALOG_BASE}_card`}
                formData={formData}
                touched={touched}
                isPhoneValid={isPhoneValid}
                hasPhoneError={hasPhoneError}
                phoneHelperMessage={phoneHelperMessage}
                phoneHelperTone={phoneHelperTone}
                isWorkAreaValid={isWorkAreaValid}
                disabled={isLoading}
                assignmentLabel={!isEditMode ? assignmentLabel : undefined}
                assignmentDescription={assignmentDescription}
                onChange={handleChange}
                onPhoneBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                onWorkAreaTouched={() => setTouched((prev) => ({ ...prev, workArea: true }))}
            />
        </MobileDetailSlideUp>
    );
}
