"use client";
import { normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { useState, useEffect, useMemo, useRef } from "react";
import {
    findOutOfPocketPriceInfo,
    formatOutOfPocketDurationLabel,
    getUserErrorMessage,
    resolveProblemPresentation,
} from "@babyjamjam/shared";
import {
    normalizeApiError,
    type NormalizedApiError,
    type ProblemError,
} from "@babyjamjam/shared/errors/problem-details";
import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useOutOfPocketPriceInfos, useVoucherPriceInfos } from "@/hooks/useVoucherData";
import { EmployeeAutocomplete } from "./EmployeeAutocomplete";
import { EmployeeFormDialog } from "../employees/EmployeeFormDialog";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import type { Employee } from "@/hooks/useEmployees";
import {
    Client,
    CreateClientDto,
    UpdateClientDto,
    SERVICE_STATUS_OPTIONS,
    type ServiceStatus
} from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useFieldMessages } from "@/hooks/use-field-messages";
import {
    focusFirstInvalidField,
    type FieldSpec,
    type SlotMessage,
    type SlotTone,
} from "@/lib/validations/field-message";
import { getErrorMessage } from "@/lib/errors/api-error-mapper";
import voucherOptions from "../messages/templates/json/voucher.json";

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
    SelectGroup,
    SelectLabel,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TogglePill } from "@/components/app/ui/toggle-pill";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";

interface ClientFormDialogProps {
    open: boolean;
    onClose: () => void;
    client?: Client | null; // null/undefined for create mode, Client for edit mode
    onSuccess?: (client: Client) => void; // Optional callback when client is created/updated
}

interface ClientFormErrorState {
    message: string;
    normalized?: NormalizedApiError;
}

interface StructuredErrorPresentation {
    detail: string;
    fieldId?: "name" | "phone";
    label: string;
    pointer: string;
    summaryId: string;
}

// Format number with commas (handles comma-formatted strings too)
const CLIENT_FORM_DIALOG_BASE = "mobile_clients_form-dialog";
const CLIENT_FORM_ERROR_SUMMARY_ID = `${CLIENT_FORM_DIALOG_BASE}_error-summary`;

type ClientFormField = "name" | "birthday" | "dueDate" | "phone" | "address" | "startDate" | "endDate";

// Top-to-bottom order of the validated fields; the first invalid one is focused on save.
const CLIENT_FORM_FIELD_ORDER: readonly ClientFormField[] = [
    "name",
    "birthday",
    "dueDate",
    "phone",
    "address",
    "startDate",
    "endDate",
];

const SLOT_TONE_CLASS: Record<SlotTone, string> = {
    muted: "text-v3-text-muted",
    ok: "text-v3-green",
    err: "text-v3-burgundy",
    pending: "text-v3-primary",
};

const messageIdFor = (field: ClientFormField): string => `${field}-message`;

interface FieldLabelRowProps {
    "data-component": string;
    htmlFor: ClientFormField;
    label: string;
    required?: boolean;
    message: SlotMessage | null;
}

/**
 * Label plus the field's single message slot at its top right. The row is one
 * label line tall (h-[1lh] on the label's own type), so a message never moves
 * the input below it; one that does not fit is cut with an ellipsis.
 */
function FieldLabelRow({
    "data-component": dataComponent,
    htmlFor,
    label,
    required = false,
    message,
}: FieldLabelRowProps) {
    return (
        <div
            className="flex h-[1lh] min-w-0 items-center gap-2 text-sm leading-none"
            data-component={`${dataComponent}_label-row`}
        >
            <Label htmlFor={htmlFor} className="shrink-0">
                {label}
                {required ? <span className="text-destructive ml-1">*</span> : null}
            </Label>
            <span
                id={messageIdFor(htmlFor)}
                className={cn(
                    "ml-auto min-w-0 truncate text-right text-[0.68rem] font-bold leading-[1.2]",
                    SLOT_TONE_CLASS[message?.tone ?? "muted"],
                )}
                aria-live="polite"
                data-component={`${dataComponent}_helper`}
            >
                {message?.text}
            </span>
        </div>
    );
}

const getKnownFieldId = (problemError: ProblemError): "name" | "phone" | undefined => {
    if (problemError.location !== undefined && problemError.location !== "body") {
        return undefined;
    }
    if (problemError.pointer === "/name") return "name";
    if (problemError.pointer === "/phone") return "phone";
    return undefined;
};

const formatPrice = (price: number | string): string => {
    if (!price && price !== 0) return "";
    // Remove existing commas before parsing
    const cleaned = typeof price === "string" ? price.replace(/,/g, "") : String(price);
    const num = parseInt(cleaned, 10);
    if (isNaN(num)) return "";
    return num.toLocaleString("ko-KR");
};

// Parse price string to raw number string (removes commas)
const parsePrice = (value: string | null | undefined): string => {
    if (!value) return "";
    return value.replace(/,/g, "");
};

// Format ISO date string to yyyy-MM-dd for HTML date input
const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    // Handle ISO format (e.g., "2025-12-26T00:00:00.000Z")
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
};

export function ClientFormDialog({ open, onClose, client, onSuccess }: ClientFormDialogProps) {
    const locale = useLocale();
    const isEditMode = !!client;

    // Read pre-filled name from Zustand store (when opened from ClientAutocomplete)
    const prefillName = useClientDialogStore((state) => state.prefillName);
    const clearPrefillName = useClientDialogStore((state) => state.clearPrefillName);

    const createClient = useCreateClient();
    const updateClient = useUpdateClient();

    // Form state - use extended type to allow null for primaryEmployeeId during form editing
    const [formData, setFormData] = useState<Omit<CreateClientDto, 'primaryEmployeeId'> & { primaryEmployeeId: number | null }>({
        name: "",
        birthday: "",
        dueDate: "",
        address: "",
        phone: "",
        primaryEmployeeId: null, // null means "not selected yet"
        secondaryEmployeeId: null,
        type: "",
        duration: null,
        fullPrice: "",
        grant: "",
        actualPrice: "",
        startDate: "",
        endDate: "",
        careCenter: false,
        voucherClient: false,
        breastPump: false,
        serviceStatus: "pre_booking",
    });

    const fieldSpecs: Record<ClientFormField, FieldSpec> = {
        name: { kind: "text", label: t(locale, "clients.form.name"), required: true },
        birthday: { kind: "birthday", label: t(locale, "clients.form.birthday"), required: true },
        dueDate: { kind: "date", label: t(locale, "clients.form.due-date"), required: true },
        phone: { kind: "phone", label: t(locale, "clients.form.phone"), required: true },
        address: { kind: "text", label: t(locale, "clients.form.address"), required: true },
        startDate: { kind: "date", label: t(locale, "clients.form.start-date") },
        endDate: {
            kind: "date",
            label: t(locale, "clients.form.end-date"),
            dateRange: { notBefore: formData.startDate ?? "" },
        },
    };
    const fieldMessages = useFieldMessages<ClientFormField>({
        values: {
            name: formData.name,
            birthday: formData.birthday ?? "",
            dueDate: formData.dueDate ?? "",
            phone: formData.phone ?? "",
            address: formData.address ?? "",
            startDate: formData.startDate ?? "",
            endDate: formData.endDate ?? "",
        },
        specs: fieldSpecs,
        locale,
    });
    const { reset: resetFieldMessages } = fieldMessages;

    const [errorState, setErrorState] = useState<ClientFormErrorState | null>(null);
    const [hasUnknownMutationOutcome, setHasUnknownMutationOutcome] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const formSessionRef = useRef<{ open: boolean; clientId: number | null }>({ open: false, clientId: null });
    const errorSummaryRef = useRef<HTMLDivElement>(null);

    // State for EmployeeFormDialog
    const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
    const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);

    // Track if prices were manually edited
    const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);

    // Fetch voucher price info based on selected type
    const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(formData.type || "");
    const {
        data: outOfPocketPriceInfos,
        isLoading: isOutOfPocketPriceLoading,
        isError: isOutOfPocketPriceError,
    } = useOutOfPocketPriceInfos();

    // Get available durations for the selected voucher type
    const availableDurations = useMemo(() => {
        if (!voucherPriceInfos) return [];
        // Get unique durations sorted
        const durations = [...new Set(voucherPriceInfos.map(info => Number(info.duration)))];
        return durations.sort((a, b) => a - b);
    }, [voucherPriceInfos]);

    // Get price info for selected type and duration
    const selectedPriceInfo = useMemo(() => {
        if (!formData.voucherClient) {
            return findOutOfPocketPriceInfo(outOfPocketPriceInfos, formData.duration);
        }
        if (!voucherPriceInfos || !formData.duration) return null;
        return voucherPriceInfos.find(
            info => Number(info.duration) === formData.duration
        );
    }, [formData.duration, formData.voucherClient, outOfPocketPriceInfos, voucherPriceInfos]);

    const durationOptions = useMemo(() => {
        if (!formData.voucherClient) {
            return (outOfPocketPriceInfos ?? []).map((priceInfo) => ({
                value: String(priceInfo.duration),
                label: formatOutOfPocketDurationLabel(priceInfo.duration),
            }));
        }
        return availableDurations.map((duration) => ({ value: String(duration), label: `${duration}일` }));
    }, [availableDurations, formData.voucherClient, outOfPocketPriceInfos]);

    const arePriceInputsLocked = formData.voucherClient
        ? !formData.type || !formData.duration || isPriceLoading
        : !formData.duration || isOutOfPocketPriceLoading || isOutOfPocketPriceError;

    // Auto-fill prices when type and duration are selected (only if not manually edited)
    useEffect(() => {
        if (selectedPriceInfo && !pricesManuallyEdited) {
            queueMicrotask(() => {
                setFormData(prev => prev.voucherClient
                    ? {
                        ...prev,
                        fullPrice: parsePrice(selectedPriceInfo.fullPrice),
                        grant: "grant" in selectedPriceInfo ? parsePrice(selectedPriceInfo.grant) : prev.grant,
                        actualPrice: "actualPrice" in selectedPriceInfo ? parsePrice(selectedPriceInfo.actualPrice) : prev.actualPrice,
                    }
                    : {
                        ...prev,
                        fullPrice: parsePrice(selectedPriceInfo.fullPrice),
                        grant: "0",
                        actualPrice: parsePrice(selectedPriceInfo.fullPrice),
                    });
            });
        }
    }, [selectedPriceInfo, pricesManuallyEdited]);

    // Reset duration when type changes
    const handleTypeChange = (newType: string) => {
        setFormData(prev => ({
            ...prev,
            type: newType,
            duration: null, // Reset duration when type changes
            // Only reset prices if not manually edited
            ...(pricesManuallyEdited ? {} : {
                fullPrice: "",
                grant: "",
                actualPrice: "",
            }),
        }));
    };

    const handleVoucherClientChange = (voucherClient: boolean) => {
        setPricesManuallyEdited(false);
        setFormData(prev => ({
            ...prev,
            voucherClient,
            type: "",
            duration: null,
            fullPrice: "",
            grant: "",
            actualPrice: "",
        }));
    };

    // Reset form when dialog opens/closes or client changes
    useEffect(() => {
        if (!open) {
            formSessionRef.current.open = false;
            return;
        }
        const sessionClientId = client?.id ?? null;
        if (formSessionRef.current.open && formSessionRef.current.clientId === sessionClientId) return;
        formSessionRef.current = { open: true, clientId: sessionClientId };
        if (!open) {
            return;
        }

        const nextFormData = client
            ? {
                name: client.name,
                birthday: normalizeBirthdayIsoDate(client.birthday) ?? client.birthday ?? "",
                dueDate: formatDateForInput(client.dueDate),
                address: client.address || "",
                phone: client.phone || "",
                primaryEmployeeId: client.primaryEmployee?.id ?? null,
                secondaryEmployeeId: client.secondaryEmployee?.id ?? null,
                type: client.type || "",
                duration: client.duration,
                fullPrice: client.fullPrice || "",
                grant: client.grant || "",
                actualPrice: client.actualPrice || "",
                startDate: formatDateForInput(client.startDate),
                endDate: formatDateForInput(client.endDate),
                careCenter: client.careCenter,
                voucherClient: client.voucherClient,
                breastPump: client.breastPump,
                serviceStatus: client.serviceStatus || "pre_booking",
            }
            : {
                name: prefillName || "",
                birthday: "",
                dueDate: "",
                address: "",
                phone: "",
                primaryEmployeeId: null,
                secondaryEmployeeId: null,
                type: "",
                duration: null,
                fullPrice: "",
                grant: "",
                actualPrice: "",
                startDate: "",
                endDate: "",
                careCenter: false,
                voucherClient: false,
                breastPump: false,
                serviceStatus: "pre_booking" as const,
            };
        const nextPricesManuallyEdited = client
            ? Boolean(client.fullPrice || client.grant || client.actualPrice)
            : false;

        queueMicrotask(() => {
            setPricesManuallyEdited(nextPricesManuallyEdited);
            setFormData(nextFormData);
            if (!client) {
                clearPrefillName();
            }
            resetFieldMessages();
            setErrorState(null);
            setHasUnknownMutationOutcome(false);
        });
    }, [open, client, prefillName, clearPrefillName, resetFieldMessages]);

    const handleChange = (field: keyof CreateClientDto, value: unknown) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // Handle manual price changes
    const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
        setPricesManuallyEdited(true);
        handleChange(field, value);
    };

    const setErrorAndScroll = (errorMessage: string, normalized?: NormalizedApiError) => {
        setErrorState({
            message: normalized?.message ?? getUserErrorMessage(errorMessage),
            normalized,
        });
        if (normalized?.outcome === "UNKNOWN") {
            setHasUnknownMutationOutcome(true);
        }
    };

    const handleSubmit = async () => {
        if (hasUnknownMutationOutcome) {
            return;
        }
        setErrorState(null);

        // 고객 기본 정보만 필수이며 서비스 정보는 상담 단계에서 비워둘 수 있다.
        // Each problem is shown in its own field's message slot; take the user to the first one.
        fieldMessages.markSubmitted();
        const invalidFields = fieldMessages.invalidFields(CLIENT_FORM_FIELD_ORDER);
        if (invalidFields.length > 0) {
            focusFirstInvalidField(invalidFields);
            return;
        }
        try {
            if (isEditMode && client) {
                // Build update DTO, excluding null employee IDs to avoid validation errors
                // (backend @IsOptional only skips undefined, not null)
                const updateDto: UpdateClientDto = {
                    name: formData.name,
                    birthday: formData.birthday,
                    dueDate: formData.dueDate || null,
                    address: formData.address,
                    phone: formData.phone,
                    // Only include employee IDs if explicitly selected (not null)
                    ...(formData.primaryEmployeeId !== null && { primaryEmployeeId: formData.primaryEmployeeId }),
                    ...(formData.secondaryEmployeeId !== null && { secondaryEmployeeId: formData.secondaryEmployeeId }),
                    type: formData.voucherClient ? formData.type : null,
                    duration: formData.duration || null,
                    fullPrice: formData.fullPrice,
                    grant: formData.voucherClient ? formData.grant : "0",
                    actualPrice: formData.voucherClient ? formData.actualPrice : formData.fullPrice,
                    startDate: formData.startDate || null,
                    endDate: formData.endDate || null,
                    careCenter: formData.careCenter,
                    voucherClient: formData.voucherClient,
                    breastPump: formData.breastPump,
                    serviceStatus: formData.serviceStatus,
                };
                const updatedClient = await updateClient.mutateAsync({ id: client.id, dto: updateDto });
                onSuccess?.(updatedClient);
            } else {
                const createDto: CreateClientDto = {
                    name: formData.name,
                    birthday: formData.birthday || null,
                    dueDate: formData.dueDate || null,
                    address: formData.address || null,
                    phone: formData.phone || null,
                    primaryEmployeeId: formData.primaryEmployeeId,
                    secondaryEmployeeId: formData.secondaryEmployeeId,
                    type: formData.voucherClient ? formData.type || null : null,
                    duration: formData.duration || null,
                    fullPrice: formData.fullPrice || null,
                    grant: formData.voucherClient ? formData.grant || null : "0",
                    actualPrice: formData.voucherClient ? formData.actualPrice || null : formData.fullPrice || null,
                    startDate: formData.startDate || null,
                    endDate: formData.endDate || null,
                    careCenter: formData.careCenter,
                    voucherClient: formData.voucherClient,
                    breastPump: formData.breastPump,
                    serviceStatus: formData.serviceStatus,
                };
                const newClient = await createClient.mutateAsync(createDto);
                onSuccess?.(newClient);
            }
            onClose();
        } catch (error: unknown) {
            const normalized = normalizeApiError(error, {
                locale: locale === "en" ? "en-US" : "ko-KR",
                operation: "mutation",
            });
            const responseData = error && typeof error === "object" && "response" in error
                ? (error.response as { data?: unknown } | undefined)?.data : error;
            const claimsProblem = responseData !== null && typeof responseData === "object"
                && ("type" in responseData || "requestId" in responseData);
            const isLegacyClientError = !normalized.verified && !claimsProblem
                && normalized.status !== undefined && normalized.status >= 400 && normalized.status < 500;
            const shouldUseNormalized = !isLegacyClientError;
            if (shouldUseNormalized) {
                setErrorAndScroll(normalized.message, normalized);
                return;
            }
            setErrorAndScroll(getErrorMessage(error, locale, "clients.form.error-save-failed"));
        }
    };

    const isSubmitting = createClient.isPending || updateClient.isPending;
    const structuredErrors = useMemo<StructuredErrorPresentation[]>(() => {
        const problemErrors = errorState?.normalized?.problem?.errors ?? [];
        return problemErrors.map((problemError, index) => {
            const fieldId = getKnownFieldId(problemError);
            const label = fieldId
                ? t(locale, `clients.form.${fieldId}`)
                : resolveProblemPresentation(locale).unmappedField;
            return {
                detail: problemError.detail,
                fieldId,
                label,
                pointer: problemError.pointer || "/",
                summaryId: `${CLIENT_FORM_ERROR_SUMMARY_ID}_item-${index}`,
            };
        });
    }, [errorState, locale]);

    const fieldErrorMessageIds = useMemo(() => {
        const ids: Record<"name" | "phone", string[]> = {
            name: [],
            phone: [],
        };
        structuredErrors.forEach((problemError) => {
            if (problemError.fieldId) {
                ids[problemError.fieldId].push(problemError.summaryId);
            }
        });
        return ids;
    }, [structuredErrors]);

    const fieldHasError = (field: ClientFormField): boolean =>
        fieldMessages.slot(field)?.tone === "err"
        || (field === "name" && fieldErrorMessageIds.name.length > 0)
        || (field === "phone" && fieldErrorMessageIds.phone.length > 0);
    const describedBy = (field: ClientFormField, serverErrorIds: readonly string[] = []): string =>
        [messageIdFor(field), ...serverErrorIds].join(" ");

    useEffect(() => {
        if (!errorState) {
            return;
        }

        // Use a timer to ensure the Alert is rendered before scrolling and focusing it.
        const timeoutId = setTimeout(() => {
            contentRef.current?.parentElement?.scrollTo?.({ top: 0, behavior: "smooth" });
            errorSummaryRef.current?.focus();
        }, 0);
        return () => clearTimeout(timeoutId);
    }, [errorState]);

    const focusFormField = (fieldId: "name" | "phone") => {
        const field = document.getElementById(fieldId);
        if (field instanceof HTMLElement) {
            field.focus();
        }
    };

    return (
        <Dialog data-component={CLIENT_FORM_DIALOG_BASE} open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-xl" data-testid="client-form-dialog">
                <DialogHeader>
                    <DialogTitle>
                        {isEditMode
                            ? t(locale, "clients.form.edit-title")
                            : t(locale, "clients.form.add-title")
                        }
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {isEditMode
                            ? t(locale, "clients.form.edit-description")
                            : t(locale, "clients.form.add-description")
                        }
                    </DialogDescription>
                </DialogHeader>

                <div ref={contentRef} data-component={`${CLIENT_FORM_DIALOG_BASE}_content`} className="space-y-6 py-4">
                    {errorState && (
                        <Alert
                            ref={errorSummaryRef}
                            id={CLIENT_FORM_ERROR_SUMMARY_ID}
                            data-component={CLIENT_FORM_ERROR_SUMMARY_ID}
                            variant="destructive"
                            tabIndex={-1}
                        >
                            <AlertDescription>
                                <p data-component={`${CLIENT_FORM_ERROR_SUMMARY_ID}_message`}>
                                    {errorState.message}
                                </p>
                                {structuredErrors.length > 0 && (
                                    <ul
                                        className="mt-2 space-y-1"
                                        data-component={`${CLIENT_FORM_ERROR_SUMMARY_ID}_items`}
                                    >
                                        {structuredErrors.map((problemError) => {
                                            const message = `${problemError.label}: ${problemError.detail}`;
                                            const fieldId = problemError.fieldId;
                                            return (
                                                <li key={problemError.summaryId} id={problemError.summaryId}>
                                                    {fieldId ? (
                                                        <Button
                                                            asChild
                                                            variant="link"
                                                            size="sm"
                                                            className="h-auto p-0 text-left"
                                                        >
                                                            <a
                                                                href={`#${problemError.fieldId}`}
                                                                onClick={(event) => {
                                                                    event.preventDefault();
                                                                    focusFormField(fieldId);
                                                                }}
                                                            >
                                                                {message}
                                                            </a>
                                                        </Button>
                                                    ) : (
                                                        message
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                                {errorState.normalized?.problem?.requestId && (
                                    <p
                                        className="mt-2 text-xs"
                                        data-component={`${CLIENT_FORM_ERROR_SUMMARY_ID}_request-id`}
                                    >
                                        {locale === "en" ? "Request ID" : "요청 ID"}: {errorState.normalized.problem.requestId}
                                    </p>
                                )}
                                {hasUnknownMutationOutcome && (
                                    <p
                                        className="mt-2 text-xs"
                                        data-component={`${CLIENT_FORM_ERROR_SUMMARY_ID}_status-guidance`}
                                    >
                                        {resolveProblemPresentation(locale).checkStatus}
                                    </p>
                                )}
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Basic Info Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-basic")}
                        </h4>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <FieldLabelRow
                                    data-component={`${CLIENT_FORM_DIALOG_BASE}_content_name-field`}
                                    htmlFor="name"
                                    label={t(locale, "clients.form.name")}
                                    required
                                    message={fieldMessages.slot("name")}
                                />
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => handleChange("name", e.target.value)}
                                    {...fieldMessages.bind("name")}
                                    error={fieldHasError("name")}
                                    aria-invalid={fieldHasError("name")}
                                    aria-describedby={describedBy("name", fieldErrorMessageIds.name)}
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabelRow
                                    data-component={`${CLIENT_FORM_DIALOG_BASE}_content_birthday-field`}
                                    htmlFor="birthday"
                                    label={t(locale, "clients.form.birthday")}
                                    message={fieldMessages.slot("birthday")}
                                />
                                <Input
                                    id="birthday"
                                    placeholder="1958-03-03"
                                    inputMode="numeric"
                                    value={formData.birthday ?? ""}
                                    onChange={(e) => handleChange("birthday", formatIsoDateInput(e.target.value))}
                                    {...fieldMessages.bind("birthday")}
                                    maxLength={10}
                                    error={fieldHasError("birthday")}
                                    aria-invalid={fieldHasError("birthday")}
                                    aria-describedby={describedBy("birthday")}
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabelRow
                                    data-component={`${CLIENT_FORM_DIALOG_BASE}_content_due-date-field`}
                                    htmlFor="dueDate"
                                    label={t(locale, "clients.form.due-date")}
                                    message={fieldMessages.slot("dueDate")}
                                />
                                <Input
                                    id="dueDate"
                                    placeholder="2026-11-20"
                                    inputMode="numeric"
                                    value={formData.dueDate || ""}
                                    onChange={(e) => handleChange("dueDate", formatIsoDateInput(e.target.value))}
                                    {...fieldMessages.bind("dueDate")}
                                    maxLength={10}
                                    error={fieldHasError("dueDate")}
                                    aria-invalid={fieldHasError("dueDate")}
                                    aria-describedby={describedBy("dueDate")}
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabelRow
                                    data-component={`${CLIENT_FORM_DIALOG_BASE}_content_phone-field`}
                                    htmlFor="phone"
                                    label={t(locale, "clients.form.phone")}
                                    message={fieldMessages.slot("phone")}
                                />
                                <Input
                                    id="phone"
                                    placeholder="010-1234-5678"
                                    value={formData.phone ?? ""}
                                    onChange={(e) => handleChange("phone", formatKoreanPhoneNumber(e.target.value))}
                                    {...fieldMessages.bind("phone")}
                                    maxLength={20}
                                    error={fieldHasError("phone")}
                                    aria-invalid={fieldHasError("phone")}
                                    aria-describedby={describedBy("phone", fieldErrorMessageIds.phone)}
                                />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <FieldLabelRow
                                    data-component={`${CLIENT_FORM_DIALOG_BASE}_content_address-field`}
                                    htmlFor="address"
                                    label={t(locale, "clients.form.address")}
                                    message={fieldMessages.slot("address")}
                                />
                                <Input
                                    id="address"
                                    value={formData.address ?? ""}
                                    onChange={(e) => handleChange("address", e.target.value)}
                                    {...fieldMessages.bind("address")}
                                    error={fieldHasError("address")}
                                    aria-invalid={fieldHasError("address")}
                                    aria-describedby={describedBy("address")}
                                />
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Employee Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-employee")}
                        </h4>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <EmployeeAutocomplete
                                data-component="mobile_clients_form-dialog_content_employee-grid_primary-autocomplete"
                                value={formData.primaryEmployeeId}
                                onChange={(id) => handleChange("primaryEmployeeId", id)}
                                label={t(locale, "clients.form.primary-employee")}
                                excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                                allowManualEntry
                                onManualEntry={() => {
                                    setEmployeeDialogTarget("primary");
                                    setIsEmployeeDialogOpen(true);
                                }}
                            />
                            <EmployeeAutocomplete
                                data-component="mobile_clients_form-dialog_content_employee-grid_secondary-autocomplete"
                                value={formData.secondaryEmployeeId ?? null}
                                onChange={(id) => handleChange("secondaryEmployeeId", id)}
                                label={t(locale, "clients.form.secondary-employee")}
                                excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                                allowManualEntry
                                onManualEntry={() => {
                                    setEmployeeDialogTarget("secondary");
                                    setIsEmployeeDialogOpen(true);
                                }}
                            />
                        </div>
                    </div>

                    <Separator />

                    {/* Service Info Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-service")}
                        </h4>

                        <div className="flex justify-center" data-component={`${CLIENT_FORM_DIALOG_BASE}_content_customer-type-toggle-field`}>
                            <TogglePill
                                data-component={`${CLIENT_FORM_DIALOG_BASE}_content_customer-type-toggle-field_toggle`}
                                value={formData.voucherClient}
                                onValueChange={handleVoucherClientChange}
                                leftLabel={t(locale, "clients.form.voucher-client")}
                                rightLabel={t(locale, "clients.form.self-pay-client")}
                                ariaLabel={t(locale, "clients.form.customer-type")}
                            />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {formData.voucherClient && <div className="space-y-2">
                                <Label>{t(locale, "clients.form.voucher-type")}</Label>
                                <Select
                                    value={formData.type || ""}
                                    onValueChange={handleTypeChange}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t(locale, "clients.form.voucher-type")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
                                            <SelectGroup key={groupName}>
                                                <SelectLabel className="font-semibold">{groupName}</SelectLabel>
                                                {Object.entries(types).map(([typeValue, typeData]) => (
                                                    <SelectItem key={typeValue} value={typeValue} className="pl-6">
                                                        {typeData.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>}
                            <div className="space-y-2">
                                <Label>{t(locale, "clients.form.duration")}</Label>
                                <div className="relative">
                                    <Select
                                        value={formData.duration?.toString() || ""}
                                        onValueChange={(value) => {
                                            handleChange("duration", value ? Number(value) : null);
                                            // Reset manual edit flag when duration changes to allow auto-fill
                                            setPricesManuallyEdited(false);
                                        }}
                                        disabled={formData.voucherClient
                                            ? !formData.type || isPriceLoading
                                            : isOutOfPocketPriceLoading || isOutOfPocketPriceError}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder={t(locale, "clients.form.duration")} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {durationOptions.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {(formData.voucherClient ? isPriceLoading : isOutOfPocketPriceLoading) && (
                                        <div className="absolute right-10 top-1/2 -translate-y-1/2">
                                            <Spinner className="h-4 w-4" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        {!formData.voucherClient && isOutOfPocketPriceError && (
                            <p className="text-xs font-medium text-destructive" data-component={`${CLIENT_FORM_DIALOG_BASE}_content_out-of-pocket-price-error`}>
                                자부담 요금 정보를 불러오지 못했습니다.
                            </p>
                        )}
                    </div>

                    <Separator />

                    {/* Pricing Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-primary">
                                {t(locale, "clients.form.section-pricing")}
                            </h4>
                            {selectedPriceInfo && !pricesManuallyEdited && (
                                <StatusBadge variant="doc_requested" size="sm">
                                    {t(locale, "clients.form.auto-filled")}
                                </StatusBadge>
                            )}
                        </div>

                        <div className={formData.voucherClient ? "grid grid-cols-1 sm:grid-cols-3 gap-4" : "grid grid-cols-1 gap-4"}>
                            <div className="space-y-2">
                                <Label htmlFor="fullPrice">{t(locale, "clients.form.full-price")}</Label>
                                <div className="relative">
                                    <Input
                                        id="fullPrice"
                                        placeholder="0"
                                        value={arePriceInputsLocked ? "" : formatPrice(formData.fullPrice || "")}
                                        onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                                        disabled={arePriceInputsLocked}
                                        className="pr-8"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                        원
                                    </span>
                                </div>
                            </div>
                            {formData.voucherClient && <div className="space-y-2">
                                <Label htmlFor="grant">{t(locale, "clients.form.grant")}</Label>
                                <div className="relative">
                                    <Input
                                        id="grant"
                                        placeholder="0"
                                        value={formatPrice(formData.grant || "")}
                                        onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                                        className="pr-8"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                        원
                                    </span>
                                </div>
                            </div>}
                            {formData.voucherClient && <div className="space-y-2">
                                <Label htmlFor="actualPrice">{t(locale, "clients.form.actual-price")}</Label>
                                <div className="relative">
                                    <Input
                                        id="actualPrice"
                                        placeholder="0"
                                        value={formatPrice(formData.actualPrice || "")}
                                        onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                                        className="pr-8"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                        원
                                    </span>
                                </div>
                            </div>}
                        </div>
                    </div>

                    <Separator />

                    {/* Contract Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-contract")}
                        </h4>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                            <div className="space-y-2 sm:col-span-2">
                                <Label>{t(locale, "clients.form.contract-status")}</Label>
                                <Select
                                    value={formData.serviceStatus || ""}
                                    onValueChange={(value) => handleChange("serviceStatus", value as ServiceStatus)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t(locale, "clients.form.contract-status")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {SERVICE_STATUS_OPTIONS.map((status) => (
                                            <SelectItem key={status.value} value={status.value}>
                                                {status.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <FieldLabelRow
                                    data-component={`${CLIENT_FORM_DIALOG_BASE}_content_start-date-field`}
                                    htmlFor="startDate"
                                    label={t(locale, "clients.form.start-date")}
                                    message={fieldMessages.slot("startDate")}
                                />
                                <Input
                                    id="startDate"
                                    placeholder="2026-12-01"
                                    inputMode="numeric"
                                    value={formData.startDate || ""}
                                    onChange={(e) => handleChange("startDate", formatIsoDateInput(e.target.value))}
                                    {...fieldMessages.bind("startDate")}
                                    maxLength={10}
                                    error={fieldHasError("startDate")}
                                    aria-invalid={fieldHasError("startDate")}
                                    aria-describedby={describedBy("startDate")}
                                />
                            </div>
                            <div className="space-y-2">
                                <FieldLabelRow
                                    data-component={`${CLIENT_FORM_DIALOG_BASE}_content_end-date-field`}
                                    htmlFor="endDate"
                                    label={t(locale, "clients.form.end-date")}
                                    message={fieldMessages.slot("endDate")}
                                />
                                <Input
                                    id="endDate"
                                    placeholder="2026-12-19"
                                    inputMode="numeric"
                                    value={formData.endDate || ""}
                                    onChange={(e) => handleChange("endDate", formatIsoDateInput(e.target.value))}
                                    {...fieldMessages.bind("endDate")}
                                    maxLength={10}
                                    error={fieldHasError("endDate")}
                                    aria-invalid={fieldHasError("endDate")}
                                    aria-describedby={describedBy("endDate")}
                                />
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Flags Section */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-primary">
                            {t(locale, "clients.form.section-flags")}
                        </h4>

                        <div className="flex flex-wrap gap-6">
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="careCenter"
                                    checked={formData.careCenter}
                                    onCheckedChange={(checked) => handleChange("careCenter", checked)}
                                />
                                <Label htmlFor="careCenter" className="cursor-pointer">
                                    {t(locale, "clients.form.care-center")}
                                </Label>
                            </div>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="breastPump"
                                    checked={formData.breastPump}
                                    onCheckedChange={(checked) => handleChange("breastPump", checked)}
                                />
                                <Label htmlFor="breastPump" className="cursor-pointer">
                                    {t(locale, "clients.form.breast-pump")}
                                </Label>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter data-component={`${CLIENT_FORM_DIALOG_BASE}_actions`}>
                    <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                        {t(locale, "common.cancel")}
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting || hasUnknownMutationOutcome}>
                        {isSubmitting ? (
                            <Spinner className="h-4 w-4" />
                        ) : isEditMode ? (
                            t(locale, "common.save")
                        ) : (
                            t(locale, "common.create")
                        )}
                    </Button>
                </DialogFooter>

                {/* Nested EmployeeFormDialog for adding new employees */}
                <EmployeeFormDialog
                    open={isEmployeeDialogOpen}
                    onClose={() => {
                        setIsEmployeeDialogOpen(false);
                        setEmployeeDialogTarget(null);
                    }}
                    onSuccess={(newEmployee: Employee) => {
                        // Auto-select the newly created employee in the appropriate field
                        if (employeeDialogTarget === "primary") {
                            handleChange("primaryEmployeeId", newEmployee.id);
                        } else if (employeeDialogTarget === "secondary") {
                            handleChange("secondaryEmployeeId", newEmployee.id);
                        }
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}
