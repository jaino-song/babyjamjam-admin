"use client";

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useVoucherPriceInfos } from "@/hooks/useVoucherData";
import { EmployeeAutocomplete } from "./EmployeeAutocomplete";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import {
    Client,
    CreateClientDto,
    UpdateClientDto,
    SERVICE_STATUS_OPTIONS
} from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import { cn } from "@/lib/utils";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import voucherOptions from "../messages/templates/json/voucher.json";

import {
    Dialog,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, V3_INPUT_CONTROL_CLASS_NAME } from "@/components/ui/input";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { TitleDescChildrenMolecule } from "@/components/app/ui/TitleDescChildrenMolecule";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import { TitleTextInputMolecule } from "../messages/forms/form-components/TitleTextInputMolecule";
import {
    SteppedWizardPanelContent,
} from "@/components/app/v3/SteppedWizardPanelLayout";
import { DETAIL_PANEL_FOOTER_CLASS_NAME } from "@/components/app/v3/DetailPanel";

export interface ClientFormDialogProps {
    open: boolean;
    onClose: () => void;
    client?: Client | null; // null/undefined for create mode, Client for edit mode
    onSuccess?: (client: Client) => void; // Optional callback when client is created/updated
}

export interface ClientFormPanelProps extends Omit<ClientFormDialogProps, "open"> {
    open?: boolean;
    activeStep?: number;
    onActiveStepChange?: (step: number) => void;
    renderLayout?: (parts: { content: ReactNode; footer: ReactNode }) => ReactNode;
}

const FIELD_GRID_CLASS_NAME = "grid grid-cols-1 gap-4 sm:grid-cols-2";
const SECTION_CARD_CLASS_NAME = "rounded-[24px] border border-v3-border/70 bg-white p-5";
const LABEL_CLASS_NAME = "text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-v3-text-muted";
const V3_INPUT_CLASS_NAME = V3_INPUT_CONTROL_CLASS_NAME;
export const CLIENT_FORM_STEPPER_STEPS = [
    { label: "이용자\n정보" },
    { label: "제공인력\n정보" },
    { label: "바우처\n정보" },
    { label: "계약\n정보" },
] as const;

const CLIENT_FORM_LAST_STEP_INDEX = CLIENT_FORM_STEPPER_STEPS.length - 1;

// Format number with commas (handles comma-formatted strings too)
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

// Format phone number as XXX-XXXX-XXXX
const formatPhoneNumber = (value: string): string => {
    // Remove all non-digit characters
    const digits = value.replace(/\D/g, "");

    // Apply formatting based on length
    if (digits.length <= 3) {
        return digits;
    } else if (digits.length <= 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    } else {
        return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
    }
};

// Format ISO date string to yyyy-MM-dd for HTML date input
const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    // Handle ISO format (e.g., "2025-12-26T00:00:00.000Z")
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
};

const formatDateForCompactInput = (dateString: string | null | undefined): string => {
    const formattedDate = formatDateForInput(dateString);
    if (!formattedDate) return "";
    return `${formattedDate.slice(2, 4)}${formattedDate.slice(5, 7)}${formattedDate.slice(8, 10)}`;
};

const parseCompactDateInput = (value: string): string => {
    return value.replace(/\D/g, "").slice(0, 6);
};

const normalizeCompactDateForSubmit = (value: string): string => {
    const compactDate = parseCompactDateInput(value);
    if (compactDate.length !== 6) return value;

    const yearPrefix = Number(compactDate.slice(0, 2)) >= 70 ? "19" : "20";
    return `${yearPrefix}${compactDate.slice(0, 2)}-${compactDate.slice(2, 4)}-${compactDate.slice(4, 6)}`;
};

const normalizeDateForCompactState = (value: string | null | undefined): string => {
    const compactDate = formatDateForCompactInput(value);
    if (compactDate) return compactDate;
    return parseCompactDateInput(value ?? "");
};

const isValidCompactDateInput = (value: string): boolean => {
    const compactDate = parseCompactDateInput(value);
    if (compactDate.length !== 6) return false;

    const normalizedDate = normalizeCompactDateForSubmit(compactDate);
    const date = new Date(`${normalizedDate}T00:00:00`);
    return (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() === Number(normalizedDate.slice(0, 4)) &&
        date.getMonth() + 1 === Number(normalizedDate.slice(5, 7)) &&
        date.getDate() === Number(normalizedDate.slice(8, 10))
    );
};

export function ClientFormPanel({
    open = true,
    onClose,
    client,
    onSuccess,
    activeStep,
    onActiveStepChange,
    renderLayout,
}: ClientFormPanelProps) {
    return (
        <ClientFormContent
            surface="panel"
            open={open}
            onClose={onClose}
            client={client}
            onSuccess={onSuccess}
            activeStep={activeStep}
            onActiveStepChange={onActiveStepChange}
            renderLayout={renderLayout}
        />
    );
}

export function ClientFormDialog({ open, onClose, client, onSuccess }: ClientFormDialogProps) {
    return (
        <ClientFormContent
            surface="dialog"
            open={open}
            onClose={onClose}
            client={client}
            onSuccess={onSuccess}
        />
    );
}

function ClientFormContent({
    surface,
    open,
    onClose,
    client,
    onSuccess,
    activeStep: controlledActiveStep,
    onActiveStepChange,
    renderLayout,
}: ClientFormDialogProps & Pick<ClientFormPanelProps, "activeStep" | "onActiveStepChange" | "renderLayout"> & { surface: "dialog" | "panel" }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const locale = useLocale();
    const isEditMode = !!client;

    // Read pre-filled name from Zustand store (when opened from ClientAutocomplete)
    const prefillName = useClientDialogStore((state) => state.prefillName);
    const clearPrefillName = useClientDialogStore((state) => state.clearPrefillName);
    const draft = useClientDialogStore((state) => state.draft);
    const setDraft = useClientDialogStore((state) => state.setDraft);
    const clearDraft = useClientDialogStore((state) => state.clearDraft);

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
        voucherClient: true,
        breastPump: false,
        serviceStatus: "waiting",
    });

    const [error, setError] = useState<string | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [internalActiveStep, setInternalActiveStep] = useState(0);
    const activeStep = controlledActiveStep ?? internalActiveStep;
    const setActiveStep = useCallback(
        (nextStep: number) => {
            const clampedStep = Math.max(0, Math.min(nextStep, CLIENT_FORM_LAST_STEP_INDEX));
            if (controlledActiveStep === undefined) {
                setInternalActiveStep(clampedStep);
            }
            onActiveStepChange?.(clampedStep);
        },
        [controlledActiveStep, onActiveStepChange]
    );

    // Track if prices were manually edited
    const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);

    // Fetch voucher price info based on selected type
    const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(formData.type || "");

    // Get available durations for the selected voucher type
    const availableDurations = useMemo(() => {
        if (!voucherPriceInfos) return [];
        // Get unique durations sorted
        const durations = [...new Set(voucherPriceInfos.map(info => Number(info.duration)))];
        return durations.sort((a, b) => a - b);
    }, [voucherPriceInfos]);

    // Get price info for selected type and duration
    const selectedPriceInfo = useMemo(() => {
        if (!voucherPriceInfos || !formData.duration) return null;
        return voucherPriceInfos.find(
            info => Number(info.duration) === formData.duration
        );
    }, [voucherPriceInfos, formData.duration]);

    // Auto-fill prices when type and duration are selected (only if not manually edited)
    useEffect(() => {
        if (selectedPriceInfo && !pricesManuallyEdited) {
            queueMicrotask(() => {
                setFormData(prev => ({
                    ...prev,
                    fullPrice: parsePrice(selectedPriceInfo.fullPrice),
                    grant: parsePrice(selectedPriceInfo.grant),
                    actualPrice: parsePrice(selectedPriceInfo.actualPrice),
                }));
            });
        }
    }, [selectedPriceInfo, pricesManuallyEdited]);

    useEffect(() => {
        queueMicrotask(() => {
            setFormData(prev => {
                const duration = prev.duration;
                const startDate = prev.startDate ?? "";

                if (!duration || !isValidCompactDateInput(startDate)) {
                    return prev.endDate ? { ...prev, endDate: "" } : prev;
                }

                const startDateIso = normalizeCompactDateForSubmit(startDate);
                const computedEndDateIso = calcEndDateBusinessDays(startDateIso, duration);
                const computedEndDate = normalizeDateForCompactState(computedEndDateIso);

                return prev.endDate === computedEndDate ? prev : {
                    ...prev,
                    endDate: computedEndDate,
                };
            });
        });
    }, [formData.duration, formData.startDate]);

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

    // Reset form when dialog opens/closes or client changes
    useEffect(() => {
        if (open) {
            const employeeCreatedId = searchParams.get("employeeCreatedId");
            const employeeTarget = searchParams.get("target");
            const parsedEmployeeId = employeeCreatedId ? Number(employeeCreatedId) : null;
            const hasReturnedEmployee =
                parsedEmployeeId !== null &&
                !Number.isNaN(parsedEmployeeId) &&
                (employeeTarget === "primary" || employeeTarget === "secondary");

            let nextFormData = draft?.formData ?? null;
            let nextPricesManuallyEdited = draft?.pricesManuallyEdited ?? false;

            if (!nextFormData && client) {
                nextFormData = {
                    name: client.name,
                    birthday: client.birthday || "",
                    dueDate: normalizeDateForCompactState(client.dueDate),
                    address: client.address || "",
                    phone: client.phone || "",
                    primaryEmployeeId: client.primaryEmployee?.id ?? null,
                    secondaryEmployeeId: client.secondaryEmployee?.id ?? null,
                    type: client.type || "",
                    duration: client.duration,
                    fullPrice: client.fullPrice || "",
                    grant: client.grant || "",
                    actualPrice: client.actualPrice || "",
                    startDate: normalizeDateForCompactState(client.startDate),
                    endDate: normalizeDateForCompactState(client.endDate),
                    careCenter: client.careCenter,
                    voucherClient: client.voucherClient,
                    breastPump: client.breastPump,
                    serviceStatus: client.serviceStatus || "waiting",
                };
                nextPricesManuallyEdited = Boolean(client.fullPrice || client.grant || client.actualPrice);
            }

            if (!nextFormData) {
                nextFormData = {
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
                    voucherClient: true,
                    breastPump: false,
                    serviceStatus: "waiting",
                };
                clearPrefillName();
            }

            nextFormData = {
                ...nextFormData,
                dueDate: normalizeDateForCompactState(nextFormData.dueDate),
                startDate: normalizeDateForCompactState(nextFormData.startDate),
                endDate: normalizeDateForCompactState(nextFormData.endDate),
            };

            if (hasReturnedEmployee && parsedEmployeeId !== null) {
                nextFormData = {
                    ...nextFormData,
                    primaryEmployeeId:
                        employeeTarget === "primary" ? parsedEmployeeId : nextFormData.primaryEmployeeId,
                    secondaryEmployeeId:
                        employeeTarget === "secondary" ? parsedEmployeeId : nextFormData.secondaryEmployeeId,
                };
            }

            queueMicrotask(() => {
                setFormData(nextFormData);
                setPricesManuallyEdited(nextPricesManuallyEdited);
                setError(null);

                if (hasReturnedEmployee) {
                    clearDraft();
                    router.replace("/clients?openClientForm=1");
                }
            });
        }
    }, [clearDraft, clearPrefillName, client, draft, open, prefillName, router, searchParams]);

    const handleChange = (field: keyof CreateClientDto, value: unknown) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // Handle manual price changes
    const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
        setPricesManuallyEdited(true);
        handleChange(field, value);
    };

    const scrollToTop = () => {
        // Scroll the DialogContent (parent of our content div) to top
        contentRef.current?.parentElement?.scrollTo({ top: 0, behavior: "smooth" });
    };

    const setErrorAndScroll = (errorMessage: string) => {
        setError(errorMessage);
        // Use setTimeout to ensure the Alert is rendered before scrolling
        setTimeout(scrollToTop, 0);
    };

    const handleStepChange = (nextStep: number) => {
        setError(null);
        setActiveStep(nextStep);
        setTimeout(scrollToTop, 0);
    };

    const handleSubmit = async () => {
        setError(null);

        // Validation - All fields required except secondary employee
        if (!formData.name.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-name-required"));
            return;
        }
        if (!formData.birthday?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-birthday-required"));
            return;
        }
        if (!formData.dueDate?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-due-date-required"));
            return;
        }
        if (!isValidCompactDateInput(formData.dueDate)) {
            setErrorAndScroll(t(locale, "clients.form.error-due-date-required"));
            return;
        }
        if (!formData.address?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-address-required"));
            return;
        }
        if (!formData.phone?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-phone-required"));
            return;
        }
        // Check for null/undefined specifically, as 0 can be a valid ID
        // In edit mode, skip this validation if employee hasn't been selected
        // (the backend will preserve the existing schedule)
        if (!formData.type?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-type-required"));
            return;
        }
        if (!formData.duration) {
            setErrorAndScroll(t(locale, "clients.form.error-duration-required"));
            return;
        }
        if (!formData.fullPrice?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-price-required"));
            return;
        }
        if (!formData.startDate?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-start-date-required"));
            return;
        }
        if (!isValidCompactDateInput(formData.startDate)) {
            setErrorAndScroll(t(locale, "clients.form.error-start-date-required"));
            return;
        }
        if (!formData.endDate?.trim()) {
            setErrorAndScroll(t(locale, "clients.form.error-end-date-required"));
            return;
        }
        if (!isValidCompactDateInput(formData.endDate)) {
            setErrorAndScroll(t(locale, "clients.form.error-end-date-required"));
            return;
        }

        try {
            const normalizedDueDate = normalizeCompactDateForSubmit(formData.dueDate);
            const normalizedStartDate = normalizeCompactDateForSubmit(formData.startDate);
            const normalizedEndDate = normalizeCompactDateForSubmit(formData.endDate);

            if (isEditMode && client) {
                // Build update DTO, excluding null employee IDs to avoid validation errors
                // (backend @IsOptional only skips undefined, not null)
                const updateDto: UpdateClientDto = {
                    name: formData.name,
                    birthday: formData.birthday,
                    dueDate: normalizedDueDate || null,
                    address: formData.address,
                    phone: formData.phone,
                    // Only include employee IDs if explicitly selected (not null)
                    ...(formData.primaryEmployeeId !== null && { primaryEmployeeId: formData.primaryEmployeeId }),
                    ...(formData.secondaryEmployeeId !== null && { secondaryEmployeeId: formData.secondaryEmployeeId }),
                    type: formData.type,
                    duration: formData.duration || null,
                    fullPrice: formData.fullPrice,
                    grant: formData.grant,
                    actualPrice: formData.actualPrice,
                    startDate: normalizedStartDate || null,
                    endDate: normalizedEndDate || null,
                    careCenter: formData.careCenter,
                    voucherClient: formData.voucherClient,
                    breastPump: formData.breastPump,
                    serviceStatus: formData.serviceStatus,
                };
                const updatedClient = await updateClient.mutateAsync({ id: client.id, dto: updateDto });
                clearDraft();
                onSuccess?.(updatedClient);
            } else {
                const createDto: CreateClientDto = {
                    ...formData,
                    dueDate: normalizedDueDate,
                    duration: formData.duration || null,
                    startDate: normalizedStartDate || null,
                    endDate: normalizedEndDate || null,
                };
                const newClient = await createClient.mutateAsync(createDto);
                clearDraft();
                onSuccess?.(newClient);
            }
            onClose();
        } catch (error: unknown) {
            console.error("Failed to save client:", error);
            setErrorAndScroll(getErrorMessage(error, locale, "clients.form.error-save-failed"));
        }
    };

    const isSubmitting = createClient.isPending || updateClient.isPending;

    const isBasicStepValid = Boolean(
        formData.name.trim() &&
        formData.birthday?.trim() &&
        isValidCompactDateInput(formData.dueDate ?? "") &&
        formData.address?.trim() &&
        formData.phone?.trim()
    );
    const isEmployeeStepValid = true;
    const isVoucherStepValid = Boolean(
        formData.type?.trim() &&
        formData.duration &&
        formData.fullPrice?.trim()
    );
    const isContractStepValid = Boolean(
        isValidCompactDateInput(formData.startDate ?? "") &&
        isValidCompactDateInput(formData.endDate ?? "")
    );
    const stepValidation = [
        isBasicStepValid,
        isEmployeeStepValid,
        isVoucherStepValid,
        isContractStepValid,
    ] as const;
    const isCurrentStepValid = stepValidation[activeStep] ?? true;
    const isFormComplete = isBasicStepValid && isVoucherStepValid && isContractStepValid;

    const handleDialogClose = () => {
        clearDraft();

        if (searchParams.get("openClientForm") === "1") {
            router.replace("/clients");
        }

        onClose();
    };

    const formTitle = isEditMode
        ? t(locale, "clients.form.edit-title")
        : t(locale, "clients.form.add-title");
    const formDescription = isEditMode
        ? "기본 정보, 담당 인력, 서비스 조건을 한 번에 수정합니다."
        : "고객의 기본 정보와 서비스 조건을 단계 없이 빠르게 등록합니다.";
    const dialogFormActions = (
        <>
            <Button variant="neutral" onClick={handleDialogClose} disabled={isSubmitting}>
                {t(locale, "common.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? (
                    <Spinner className="h-4 w-4" />
                ) : isEditMode ? (
                    t(locale, "common.save")
                ) : (
                    t(locale, "common.create")
                )}
            </Button>
        </>
    );
    const panelFormActions = (
        <>
            {activeStep === 0 && (
                <Button variant="neutral" size="sm" width="sm" onClick={handleDialogClose} disabled={isSubmitting}>
                    {t(locale, "common.cancel")}
                </Button>
            )}
            {activeStep > 0 && (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    width="sm"
                    onClick={() => handleStepChange(activeStep - 1)}
                    disabled={isSubmitting}
                    data-component="clients-form-panel-prev"
                >
                    이전
                </Button>
            )}
            {activeStep < CLIENT_FORM_LAST_STEP_INDEX ? (
                <Button
                    type="button"
                    size="sm"
                    width="sm"
                    onClick={() => handleStepChange(activeStep + 1)}
                    disabled={!isCurrentStepValid || isSubmitting}
                    data-component="clients-form-panel-next"
                >
                    다음
                </Button>
            ) : (
                <Button
                    type="button"
                    size="sm"
                    width="sm"
                    onClick={handleSubmit}
                    disabled={isSubmitting || !isFormComplete}
                    data-component="clients-form-panel-submit"
                >
                    {isSubmitting ? (
                        <Spinner className="h-4 w-4" />
                    ) : isEditMode ? (
                        t(locale, "common.save")
                    ) : (
                        t(locale, "common.create")
                    )}
                </Button>
            )}
        </>
    );

    const basicInfoSection = (
        <TitleDescChildrenMolecule
            title={t(locale, "clients.form.section-basic")}
            description="고객의 프로필과 연락처를 먼저 입력해 주세요."
            className={SECTION_CARD_CLASS_NAME}
            titleClassName={LABEL_CLASS_NAME}
        >
            <div className={FIELD_GRID_CLASS_NAME}>
                <div className="space-y-2">
                    <Label htmlFor="name" className={LABEL_CLASS_NAME}>
                        {t(locale, "clients.form.name")}
                        <span className="text-destructive ml-1">*</span>
                    </Label>
                    <Input
                        id="name"
                        className={V3_INPUT_CLASS_NAME}
                        value={formData.name}
                        onChange={(e) => handleChange("name", e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="birthday" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.birthday")}</Label>
                    <Input
                        id="birthday"
                        className={V3_INPUT_CLASS_NAME}
                        placeholder="YYMMDD"
                        value={formData.birthday ?? ""}
                        onChange={(e) => handleChange("birthday", e.target.value)}
                        maxLength={6}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t(locale, "clients.form.birthday-helper")}
                    </p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="dueDate" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.due-date")}</Label>
                    <Input
                        id="dueDate"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="YYMMDD"
                        className={V3_INPUT_CLASS_NAME}
                        value={formData.dueDate || ""}
                        onChange={(e) => handleChange("dueDate", parseCompactDateInput(e.target.value))}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="phone" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.phone")}</Label>
                    <Input
                        id="phone"
                        className={V3_INPUT_CLASS_NAME}
                        placeholder="010-1234-5678"
                        value={formData.phone ?? ""}
                        onChange={(e) => handleChange("phone", formatPhoneNumber(e.target.value))}
                        maxLength={13}
                    />
                </div>
                <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="address" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.address")}</Label>
                    <Input
                        id="address"
                        className={V3_INPUT_CLASS_NAME}
                        placeholder="상세 주소"
                        value={formData.address ?? ""}
                        onChange={(e) => handleChange("address", e.target.value)}
                    />
                </div>
            </div>
        </TitleDescChildrenMolecule>
    );

    const employeeSection = (
        <TitleDescChildrenMolecule
            title={t(locale, "clients.form.section-employee")}
            description="서비스를 담당할 제공인력을 배정해 주세요."
            className={SECTION_CARD_CLASS_NAME}
            titleClassName={LABEL_CLASS_NAME}
        >
            <div className={FIELD_GRID_CLASS_NAME}>
                <EmployeeAutocomplete
                    value={formData.primaryEmployeeId}
                    onChange={(id) => handleChange("primaryEmployeeId", id)}
                    label={t(locale, "clients.form.primary-employee")}
                    excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                    allowManualEntry
                    onManualEntry={() => {
                        setDraft({
                            formData,
                            pricesManuallyEdited,
                            client: client ?? null,
                        });
                        router.push("/employees/new?returnTo=/clients?openClientForm=1&target=primary");
                    }}
                />
                <EmployeeAutocomplete
                    value={formData.secondaryEmployeeId ?? null}
                    onChange={(id) => handleChange("secondaryEmployeeId", id)}
                    label={t(locale, "clients.form.secondary-employee")}
                    excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                    allowManualEntry
                    onManualEntry={() => {
                        setDraft({
                            formData,
                            pricesManuallyEdited,
                            client: client ?? null,
                        });
                        router.push("/employees/new?returnTo=/clients?openClientForm=1&target=secondary");
                    }}
                />
            </div>
        </TitleDescChildrenMolecule>
    );

    const voucherInfoSections = (
        <>
            <TitleDescChildrenMolecule
                title={t(locale, "clients.form.section-service")}
                description="바우처 유형과 서비스 기간을 선택해 주세요."
                className={SECTION_CARD_CLASS_NAME}
                titleClassName={LABEL_CLASS_NAME}
            >
                <div className="flex flex-wrap items-end gap-4">
                    <div className="flex-1 space-y-2">
                        <Label className={LABEL_CLASS_NAME}>{t(locale, "clients.form.voucher-type")}</Label>
                        <Select
                            value={formData.type || ""}
                            onValueChange={handleTypeChange}
                        >
                            <SelectTrigger className="w-full">
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
                    </div>
                    <div className="flex-1 space-y-2">
                        <Label className={LABEL_CLASS_NAME}>{t(locale, "clients.form.duration")}</Label>
                        <div className="relative">
                            <Select
                                value={formData.duration?.toString() || ""}
                                onValueChange={(value) => {
                                    handleChange("duration", value ? Number(value) : null);
                                    setPricesManuallyEdited(false);
                                }}
                                disabled={!formData.type || isPriceLoading}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t(locale, "clients.form.duration")} />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableDurations.map((duration) => (
                                        <SelectItem key={duration} value={String(duration)}>
                                            {duration}일
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {isPriceLoading && (
                                <div className="absolute right-10 top-1/2 -translate-y-1/2">
                                    <Spinner className="h-4 w-4" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </TitleDescChildrenMolecule>

            <TitleDescChildrenMolecule
                title={t(locale, "clients.form.section-pricing")}
                description="서비스 금액과 지원 금액을 확인하고 조정해 주세요."
                className={SECTION_CARD_CLASS_NAME}
                titleClassName={LABEL_CLASS_NAME}
            >
                <div className="flex flex-wrap items-end gap-4">
                    <div className="flex-1 space-y-2">
                        <Label htmlFor="fullPrice" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.full-price")}</Label>
                        <div className="relative">
                            <Input
                                id="fullPrice"
                                placeholder="0"
                                value={formatPrice(formData.fullPrice || "")}
                                onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                                className={cn(V3_INPUT_CLASS_NAME, "pr-8")}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                원
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 space-y-2">
                        <Label htmlFor="grant" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.grant")}</Label>
                        <div className="relative">
                            <Input
                                id="grant"
                                placeholder="0"
                                value={formatPrice(formData.grant || "")}
                                onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                                className={cn(V3_INPUT_CLASS_NAME, "pr-8")}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                원
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 space-y-2">
                        <Label htmlFor="actualPrice" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.actual-price")}</Label>
                        <div className="relative">
                            <Input
                                id="actualPrice"
                                placeholder="0"
                                value={formatPrice(formData.actualPrice || "")}
                                onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                                className={cn(V3_INPUT_CLASS_NAME, "pr-8")}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                                원
                            </span>
                        </div>
                    </div>
                </div>
            </TitleDescChildrenMolecule>
        </>
    );

    const contractInfoSections = (
        <>
            <TitleDescChildrenMolecule
                title={t(locale, "clients.form.section-contract")}
                description="계약 상태와 서비스 일정을 정리해 주세요."
                className={SECTION_CARD_CLASS_NAME}
                titleClassName={LABEL_CLASS_NAME}
            >
                <div className="flex flex-wrap items-end gap-4">
                    <div className="flex-1 space-y-2">
                        <Label className={LABEL_CLASS_NAME}>{t(locale, "clients.form.contract-status")}</Label>
                        <Select
                            value={formData.serviceStatus || ""}
                            onValueChange={(value) => handleChange("serviceStatus", value)}
                        >
                            <SelectTrigger className="w-full">
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
                    <div className="flex-1 space-y-2">
                        <Label htmlFor="startDate" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.start-date")}</Label>
                        <Input
                            id="startDate"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="YYMMDD"
                            className={V3_INPUT_CLASS_NAME}
                            value={formData.startDate || ""}
                            onChange={(e) => handleChange("startDate", parseCompactDateInput(e.target.value))}
                        />
                    </div>
                    <div className="flex-1 space-y-2">
                        <Label htmlFor="endDate" className={LABEL_CLASS_NAME}>{t(locale, "clients.form.end-date")}</Label>
                        <Input
                            id="endDate"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="YYMMDD"
                            className={V3_INPUT_CLASS_NAME}
                            value={formData.endDate || ""}
                            readOnly
                            aria-readonly="true"
                        />
                    </div>
                </div>
            </TitleDescChildrenMolecule>

            <TitleDescChildrenMolecule
                title={t(locale, "clients.form.section-flags")}
                description="추가 서비스 옵션을 설정해 주세요."
                className={SECTION_CARD_CLASS_NAME}
                titleClassName={LABEL_CLASS_NAME}
            >
                <div className="flex flex-wrap gap-6">
                    <div className="flex items-center gap-2">
                        <Switch
                            id="voucherClient"
                            checked={formData.voucherClient}
                            onCheckedChange={(checked) => handleChange("voucherClient", checked)}
                        />
                        <Label htmlFor="voucherClient" className="cursor-pointer">
                            {t(locale, "clients.form.voucher-client")}
                        </Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            id="careCenter"
                            checked={formData.careCenter === true}
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
            </TitleDescChildrenMolecule>
        </>
    );

    const panelBasicInfoStep = (
        <>
            <TitleTextInputMolecule
                id="name"
                label={t(locale, "clients.form.name")}
                value={formData.name}
                onValueChange={(value) => handleChange("name", value)}
                required
                dataComponent="clients-form-panel-name-input"
            />
            <TitleTextInputMolecule
                id="birthday"
                label={t(locale, "clients.form.birthday")}
                placeholder="YYMMDD"
                value={formData.birthday ?? ""}
                onValueChange={(value) => handleChange("birthday", value)}
                maxLength={6}
                dataComponent="clients-form-panel-birthday-input"
            />
            <TitleTextInputMolecule
                id="dueDate"
                label={t(locale, "clients.form.due-date")}
                placeholder="YYMMDD"
                inputMode="numeric"
                value={formData.dueDate || ""}
                onValueChange={(value) => handleChange("dueDate", parseCompactDateInput(value))}
                maxLength={6}
                dataComponent="clients-form-panel-due-date-input"
            />
            <TitleTextInputMolecule
                id="phone"
                label={t(locale, "clients.form.phone")}
                placeholder="010-1234-5678"
                value={formData.phone ?? ""}
                onValueChange={(value) => handleChange("phone", formatPhoneNumber(value))}
                maxLength={13}
                dataComponent="clients-form-panel-phone-input"
            />
            <TitleTextInputMolecule
                id="address"
                label={t(locale, "clients.form.address")}
                placeholder="상세 주소"
                value={formData.address ?? ""}
                onValueChange={(value) => handleChange("address", value)}
                dataComponent="clients-form-panel-address-input"
            />
        </>
    );

    const panelEmployeeStep = (
        <>
            <EmployeeAutocomplete
                value={formData.primaryEmployeeId}
                onChange={(id) => handleChange("primaryEmployeeId", id)}
                label={t(locale, "clients.form.primary-employee")}
                excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                allowManualEntry
                onManualEntry={() => {
                    setDraft({
                        formData,
                        pricesManuallyEdited,
                        client: client ?? null,
                    });
                    router.push("/employees/new?returnTo=/clients?openClientForm=1&target=primary");
                }}
            />
            <EmployeeAutocomplete
                value={formData.secondaryEmployeeId ?? null}
                onChange={(id) => handleChange("secondaryEmployeeId", id)}
                label={t(locale, "clients.form.secondary-employee")}
                excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                allowManualEntry
                onManualEntry={() => {
                    setDraft({
                        formData,
                        pricesManuallyEdited,
                        client: client ?? null,
                    });
                    router.push("/employees/new?returnTo=/clients?openClientForm=1&target=secondary");
                }}
            />
        </>
    );

    const panelVoucherInfoStep = (
        <>
            <div className="flex flex-col gap-2">
                <Label>{t(locale, "clients.form.voucher-type")}</Label>
                <Select
                    value={formData.type || ""}
                    onValueChange={handleTypeChange}
                >
                    <SelectTrigger className="w-full">
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
            </div>
            <div className="flex flex-col gap-2">
                <Label>{t(locale, "clients.form.duration")}</Label>
                <div className="relative">
                    <Select
                        value={formData.duration?.toString() || ""}
                        onValueChange={(value) => {
                            handleChange("duration", value ? Number(value) : null);
                            setPricesManuallyEdited(false);
                        }}
                        disabled={!formData.type || isPriceLoading}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={t(locale, "clients.form.duration")} />
                        </SelectTrigger>
                        <SelectContent>
                            {availableDurations.map((duration) => (
                                <SelectItem key={duration} value={String(duration)}>
                                    {duration}일
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {isPriceLoading && (
                        <div className="absolute right-10 top-1/2 -translate-y-1/2">
                            <Spinner className="h-4 w-4" />
                        </div>
                    )}
                </div>
            </div>
            <TitleTextInputMolecule
                id="fullPrice"
                label={t(locale, "clients.form.full-price")}
                placeholder="0"
                value={formatPrice(formData.fullPrice || "")}
                onValueChange={(value) => handlePriceChange("fullPrice", value.replace(/,/g, ""))}
                dataComponent="clients-form-panel-full-price-input"
            />
            <TitleTextInputMolecule
                id="grant"
                label={t(locale, "clients.form.grant")}
                placeholder="0"
                value={formatPrice(formData.grant || "")}
                onValueChange={(value) => handlePriceChange("grant", value.replace(/,/g, ""))}
                dataComponent="clients-form-panel-grant-input"
            />
            <TitleTextInputMolecule
                id="actualPrice"
                label={t(locale, "clients.form.actual-price")}
                placeholder="0"
                value={formatPrice(formData.actualPrice || "")}
                onValueChange={(value) => handlePriceChange("actualPrice", value.replace(/,/g, ""))}
                dataComponent="clients-form-panel-actual-price-input"
            />
        </>
    );

    const panelContractInfoStep = (
        <>
            <div className="flex flex-col gap-2">
                <Label>{t(locale, "clients.form.contract-status")}</Label>
                <Select
                    value={formData.serviceStatus || ""}
                    onValueChange={(value) => handleChange("serviceStatus", value)}
                >
                    <SelectTrigger className="w-full">
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
            <TitleTextInputMolecule
                id="startDate"
                label={t(locale, "clients.form.start-date")}
                placeholder="YYMMDD"
                inputMode="numeric"
                value={formData.startDate || ""}
                onValueChange={(value) => handleChange("startDate", parseCompactDateInput(value))}
                maxLength={6}
                dataComponent="clients-form-panel-start-date-input"
            />
            <TitleTextInputMolecule
                id="endDate"
                label={t(locale, "clients.form.end-date")}
                placeholder="YYMMDD"
                inputMode="numeric"
                value={formData.endDate || ""}
                maxLength={6}
                readOnly
                aria-readonly="true"
                dataComponent="clients-form-panel-end-date-input"
            />
            <div className="flex flex-wrap gap-6 pt-1">
                <div className="flex items-center gap-2">
                    <Switch
                        id="voucherClientPanel"
                        checked={formData.voucherClient}
                        onCheckedChange={(checked) => handleChange("voucherClient", checked)}
                    />
                    <Label htmlFor="voucherClientPanel" className="cursor-pointer">
                        {t(locale, "clients.form.voucher-client")}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id="careCenterPanel"
                        checked={formData.careCenter === true}
                        onCheckedChange={(checked) => handleChange("careCenter", checked)}
                    />
                    <Label htmlFor="careCenterPanel" className="cursor-pointer">
                        {t(locale, "clients.form.care-center")}
                    </Label>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        id="breastPumpPanel"
                        checked={formData.breastPump}
                        onCheckedChange={(checked) => handleChange("breastPump", checked)}
                    />
                    <Label htmlFor="breastPumpPanel" className="cursor-pointer">
                        {t(locale, "clients.form.breast-pump")}
                    </Label>
                </div>
            </div>
        </>
    );

    const dialogFormSteps = [
        basicInfoSection,
        employeeSection,
        voucherInfoSections,
        contractInfoSections,
    ] as const;
    const panelFormSteps = [
        panelBasicInfoStep,
        panelEmployeeStep,
        panelVoucherInfoStep,
        panelContractInfoStep,
    ] as const;

    const formError = error ? (
        <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
        </Alert>
    ) : null;

    const formContent = surface === "panel" ? (
        <SteppedWizardPanelContent
            ref={contentRef}
            dataComponent="clients-form-panel-content"
            flattenStepContent
            className="py-0"
            stepContentClassName="justify-start gap-4"
            feedback={formError}
        >
            {panelFormSteps[activeStep]}
        </SteppedWizardPanelContent>
    ) : (
        <div
            ref={contentRef}
            data-component="clients-form-dialog-content"
            className="space-y-5"
        >
            {formError}
            {dialogFormSteps}
        </div>
    );

    const panelFooter = panelFormActions;

    if (surface === "panel" && !open) {
        return null;
    }

    if (surface === "panel") {
        return renderLayout ? renderLayout({ content: formContent, footer: panelFooter }) : (
            <>
                {formContent}
                <footer data-component="detail-panel-footer" className={DETAIL_PANEL_FOOTER_CLASS_NAME}>
                    {panelFooter}
                </footer>
            </>
        );
    }

    return (
        <Dialog data-component="clients-form-dialog" open={open} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
            <FormDialogShell
                dataComponent="clients-form-dialog"
                title={formTitle}
                description={formDescription}
                dialogClassName="w-[85%] max-w-[460px] min-h-[70vh] max-h-[70vh] sm:w-[85%] sm:max-w-[460px]"
                contentClassName="space-y-5"
                footer={dialogFormActions}
            >
                {formContent}
            </FormDialogShell>
        </Dialog>
    );
}
