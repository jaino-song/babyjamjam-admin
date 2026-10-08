"use client";

import { Fragment, useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    findOutOfPocketPriceInfo,
    formatOutOfPocketDurationLabel,
    getUserErrorMessage,
    resolveProblemPresentation,
    normalizeApiError,
    type ProblemError,
    type ProblemOutcome,
} from "@babyjamjam/shared";
import { isValidBirthdayIsoDate, normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import {
    isRealIsoDate,
    resolveFieldMessage,
    type FieldKind,
} from "@babyjamjam/shared/utils/field-validation-message";
import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useClientPhoneDuplicateCheck } from "@/hooks/useClientPhoneDuplicateCheck";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { CalendarLoadNotice } from "@/components/app/holidays/CalendarLoadNotice";
import { useFieldInputStates } from "@/hooks/useFieldInputStates";
import {
    useAvailableClientAreas,
    useOutOfPocketPriceInfos,
    useVoucherPriceInfos,
    useVoucherYears,
} from "@/hooks/useVoucherData";
import type { ClientFormData } from "@/features/clients/types";
import { buildClientUpdatePayload, hasServicePeriodChange } from "./client-update-payload";
import { EmployeeAutocomplete } from "./EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import {
    Client,
    CreateClientDto,
    SERVICE_STATUS_OPTIONS
} from "@/lib/client/types";
import type { Employee } from "@/hooks/useEmployees";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { getErrorMessage } from "@/lib/errors/prisma-error-mapper";
import { cn } from "@/lib/utils";
import type { KrBusinessDayCalendar } from "@/lib/date/business-days";
import { formatIsoDateInput } from "@/lib/date/format-iso-input";
import {
    resolveElevenDigitPhoneMessage,
    toFieldMessageView,
    withGuidance,
    type FieldMessageView,
} from "@/lib/forms/field-message-text";
import voucherOptions from "../messages/templates/json/voucher.json";

import {
    Dialog,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import { FieldMessageText } from "@/components/app/ui/field-message";
import {
    FormField,
    FormGrid,
    FormHelperText,
    FormNativeSelect,
    FormSection,
    FormSwitchRow,
    FormTextInput,
    FormTextInputWithSuffix,
} from "@/components/app/ui/form-section";
import { TogglePill } from "@/components/app/ui/toggle-pill";
import {
    SteppedWizardPanelContent,
} from "@/components/app/v3/SteppedWizardPanelLayout";
import {
    DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME,
    DETAIL_PANEL_FOOTER_CLASS_NAME,
    DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME,
} from "@/components/app/v3/DetailPanel";

export interface ClientFormDialogProps {
    /** Caller-context canonical data-component base for this form instance. */
    "data-component"?: string;
    open: boolean;
    onClose: () => void;
    /** Return false to keep a dirty form open while the caller confirms discard. */
    onBeforeClose?: () => boolean;
    client?: Client | null; // null/undefined for create mode, Client for edit mode
    /** 생성 모드에서 다이얼로그가 open 상태로 전환될 때 적용된다. 열린 뒤 참조가 바뀌어도 반영되지 않으며, client가 있으면(수정 모드) 무시된다. */
    prefill?: Partial<ClientFormData>;
    /** 다이얼로그 상단에 표시할 안내 문구 (예: 계약서 연동 주의사항). */
    notice?: string;
    onSuccess?: (client: Client) => void; // Optional callback when client is created/updated
}

export interface ClientFormPanelProps extends Omit<ClientFormDialogProps, "open" | "notice"> {
    open?: boolean;
    activeStep?: number;
    onActiveStepChange?: (step: number) => void;
    onDirtyChange?: (dirty: boolean) => void;
    renderLayout?: (parts: { content: ReactNode; footer: ReactNode }) => ReactNode;
}

export type { ClientFormData };

/** Static guidance shown in a field's label-row slot while nothing more urgent applies. */
const AREA_FIELD_GUIDANCE = "자동문자 입금 계좌에 쓰여요";
const OUT_OF_POCKET_PRICE_ERROR = "자부담 요금을 불러오지 못했어요";
const CLIENT_END_DATE_CHANGED_MESSAGE =
    "그동안 서비스 종료일이 바뀌어 저장하지 않았어요. 창을 닫고 다시 열어 최신 정보로 수정해 주세요.";

const PANEL_STEP_CONTENT_CLASS_NAME =
    "grid w-full grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] md:grid-cols-2";
const PANEL_FULL_FIELD_CLASS_NAME = "md:col-span-2";
// Fields that are the price fields or that the price table is looked up by (the voucher year
// defaults from the end date, which follows the start date and duration).
const PRICE_BASELINE_FREEZING_FIELDS: ReadonlySet<keyof CreateClientDto> = new Set<keyof CreateClientDto>([
    "fullPrice",
    "grant",
    "actualPrice",
    "duration",
    "type",
    "voucherClient",
    "startDate",
    "endDate",
]);
export const CLIENT_FORM_STEPPER_STEPS = [
    { label: "이용자\n정보" },
    { label: "제공인력\n정보" },
    { label: "바우처\n정보" },
    { label: "계약\n정보" },
] as const;

const CLIENT_FORM_LAST_STEP_INDEX = CLIENT_FORM_STEPPER_STEPS.length - 1;

type ClientFormField = "name" | "phone" | "primaryEmployeeId" | "secondaryEmployeeId";

/** Text inputs that show their validation message in the label-row slot. */
type ClientInputField =
    | "name"
    | "birthday"
    | "dueDate"
    | "birthDate"
    | "phone"
    | "address"
    | "startDate"
    | "endDate";

/** Fields the form can move focus to (server-error targets and inline-validated inputs). */
type ClientFocusField = ClientFormField | ClientInputField;

/** Listed in form order: the first one with a problem receives focus on submit. */
const CLIENT_INPUT_FIELDS: readonly ClientInputField[] = [
    "name",
    "birthday",
    "dueDate",
    "birthDate",
    "phone",
    "address",
    "startDate",
    "endDate",
];

const CLIENT_INPUT_FIELD_CONFIG: Record<ClientInputField, {
    kind: FieldKind;
    required: boolean;
    labelKey: string;
}> = {
    name: { kind: "text", required: true, labelKey: "clients.form.name" },
    birthday: { kind: "date", required: true, labelKey: "clients.form.birthday" },
    dueDate: { kind: "date", required: false, labelKey: "clients.form.due-date" },
    birthDate: { kind: "date", required: false, labelKey: "clients.form.birth-date" },
    phone: { kind: "phone", required: true, labelKey: "clients.form.phone" },
    address: { kind: "text", required: true, labelKey: "clients.form.address" },
    startDate: { kind: "date", required: false, labelKey: "clients.form.start-date" },
    endDate: { kind: "date", required: false, labelKey: "clients.form.end-date" },
};

interface ClientFormErrorState {
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

const isUnstructuredLegacyClientError = (
    error: unknown,
    normalized: ReturnType<typeof normalizeApiError>,
): boolean => {
    if (normalized.verified) return false;
    const status = getErrorResponseStatus(error);
    if (status === undefined || status < 400 || status >= 500) return false;

    const payload = getErrorResponsePayload(error);
    return !isRecord(payload) || (!("type" in payload) && !("requestId" in payload));
};

const CLIENT_FORM_FIELDS: readonly ClientFormField[] = ["name", "phone", "primaryEmployeeId", "secondaryEmployeeId"];

const isClientFormField = (field: string): field is ClientFormField =>
    (CLIENT_FORM_FIELDS as readonly string[]).includes(field);

const fieldForProblemError = (problemError: ProblemError): ClientFormField | undefined => {
    if (problemError.location !== undefined && problemError.location !== "body") return undefined;
    switch (problemError.pointer) {
        case "/name":
            return "name";
        case "/phone":
            return "phone";
        case "/primaryEmployeeId":
        case "/newPrimaryEmployeeId": // replacement request-body spelling; same autocomplete
            return "primaryEmployeeId";
        case "/secondaryEmployeeId":
        case "/newSecondaryEmployeeId":
            return "secondaryEmployeeId";
        default:
            return undefined;
    }
};

/** Panel step that renders each focusable field (basic info, employee assignment, contract dates). */
const PANEL_STEP_OF_FIELD: Record<ClientFocusField, number> = {
    name: 0,
    birthday: 0,
    dueDate: 0,
    birthDate: 0,
    phone: 0,
    address: 0,
    primaryEmployeeId: 1,
    secondaryEmployeeId: 1,
    startDate: 3,
    endDate: 3,
};

const combineAriaDescribedBy = (...ids: Array<string | undefined>): string | undefined => {
    const value = ids.filter((id): id is string => Boolean(id)).join(" ");
    return value || undefined;
};

interface ClientDialogSectionProps {
    dataComponent: string;
    title: ReactNode;
    description: ReactNode;
    children: ReactNode;
}

function ClientDialogSection({ dataComponent, title, description, children }: ClientDialogSectionProps) {
    return (
        <FormSection
            data-component={dataComponent}
            title={title}
            description={description}
            headerDataComponent={`${dataComponent}-head`}
            titleDataComponent={`${dataComponent}-title`}
            descriptionDataComponent={`${dataComponent}-caption`}
            bodyDataComponent={`${dataComponent}-body`}
        >
            {children}
        </FormSection>
    );
}

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

const getPhoneDuplicateCheckFailedMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "문제가 발생했어요. 새로고침 해주세요."
        : "Something went wrong. Please refresh and try again.";

const getPhoneDuplicateCheckPendingMessage = (locale: "ko" | "en"): string =>
    locale === "ko"
        ? "연락처 중복 확인 중입니다. 잠시만 기다려주세요."
        : "Checking for duplicate phone number. Please wait.";

const getPhoneCheckingSlotMessage = (locale: "ko" | "en"): string =>
    t(locale, "form.validation.phone-checking");

const getPhoneAvailableMessage = (locale: "ko" | "en"): string =>
    locale === "ko" ? "등록 가능한 번호입니다." : "This phone number is available.";

// Format ISO date string to yyyy-MM-dd for HTML date input
const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    // Handle ISO format (e.g., "2025-12-26T00:00:00.000Z")
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
};

/**
 * Form state for a date field: the YYYY-MM-DD display string. Accepts stored
 * ISO values and timestamps; anything else is reduced to a partial ISO shape.
 */
const normalizeDateForDisplayState = (value: string | null | undefined): string => {
    if (!value) return "";
    return formatDateForInput(value) || formatIsoDateInput(value);
};

export function ClientFormPanel({
    "data-component": dataComponent,
    open = true,
    onClose,
    onBeforeClose,
    client,
    prefill,
    onSuccess,
    activeStep,
    onActiveStepChange,
    onDirtyChange,
    renderLayout,
}: ClientFormPanelProps) {
    return (
        <ClientFormContent
            surface="panel"
            data-component={dataComponent}
            open={open}
            onClose={onClose}
            onBeforeClose={onBeforeClose}
            client={client}
            prefill={prefill}
            onSuccess={onSuccess}
            activeStep={activeStep}
            onActiveStepChange={onActiveStepChange}
            onDirtyChange={onDirtyChange}
            renderLayout={renderLayout}
        />
    );
}

export function ClientFormDialog({
    "data-component": dataComponent,
    open,
    onClose,
    onBeforeClose,
    client,
    prefill,
    notice,
    onSuccess,
}: ClientFormDialogProps) {
    return (
        <ClientFormContent
            surface="dialog"
            data-component={dataComponent}
            open={open}
            onClose={onClose}
            onBeforeClose={onBeforeClose}
            client={client}
            prefill={prefill}
            notice={notice}
            onSuccess={onSuccess}
        />
    );
}

// 영업일 달력에 미리 받아 둘 연도예요. 시작일·종료일이 속한 해와, 시작일 다음 해(종료일이 해를 넘길 수 있어요)를 포함해요.
function getClientCalendarYears(startDate: string, endDate: string): number[] {
    const years = new Set<number>();
    if (isRealIsoDate(startDate)) {
        const startYear = Number.parseInt(startDate.slice(0, 4), 10);
        years.add(startYear);
        years.add(startYear + 1);
    }
    if (isRealIsoDate(endDate)) years.add(Number.parseInt(endDate.slice(0, 4), 10));
    return [...years];
}

// 시작일과 서비스 기간으로 자동 계산한 종료일이에요. 달력이 지원하지 않는 연도에 닿으면 종료일을 비우고 unsupported로 알려요.
function resolveAutoEndDate(
    duration: number | null | undefined,
    startDate: string,
    calendar: KrBusinessDayCalendar,
): { endDate: string; unsupported: boolean } {
    if (!duration || !isRealIsoDate(startDate)) return { endDate: "", unsupported: false };

    try {
        return {
            endDate: normalizeDateForDisplayState(calendar.calcEndDateBusinessDays(startDate, duration)),
            unsupported: false,
        };
    } catch {
        return { endDate: "", unsupported: true };
    }
}

// 시작일과 서비스 기간으로 종료일을 다시 계산한 폼 값이에요.
function withAutoEndDate(prev: ClientFormData, calendar: KrBusinessDayCalendar): ClientFormData {
    const { endDate } = resolveAutoEndDate(prev.duration, prev.startDate ?? "", calendar);
    return (prev.endDate ?? "") === endDate ? prev : { ...prev, endDate };
}

function ClientFormContent({
    surface,
    "data-component": dataComponent,
    open,
    onClose,
    onBeforeClose,
    client,
    prefill,
    notice,
    onSuccess,
    activeStep: controlledActiveStep,
    onActiveStepChange,
    onDirtyChange,
    renderLayout,
}: ClientFormDialogProps & Pick<ClientFormPanelProps, "activeStep" | "onActiveStepChange" | "onDirtyChange" | "renderLayout"> & { surface: "dialog" | "panel" }) {
    const base =
        dataComponent ?? (surface === "panel" ? "desktop_clients_form-panel" : "desktop_clients_form-dialog");
    const router = useRouter();
    const searchParams = useSearchParams();
    const locale = useLocale();
    const isEditMode = !!client;
    const prefillRef = useRef(prefill);
    const appliedPrefillRef = useRef(prefill);
    useEffect(() => {
        prefillRef.current = prefill;
    }, [prefill]);

    // Read pre-filled name from Zustand store (when opened from ClientAutocomplete)
    const prefillName = useClientDialogStore((state) => state.prefillName);
    const clearPrefillName = useClientDialogStore((state) => state.clearPrefillName);

    const createClient = useCreateClient();
    const updateClient = useUpdateClient();

    // Form state - use extended type to allow null for primaryEmployeeId during form editing
    const [formData, setFormData] = useState<ClientFormData>({
        name: "",
        birthday: "",
        dueDate: "",
        birthDate: "",
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
        applyMessageAutomation: true,
        areaId: null,
    });

    const {
        phoneDigits,
        isCheckingPhoneDuplicate,
        isPhoneDuplicate,
        hasPhoneDuplicateCheckFailed,
        lastCheckedPhoneDigits,
        isUsingOriginalPhone,
        isPhoneCheckReady,
    } = useClientPhoneDuplicateCheck({
        phone: formData.phone,
        originalPhone: client?.phone,
        enabled: open,
    });
    const phoneInlineMessage = phoneDigits.length === 11
        ? isUsingOriginalPhone || isPhoneCheckReady
            ? getPhoneAvailableMessage(locale)
            : isCheckingPhoneDuplicate
                ? getPhoneCheckingSlotMessage(locale)
                : hasPhoneDuplicateCheckFailed
                    ? getPhoneDuplicateCheckFailedMessage(locale)
                    : lastCheckedPhoneDigits !== phoneDigits
                        ? getPhoneCheckingSlotMessage(locale)
                        : isPhoneDuplicate
                            ? t(locale, "clients.form.error-phone-duplicate")
                            : null
        : null;
    const hasPhoneStatusError =
        phoneDigits.length === 11 &&
        !isUsingOriginalPhone &&
        (hasPhoneDuplicateCheckFailed ||
            (lastCheckedPhoneDigits === phoneDigits && isPhoneDuplicate));
    const isPhoneCheckBlockingSubmit = phoneDigits.length === 11 && !isPhoneCheckReady;

    const fields = useFieldInputStates<ClientInputField>();
    const resetFieldStates = fields.reset;
    const [error, setError] = useState<ClientFormErrorState | null>(null);
    // Fields whose server error the user already edited away; set again by each new error.
    const [editedServerErrorFields, setEditedServerErrorFields] = useState<ClientFormField[]>([]);
    const [pendingDurationConfirmation, setPendingDurationConfirmation] = useState<string | null>(null);
    const submissionInFlightRef = useRef(false);
    const summaryRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const phoneInputRef = useRef<HTMLInputElement>(null);
    const birthdayInputRef = useRef<HTMLInputElement>(null);
    const dueDateInputRef = useRef<HTMLInputElement>(null);
    const birthDateInputRef = useRef<HTMLInputElement>(null);
    const addressInputRef = useRef<HTMLInputElement>(null);
    const startDateInputRef = useRef<HTMLInputElement>(null);
    const endDateInputRef = useRef<HTMLInputElement>(null);
    const primaryEmployeeTriggerRef = useRef<HTMLButtonElement>(null);
    const secondaryEmployeeTriggerRef = useRef<HTMLButtonElement>(null);
    const pendingFieldFocusRef = useRef<ClientFocusField | null>(null);
    const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
    const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const formSessionRef = useRef<{ open: boolean; clientId: number | null }>({ open: false, clientId: null });
    const formDataBaselineRef = useRef<ClientFormData>(formData);
    // Turns on the first time staff touch a price field or anything the price table is looked up by,
    // and stays on until the dialog reopens. While it is off, a price-table fill is still the form
    // catching up with its own table on open; once on, the price baseline stays what was stored.
    const priceBaselineFrozenRef = useRef(false);
    // The prices the form filled in from its price table before anything was touched. Not part of the
    // baseline: that keeps the stored prices, so a price filled in after a touch is compared to them.
    const openingTablePricesRef = useRef<Pick<ClientFormData, "fullPrice" | "grant" | "actualPrice"> | null>(null);
    const [initializedEditClientId, setInitializedEditClientId] = useState<number | null>(null);
    const [hasUserEditedSinceOpen, setHasUserEditedSinceOpen] = useState(false);
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

    const fieldFocusTargetRef = useCallback((field: ClientFocusField) => {
        switch (field) {
            case "name":
                return nameInputRef;
            case "phone":
                return phoneInputRef;
            case "birthday":
                return birthdayInputRef;
            case "dueDate":
                return dueDateInputRef;
            case "birthDate":
                return birthDateInputRef;
            case "address":
                return addressInputRef;
            case "startDate":
                return startDateInputRef;
            case "endDate":
                return endDateInputRef;
            case "primaryEmployeeId":
                return primaryEmployeeTriggerRef;
            case "secondaryEmployeeId":
                return secondaryEmployeeTriggerRef;
        }
    }, []);

    const focusField = useCallback((field: ClientFocusField) => {
        const fieldStep = PANEL_STEP_OF_FIELD[field];
        if (surface === "panel" && activeStep !== fieldStep) {
            pendingFieldFocusRef.current = field;
            setActiveStep(fieldStep);
            return;
        }

        fieldFocusTargetRef(field).current?.focus();
    }, [activeStep, fieldFocusTargetRef, setActiveStep, surface]);

    useEffect(() => {
        const field = pendingFieldFocusRef.current;
        if (field === null || (surface === "panel" && activeStep !== PANEL_STEP_OF_FIELD[field])) return;

        pendingFieldFocusRef.current = null;
        fieldFocusTargetRef(field).current?.focus();
    }, [activeStep, fieldFocusTargetRef, surface]);

    // Track if prices were manually edited
    const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);
    const skipNextEndDateRecalculationRef = useRef(false);

    // Voucher year selection - defaults to the year the service belongs to: the
    // form's service end date (initialized from the stored record when editing).
    // Without an end date it defaults to the current year, and either case falls
    // back to the latest server-provided year when the year isn't in the list.
    const { data: voucherYears = [] } = useVoucherYears();
    const {
        data: availableClientAreas = [],
        isLoading: isAvailableClientAreasLoading,
    } = useAvailableClientAreas();
    const [voucherYear, setVoucherYear] = useState<number | null>(null);
    const resolvedVoucherYear = useMemo(() => {
        if (voucherYear !== null) return voucherYear;
        const endDateYear = isRealIsoDate(formData.endDate ?? "")
            ? Number.parseInt((formData.endDate ?? "").slice(0, 4), 10)
            : NaN;
        if (Number.isFinite(endDateYear) && (voucherYears.length === 0 || voucherYears.includes(endDateYear))) {
            return endDateYear;
        }
        const currentYear = new Date().getFullYear();
        if (voucherYears.length === 0 || voucherYears.includes(currentYear)) return currentYear;
        return Math.max(...voucherYears);
    }, [voucherYear, voucherYears, formData.endDate]);

    // Fetch voucher price info based on selected type and year
    const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(formData.type || "", resolvedVoucherYear);
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

    const voucherYearOptions = useMemo(
        () => voucherYears.map((year) => ({
            value: String(year),
            label: `${year}년`,
        })),
        [voucherYears]
    );

    const voucherTypeOptions = useMemo(
        () =>
            Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => ({
                label: groupName,
                options: Object.keys(types).map((typeValue) => ({
                    value: typeValue,
                    label: typeValue,
                })),
            })),
        []
    );

    const durationOptions = useMemo(() => {
        if (!formData.voucherClient) {
            return (outOfPocketPriceInfos ?? []).map((priceInfo) => ({
                value: String(priceInfo.duration),
                label: formatOutOfPocketDurationLabel(priceInfo.duration),
            }));
        }

        return availableDurations.map((duration) => ({
            value: String(duration),
            label: `${duration}일`,
        }));
    }, [availableDurations, formData.voucherClient, outOfPocketPriceInfos]);

    const serviceStatusOptions = useMemo(
        () => SERVICE_STATUS_OPTIONS.map((status) => ({
            value: status.value,
            label: status.label,
        })),
        []
    );

    const areaOptions = useMemo(() => {
        const optionsByAreaId = new Map<string, string>();
        for (const area of availableClientAreas) {
            if (!optionsByAreaId.has(area.id)) {
                optionsByAreaId.set(
                    area.id,
                    area.koreanName.trim() || area.name.trim() || area.id,
                );
            }
        }
        if (formData.areaId && !optionsByAreaId.has(formData.areaId)) {
            optionsByAreaId.set(formData.areaId, formData.areaId);
        }
        return [...optionsByAreaId].map(([value, label]) => ({ value, label }));
    }, [availableClientAreas, formData.areaId]);

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
    const arePriceInputsLocked = formData.voucherClient
        ? !formData.type || !formData.duration || isPriceLoading
        : !formData.duration || isOutOfPocketPriceLoading || isOutOfPocketPriceError;

    // Auto-fill prices when type and duration are selected (only if not manually edited)
    useEffect(() => {
        if (selectedPriceInfo && !pricesManuallyEdited) {
            queueMicrotask(() => {
                setFormData(prev => {
                    const next = prev.voucherClient
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
                        };
                    // Until staff touch a price field or a price driver, this fill is the form catching up
                    // with its own price table, not an edit: the saved client is not being re-priced.
                    // Remember it apart from the baseline, which keeps the STORED prices, so a save before
                    // any touch does not send it, and a save after a touch compares to what was stored.
                    // A driver that merely matches its opening value again does not prove nothing was touched.
                    if (isEditMode && !priceBaselineFrozenRef.current) {
                        openingTablePricesRef.current = {
                            fullPrice: next.fullPrice,
                            grant: next.grant,
                            actualPrice: next.actualPrice,
                        };
                    }
                    return next;
                });
            });
        }
    }, [isEditMode, selectedPriceInfo, pricesManuallyEdited]);

    // 종료일은 고객 정보로 저장되므로 지점 달력을 다 받은 뒤에만 자동 계산해요.
    const {
        calendar: businessDayCalendar,
        ready: isCalendarReady,
        error: calendarError,
        retry: retryCalendar,
        refreshForSave,
    } = useBusinessDayCalendar({
        extraYears: getClientCalendarYears(formData.startDate ?? "", formData.endDate ?? ""),
    });
    // 달력을 기다리는 동안 건너뛴 자동 계산이 있는지. 달력이 준비되면 한 번만 다시 계산해요(달력 객체가 바뀌어도 다시 계산하지 않아요).
    const pendingAutoEndDateRef = useRef(false);
    const autoEndDateOwnedRef = useRef(false);
    const [calendarRefreshFailed, setCalendarRefreshFailed] = useState(false);
    const businessDayCalendarRef = useRef(businessDayCalendar);
    businessDayCalendarRef.current = businessDayCalendar;

    // 자동 계산이 달력이 지원하지 않는 연도에 닿아 종료일을 비웠는지. 안내를 보여 주고 저장을 막아요.
    const [isEndDateUnsupported, setIsEndDateUnsupported] = useState(false);
    const autoEndDateInputsRef = useRef({ duration: formData.duration, startDate: formData.startDate ?? "" });
    autoEndDateInputsRef.current = { duration: formData.duration, startDate: formData.startDate ?? "" };

    const recalculateEndDate = useCallback(() => {
        const calendar = businessDayCalendarRef.current;
        const { duration, startDate } = autoEndDateInputsRef.current;
        autoEndDateOwnedRef.current = Boolean(duration) && isRealIsoDate(startDate);
        queueMicrotask(() => {
            setIsEndDateUnsupported(resolveAutoEndDate(duration, startDate, calendar).unsupported);
            setFormData(prev => withAutoEndDate(prev, calendar));
        });
    }, []);

    useEffect(() => {
        if (skipNextEndDateRecalculationRef.current) {
            autoEndDateOwnedRef.current = false;
            skipNextEndDateRecalculationRef.current = false;
            pendingAutoEndDateRef.current = false;
            return;
        }
        // 기간이나 시작일이 비면 종료일을 비우는 일이라 달력이 필요 없어요.
        const needsCalendar = Boolean(formData.duration) && isRealIsoDate(formData.startDate ?? "");
        pendingAutoEndDateRef.current = needsCalendar && !isCalendarReady;
        if (pendingAutoEndDateRef.current) return;
        recalculateEndDate();
        // 입력(기간·시작일)이 바뀔 때만 다시 계산한다. 달력 준비 여부는 아래 effect가 따로 본다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.duration, formData.startDate]);

    useEffect(() => {
        if (!isCalendarReady || !pendingAutoEndDateRef.current) return;
        pendingAutoEndDateRef.current = false;
        recalculateEndDate();
    }, [isCalendarReady, recalculateEndDate]);

    // Reset duration/prices when the voucher year changes (same semantics as handleTypeChange)
    const handleVoucherYearChange = (newYear: string) => {
        setHasUserEditedSinceOpen(true);
        priceBaselineFrozenRef.current = true;
        const parsedYear = Number(newYear);
        setVoucherYear(Number.isNaN(parsedYear) ? null : parsedYear);
        setFormData(prev => ({
            ...prev,
            duration: null, // Reset duration when year changes
            // Only reset prices if not manually edited
            ...(pricesManuallyEdited ? {} : {
                fullPrice: "",
                grant: "",
                actualPrice: "",
            }),
        }));
    };

    // Reset duration when type changes
    const handleTypeChange = (newType: string) => {
        setHasUserEditedSinceOpen(true);
        priceBaselineFrozenRef.current = true;
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
        setHasUserEditedSinceOpen(true);
        priceBaselineFrozenRef.current = true;
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
        if (open) {
            autoEndDateOwnedRef.current = false;
            setCalendarRefreshFailed(false);
            skipNextEndDateRecalculationRef.current = true;
            let nextFormData: ClientFormData | null = null;
            let nextPricesManuallyEdited = false;

            if (client) {
                nextFormData = {
                    name: client.name,
                    birthday: client.birthday || "",
                    dueDate: formatDateForInput(client.dueDate),
                    birthDate: formatDateForInput(client.birthDate),
                    address: client.address || "",
                    phone: client.phone || "",
                    primaryEmployeeId: client.primaryEmployee?.id ?? null,
                    secondaryEmployeeId: client.secondaryEmployee?.id ?? null,
                    type: client.type || "",
                    duration: client.duration,
                    fullPrice: client.fullPrice || "",
                    grant: client.grant || "",
                    actualPrice: client.actualPrice || "",
                    startDate: normalizeDateForDisplayState(client.startDate),
                    endDate: normalizeDateForDisplayState(client.endDate),
                    careCenter: client.careCenter,
                    voucherClient: client.voucherClient,
                    breastPump: client.breastPump,
                    serviceStatus: client.serviceStatus || "pre_booking",
                    applyMessageAutomation: true,
                    areaId: client.areaId ?? null,
                };
                nextPricesManuallyEdited = Boolean(client.fullPrice || client.grant || client.actualPrice);
            }

            if (!nextFormData) {
                nextFormData = {
                    name: prefillName || "",
                    birthday: "",
                    dueDate: "",
                    birthDate: "",
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
                    serviceStatus: "pre_booking",
                    applyMessageAutomation: true,
                    areaId: null,
                    ...Object.fromEntries(
                        Object.entries(prefillRef.current ?? {}).filter(([, value]) => value !== undefined),
                    ),
                };
                nextPricesManuallyEdited = Boolean(
                    prefillRef.current?.fullPrice || prefillRef.current?.grant || prefillRef.current?.actualPrice,
                );
                clearPrefillName();
            }

            nextFormData = {
                ...nextFormData,
                birthday: normalizeBirthdayIsoDate(nextFormData.birthday) ?? nextFormData.birthday,
                startDate: normalizeDateForDisplayState(nextFormData.startDate),
                endDate: normalizeDateForDisplayState(nextFormData.endDate),
            };
            if (!client && !nextFormData.endDate && nextFormData.startDate && nextFormData.duration) {
                skipNextEndDateRecalculationRef.current = false;
            }
            queueMicrotask(() => {
                formDataBaselineRef.current = nextFormData;
                priceBaselineFrozenRef.current = false;
                openingTablePricesRef.current = null;
                setFormData(nextFormData);
                setIsEndDateUnsupported(false);
                setInitializedEditClientId(client?.id ?? null);
                setHasUserEditedSinceOpen(false);
                setPricesManuallyEdited(nextPricesManuallyEdited);
                setVoucherYear(null); // Reset to default (current year, falling back to latest available)
                setError(null);
                resetFieldStates();
                pendingFieldFocusRef.current = null;
                setPendingDurationConfirmation(null);
            });
        }
    }, [clearPrefillName, client, open, prefillName, resetFieldStates]);

    // The contract candidate request can finish after the dialog has opened.
    // Apply that first late result while the create form is still untouched.
    useEffect(() => {
        const previousPrefill = appliedPrefillRef.current;
        appliedPrefillRef.current = prefill;
        if (
            !open
            || client
            || !prefill
            || prefill === previousPrefill
            || hasUserEditedSinceOpen
        ) {
            return;
        }

        const latePrefill = Object.fromEntries(
            Object.entries(prefill).filter(([, value]) => value !== undefined),
        ) as Partial<ClientFormData>;
        skipNextEndDateRecalculationRef.current = true;
        autoEndDateOwnedRef.current = false;
        queueMicrotask(() => {
            setIsEndDateUnsupported(false);
            setFormData((current) => {
                const nextFormData = {
                    ...current,
                    ...latePrefill,
                    startDate: normalizeDateForDisplayState(latePrefill.startDate ?? current.startDate),
                    endDate: normalizeDateForDisplayState(latePrefill.endDate ?? current.endDate),
                };
                formDataBaselineRef.current = nextFormData;
                return nextFormData;
            });
            if (latePrefill.fullPrice || latePrefill.grant || latePrefill.actualPrice) {
                setPricesManuallyEdited(true);
            }
        });
    }, [client, hasUserEditedSinceOpen, open, prefill]);

    // What the form is compared to when deciding what changed. Until a price field or a price driver is
    // touched, the prices the form filled in from its table on open are not an edit; once touched, prices
    // are compared against what was stored.
    const getEffectiveBaseline = useCallback((): ClientFormData => (
        openingTablePricesRef.current && !priceBaselineFrozenRef.current
            ? { ...formDataBaselineRef.current, ...openingTablePricesRef.current }
            : formDataBaselineRef.current
    ), []);

    useEffect(() => {
        if (surface !== "panel" || !open || !onDirtyChange) return;

        onDirtyChange(JSON.stringify(formData) !== JSON.stringify(getEffectiveBaseline()));
    }, [formData, getEffectiveBaseline, onDirtyChange, open, surface]);

    const isLegacyNoopEdit = Boolean(
        isEditMode
        && client
        && !client.dueDate
        && initializedEditClientId === client.id
        && !hasUserEditedSinceOpen,
    );

    const handleChange = (field: keyof CreateClientDto, value: unknown) => {
        setHasUserEditedSinceOpen(true);
        if (PRICE_BASELINE_FREEZING_FIELDS.has(field)) priceBaselineFrozenRef.current = true;
        setFormData(prev => ({ ...prev, [field]: value }));
        if (isClientFormField(field)) {
            setEditedServerErrorFields((current) => (current.includes(field) ? current : [...current, field]));
        }
    };

    const inputValueOf = (field: ClientInputField): string => String(formData[field] ?? "");

    const handleInputChange = (field: ClientInputField, value: string) => {
        if (field === "endDate") {
            autoEndDateOwnedRef.current = false;
            pendingAutoEndDateRef.current = false;
            setIsEndDateUnsupported(false);
        }
        fields.onChange(field, inputValueOf(field), value);
        handleChange(field, value);
    };

    /**
     * The one message a text input shows in its label-row slot. `settled`
     * evaluates only the input's own rules as if the user already left the
     * field and pressed submit, which is how submit decides whether the field
     * has a problem. Duplicate-check status is not a rule of the input; submit
     * handles it separately.
     */
    const resolveInputFieldMessage = (field: ClientInputField, settled = false): FieldMessageView | null => {
        const { kind, required, labelKey } = CLIENT_INPUT_FIELD_CONFIG[field];
        const value = inputValueOf(field);
        // Whitespace alone does not count as a value for free text.
        const baseState = fields.stateOf(field, kind === "text" ? value.trim() : value);
        const state = settled ? { ...baseState, focused: false } : baseState;
        const opts = {
            required,
            submitted: settled || fields.submitted,
            ...(field === "endDate" ? { dateRange: { notBefore: formData.startDate ?? "" } } : {}),
        };
        const label = t(locale, labelKey);

        const formatMessage = toFieldMessageView(
            locale,
            field === "phone" ? resolveElevenDigitPhoneMessage(state, opts) : resolveFieldMessage(kind, state, opts),
            label,
        );
        if (formatMessage) return formatMessage;

        if (field === "birthday" && value.length === 10 && !isValidBirthdayIsoDate(value)) {
            return { tone: "error", text: t(locale, "form.validation.birthday-future") };
        }
        if (!settled && field === "phone" && phoneInlineMessage) {
            return {
                tone: hasPhoneStatusError ? "error" : isPhoneCheckReady ? "ok" : "hint",
                text: phoneInlineMessage,
            };
        }
        return null;
    };

    // Server errors that map to a field show in that field's label-row slot
    // until the user edits the field; only unmapped ones go to the summary.
    const formErrorEntries = (error?.fieldErrors ?? []).map((fieldError, index) => ({
        fieldError,
        field: fieldForProblemError(fieldError),
        id: `${base}_error_${index}`,
    }));
    const serverFieldMessages: Partial<Record<ClientFormField, FieldMessageView>> = {};
    for (const { fieldError, field } of formErrorEntries) {
        if (field && !editedServerErrorFields.includes(field) && !serverFieldMessages[field]) {
            serverFieldMessages[field] = { tone: "error", text: fieldError.detail };
        }
    }
    const serverEmployeeMessages = {
        primary: serverFieldMessages.primaryEmployeeId,
        secondary: serverFieldMessages.secondaryEmployeeId,
    };
    const summaryErrorEntries = formErrorEntries.filter(({ field }) => field === undefined);

    const inputFieldMessages = Object.fromEntries(
        CLIENT_INPUT_FIELDS.map((field) => [
            field,
            (isClientFormField(field) ? serverFieldMessages[field] : undefined) ?? resolveInputFieldMessage(field),
        ]),
    ) as Record<ClientInputField, FieldMessageView | null>;

    const getFirstProblemField = (candidates: readonly ClientInputField[]): ClientInputField | undefined =>
        candidates.find((field) => resolveInputFieldMessage(field, true)?.tone === "error");

    const fieldMessageId = (field: ClientInputField) => `clients-form-${surface}-${field}-helper`;

    /** The label-row slot content for a field, or null while it has nothing to say. */
    const renderFieldMessage = (field: ClientInputField, dataComponent: string) => {
        const message = inputFieldMessages[field];
        return message ? (
            <FieldMessageText
                id={fieldMessageId(field)}
                data-component={dataComponent}
                tone={message.tone}
            >
                {message.text}
            </FieldMessageText>
        ) : null;
    };

    /** The label-row slot content for a select, which has no input rules of its own. */
    const renderSlotMessage = (message: FieldMessageView | null, id: string, dataComponent: string) =>
        message ? (
            <FieldMessageText id={id} data-component={dataComponent} tone={message.tone}>
                {message.text}
            </FieldMessageText>
        ) : null;

    const areaFieldMessage = withGuidance(null, AREA_FIELD_GUIDANCE);
    const areaMessageId = `clients-form-${surface}-area-helper`;
    const durationFieldMessage: FieldMessageView | null = !formData.voucherClient && isOutOfPocketPriceError
        ? { tone: "error", text: OUT_OF_POCKET_PRICE_ERROR }
        : null;
    const durationMessageId = `clients-form-${surface}-duration-helper`;

    /** Error state, a11y wiring and focus tracking shared by every inline-validated input. */
    const getInputFieldProps = (field: ClientInputField) => {
        const message = inputFieldMessages[field];
        return {
            error: message?.tone === "error",
            "aria-describedby": combineAriaDescribedBy(message ? fieldMessageId(field) : undefined),
            ...fields.focusProps(field, inputValueOf(field)),
        };
    };

    const openEmployeeDialog = (target: "primary" | "secondary") => {
        setEmployeeDialogTarget(target);
        setIsEmployeeDialogOpen(true);
    };

    const handleEmployeeDialogClose = () => {
        setIsEmployeeDialogOpen(false);
        setEmployeeDialogTarget(null);
    };

    const handleEmployeeCreated = (newEmployee: Employee) => {
        setHasUserEditedSinceOpen(true);
        setFormData(prev => {
            if (employeeDialogTarget === "primary") {
                return { ...prev, primaryEmployeeId: newEmployee.id };
            }
            if (employeeDialogTarget === "secondary") {
                return { ...prev, secondaryEmployeeId: newEmployee.id };
            }
            return prev;
        });
    };

    // Handle manual price changes
    const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
        setPricesManuallyEdited(true);
        handleChange(field, value);
    };

    const scrollToTop = () => {
        // Scroll the DialogContent (parent of our content div) to top
        const scrollContainer = contentRef.current?.parentElement;
        if (scrollContainer && typeof scrollContainer.scrollTo === "function") {
            scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    const clearFormError = () => {
        setError((current) => current?.outcome === "UNKNOWN" ? current : null);
    };

    const setErrorAndScroll = (errorMessage: string) => {
        setError({
            message: getUserErrorMessage(errorMessage),
            fieldErrors: [],
        });
        // Use setTimeout to ensure the Alert is rendered before scrolling
        setTimeout(scrollToTop, 0);
    };

    const setMutationError = (cause: unknown, options: { endDateGuardSent?: boolean } = {}) => {
        const normalized = normalizeApiError(cause, {
            locale: locale === "en" ? "en-US" : "ko-KR",
            operation: "mutation",
        });

        // The save carried the end date this form was opened with and the backend found it moved.
        if (
            options.endDateGuardSent
            && normalized.status === 409
            && normalized.problem?.code === "SERVICE_RECORD_WRITE_TARGET_CHANGED"
        ) {
            setError({
                message: CLIENT_END_DATE_CHANGED_MESSAGE,
                fieldErrors: [],
                requestId: normalized.problem.requestId,
                outcome: normalized.outcome,
            });
            return;
        }

        if (isUnstructuredLegacyClientError(cause, normalized)) {
            setError({
                message: getErrorMessage(cause, locale, "clients.form.error-save-failed"),
                fieldErrors: [],
            });
            return;
        }

        const fieldErrors = normalized.problem?.errors ?? [];
        const mappedFields = fieldErrors
            .map((fieldError) => fieldForProblemError(fieldError))
            .filter((field): field is ClientFormField => field !== undefined);
        if (surface === "panel" && mappedFields.length > 0) {
            // Land on the earliest step that renders a field-linked error so
            // the user can fix fields in order (basic info before assignment).
            setActiveStep(Math.min(...mappedFields.map((field) => PANEL_STEP_OF_FIELD[field])));
        }
        setEditedServerErrorFields([]);
        setError({
            message: normalized.message,
            fieldErrors,
            requestId: normalized.problem?.requestId,
            outcome: normalized.outcome,
        });
    };

    useEffect(() => {
        if (!error) return;

        const timer = setTimeout(() => {
            summaryRef.current?.focus({ preventScroll: true });
            scrollToTop();
        }, 0);
        return () => clearTimeout(timer);
    }, [error]);

    const handleStepChange = (nextStep: number) => {
        clearFormError();
        setActiveStep(nextStep);
        setTimeout(scrollToTop, 0);
    };

    // 서비스 기간 검증은 지점 달력으로 하므로 달력이 준비되기 전에는 저장하지 않아요. (빈 갱신만 보내는 옛 고객 수정은 달력을 쓰지 않아요.)
    // 종료일을 계산하지 못한 채(지원하지 않는 연도)로도 저장하지 않아요. 직접 입력하거나 기간을 바꾸면 풀려요.
    const isCalendarBlockingSubmit = (!isCalendarReady || isEndDateUnsupported) && !isLegacyNoopEdit;

    const handleSubmit = async (confirmedPeriod?: string) => {
        if (submissionInFlightRef.current || error?.outcome === "UNKNOWN" || isCalendarBlockingSubmit) return;
        clearFormError();

        if (isLegacyNoopEdit && client) {
            submissionInFlightRef.current = true;
            try {
                // Some legacy customers predate the current required form fields. An empty
                // update preserves that record exactly while still invoking the backend's
                // phone-based document relink. Automatic form hydration is not considered an
                // edit; any user interaction exits this narrow compatibility path.
                const updatedClient = await updateClient.mutateAsync({ id: client.id, dto: {} });
                onSuccess?.(updatedClient);
                onDirtyChange?.(false);
                onClose();
            } catch (error: unknown) {
                setMutationError(error);
            } finally {
                submissionInFlightRef.current = false;
            }
            return;
        }

        // 고객 기본 정보만 필수이며 서비스 정보는 상담 단계에서 비워둘 수 있다.
        // 필드 문제는 해당 필드의 라벨 행 메시지로 보여 주고 첫 문제 필드로 이동한다.
        fields.setSubmitted(true);
        const firstProblemField = getFirstProblemField(CLIENT_INPUT_FIELDS);
        if (firstProblemField) {
            focusField(firstProblemField);
            return;
        }
        if (!isUsingOriginalPhone) {
            if (isCheckingPhoneDuplicate) {
                setErrorAndScroll(getPhoneDuplicateCheckPendingMessage(locale));
                return;
            }
            if (hasPhoneDuplicateCheckFailed) {
                setErrorAndScroll(getPhoneDuplicateCheckFailedMessage(locale));
                return;
            }
            if (lastCheckedPhoneDigits !== phoneDigits) {
                setErrorAndScroll(getPhoneDuplicateCheckPendingMessage(locale));
                return;
            }
            if (isPhoneDuplicate) {
                focusField("phone");
                return;
            }
        }
        let endDateGuardSent = false;
        try {
            submissionInFlightRef.current = true;
            const fresh = await refreshForSave();
            setCalendarRefreshFailed(!fresh.ok);
            if (!fresh.ok) return;
            let recalculated = false;
            if (autoEndDateOwnedRef.current || pendingAutoEndDateRef.current) {
                const next = resolveAutoEndDate(formData.duration, formData.startDate ?? "", fresh.calendar);
                setIsEndDateUnsupported(next.unsupported);
                recalculated = next.endDate !== (formData.endDate ?? "");
                if (recalculated) setFormData(previous => ({ ...previous, endDate: next.endDate }));
                if (next.unsupported) return;
            }
            if (fresh.changed || recalculated) {
                setPendingDurationConfirmation(null);
                setErrorAndScroll(t(locale, "common.calendar-changed-before-save"));
                return;
            }
            const normalizedDueDate = formData.dueDate ?? "";
            const normalizedBirthDate = formData.birthDate ?? "";
            const normalizedStartDate = formData.startDate ?? "";
            const normalizedEndDate = formData.endDate ?? "";
            const businessDays = normalizedStartDate && normalizedEndDate
                ? fresh.calendar.countBusinessDays(normalizedStartDate, normalizedEndDate)
                : null;
            // An edit that leaves the service period alone sends no period field, so a period whose
            // length differs from its business days (a delayed client) needs no confirmation to save,
            // say, an address.
            const writesServicePeriod = !(isEditMode && client)
                || hasServicePeriodChange(formDataBaselineRef.current, formData);
            const hasDurationMismatch = writesServicePeriod
                && businessDays !== null
                && Number.isSafeInteger(formData.duration)
                && (formData.duration ?? 0) > 0
                && formData.duration !== businessDays;
            // Bind confirmation to these exact values. A changed period or a new
            // save must be confirmed again; prefill never carries consent.
            const periodKey = JSON.stringify([normalizedStartDate, normalizedEndDate, formData.duration]);
            if (hasDurationMismatch && confirmedPeriod !== periodKey) {
                setPendingDurationConfirmation(periodKey);
                return;
            }
            const durationConfirmation = hasDurationMismatch && confirmedPeriod === periodKey
                ? { allowBusinessDayMismatch: true }
                : {};
            setPendingDurationConfirmation(null);

            if (isEditMode && client) {
                // Send only what the user changed since the form was opened. The backend moves the
                // end date by itself (a delayed session extends it), so a full snapshot would roll
                // that back. A save that touches the service period carries the end date this form
                // was opened with, and the backend refuses it if the end date moved since.
                const updateDto = buildClientUpdatePayload({
                    baseline: getEffectiveBaseline(),
                    current: formData,
                    allowBusinessDayMismatch: hasDurationMismatch && confirmedPeriod === periodKey,
                });
                endDateGuardSent = updateDto.expectedEndDate !== undefined;
                const updatedClient = await updateClient.mutateAsync({ id: client.id, dto: updateDto });
                onSuccess?.(updatedClient);
            } else {
                const createDto: CreateClientDto = {
                    name: formData.name,
                    birthday: formData.birthday || null,
                    dueDate: normalizedDueDate || null,
                    birthDate: normalizedBirthDate || null,
                    address: formData.address || null,
                    phone: formData.phone || null,
                    primaryEmployeeId: formData.primaryEmployeeId,
                    secondaryEmployeeId: formData.secondaryEmployeeId,
                    type: formData.voucherClient ? formData.type || null : null,
                    duration: formData.duration || null,
                    ...durationConfirmation,
                    fullPrice: formData.fullPrice || null,
                    grant: formData.voucherClient ? formData.grant || null : "0",
                    actualPrice: formData.voucherClient ? formData.actualPrice || null : formData.fullPrice || null,
                    startDate: normalizedStartDate || null,
                    endDate: normalizedEndDate || null,
                    careCenter: formData.careCenter,
                    voucherClient: formData.voucherClient,
                    breastPump: formData.breastPump,
                    serviceStatus: formData.serviceStatus,
                    applyMessageAutomation: formData.applyMessageAutomation,
                    areaId: formData.areaId || null,
                };
                const newClient = await createClient.mutateAsync(createDto);
                onSuccess?.(newClient);
            }
            onClose();
            onDirtyChange?.(false);
        } catch (error: unknown) {
            setMutationError(error, { endDateGuardSent });
        } finally {
            submissionInFlightRef.current = false;
        }
    };

    const isSubmitting = createClient.isPending || updateClient.isPending;

    const requiredFieldProgressText = `필수 항목 4개 중 ${
        [
            Boolean(formData.name.trim()),
            isValidBirthdayIsoDate(formData.birthday ?? ""),
            Boolean(formData.address?.trim()),
            Boolean(formData.phone?.trim()),
        ].filter(Boolean).length
    }개 입력됨`;
    const isUnknownOutcome = error?.outcome === "UNKNOWN";
    // A field problem never disables the panel buttons: pressing one reveals the
    // message on every problem field. Only work in flight, an unknown outcome, a
    // stale edit form or a phone check that has not finished block them.
    const isAwaitingEditInit = Boolean(isEditMode && client && initializedEditClientId !== client.id);
    const isPanelActionBlocked = isSubmitting
        || isUnknownOutcome
        || isAwaitingEditInit
        || (!isLegacyNoopEdit && isPhoneCheckBlockingSubmit);
    // 달력은 마지막 단계의 저장 버튼만 막아요. 다음 단계로 가는 것은 달력과 무관해요.
    const isPanelSubmitBlocked = isPanelActionBlocked || isCalendarBlockingSubmit;
    const calendarLoadNotice = isCalendarReady && !isEndDateUnsupported && !calendarRefreshFailed ? null : (
        <CalendarLoadNotice
            error={calendarError ?? (calendarRefreshFailed ? "load-failed" : isEndDateUnsupported ? "unsupported-year" : null)}
            onRetry={() => { setCalendarRefreshFailed(false); retryCalendar(); }}
            loading={!isCalendarReady && !calendarError}
            dataComponent={`${base}_calendar-load-notice`}
        />
    );

    const handleNextStep = () => {
        if (!isLegacyNoopEdit) {
            const stepFields = CLIENT_INPUT_FIELDS.filter((field) => PANEL_STEP_OF_FIELD[field] === activeStep);
            const firstProblemField = getFirstProblemField(stepFields);
            if (firstProblemField) {
                fields.setSubmitted(true);
                focusField(firstProblemField);
                return;
            }
        }
        handleStepChange(activeStep + 1);
    };

    const handleDialogClose = () => {
        if (onBeforeClose && !onBeforeClose()) {
            return;
        }

        setPendingDurationConfirmation(null);
        if (searchParams.get("openClientForm") === "1") {
            router.replace("/clients");
        }

        onDirtyChange?.(false);
        onClose();
    };

    const formTitle = isEditMode
        ? t(locale, "clients.form.edit-title")
        : t(locale, "clients.form.add-title");
    const dialogFormActions = (
        <div className="ml-auto flex w-full flex-col-reverse gap-2 sm:w-[300px] sm:flex-row sm:justify-end">
            <Button
                variant="neutral"
                size="sm"
                onClick={handleDialogClose}
                disabled={isSubmitting}
                data-component={`${base}_cancel`}
                className="w-full sm:flex-1"
            >
                {t(locale, "common.cancel")}
            </Button>
            <Button
                variant="positive"
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={isSubmitting || isUnknownOutcome || isCalendarBlockingSubmit || (!isLegacyNoopEdit && isPhoneCheckBlockingSubmit)}
                data-component={`${base}_submit`}
                className="w-full sm:flex-1"
            >
                {isSubmitting ? (
                    <Spinner className="h-4 w-4" />
                ) : isEditMode ? (
                    t(locale, "common.save")
                ) : (
                    t(locale, "common.create")
                )}
            </Button>
        </div>
    );
    const panelFormActions = (
        <div className="flex w-full flex-wrap items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))]">
            <span className={DETAIL_PANEL_FOOTER_PROGRESS_CLASS_NAME}>{requiredFieldProgressText}</span>
            <div className={DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME}>
                {activeStep === 0 && (
                    <Button
                        variant="neutral"
                        size="sm"
                        onClick={handleDialogClose}
                        disabled={isSubmitting}
                        className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                    >
                        {t(locale, "common.cancel")}
                    </Button>
                )}
                {activeStep > 0 && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleStepChange(activeStep - 1)}
                        disabled={isSubmitting}
                        data-component={`${base}_prev`}
                        className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                    >
                        이전
                    </Button>
                )}
                {activeStep < CLIENT_FORM_LAST_STEP_INDEX ? (
                    <Button
                        type="button"
                        size="sm"
                        onClick={handleNextStep}
                        disabled={isPanelActionBlocked}
                        data-component={`${base}_next`}
                        className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
                    >
                        다음
                    </Button>
                ) : (
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleSubmit()}
                        disabled={isPanelSubmitBlocked}
                        data-component={`${base}_submit`}
                        className="min-w-[calc(132px*var(--glint-ui-scale,1))]"
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
            </div>
        </div>
    );

    const basicInfoSection = (
        <ClientDialogSection
            dataComponent={`${base}_section-basic`}
            title={t(locale, "clients.form.section-basic")}
            description="고객의 프로필과 연락처를 먼저 입력해 주세요."
        >
            <FormGrid data-component={`${base}_basic-grid`}>
                <FormField
                    data-component={`${base}_basic-grid_field-name`}
                    htmlFor="name"
                    label={t(locale, "clients.form.name")}
                    required
                    labelAccessory={renderFieldMessage("name", `${base}_basic-grid_field-name_helper`)}
                >
                    <FormTextInput
                        ref={nameInputRef}
                        id="name"
                        placeholder="홍길동"
                        value={formData.name}
                        onChange={(e) => handleInputChange("name", e.target.value)}
                        {...getInputFieldProps("name")}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-birthday`}
                    htmlFor="birthday"
                    label={t(locale, "clients.form.birthday")}
                    required
                    labelAccessory={renderFieldMessage("birthday", `${base}_basic-grid_field-birthday_helper`)}
                >
                    <FormTextInput
                        ref={birthdayInputRef}
                        id="birthday"
                        placeholder="1958-03-03"
                        inputMode="numeric"
                        value={formData.birthday ?? ""}
                        onChange={(e) => handleInputChange("birthday", formatIsoDateInput(e.target.value))}
                        maxLength={10}
                        {...getInputFieldProps("birthday")}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-due-date`}
                    htmlFor="dueDate"
                    label={t(locale, "clients.form.due-date")}
                    labelAccessory={renderFieldMessage("dueDate", `${base}_basic-grid_field-due-date_helper`)}
                >
                    <FormTextInput
                        ref={dueDateInputRef}
                        id="dueDate"
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="2026-11-20"
                        value={formData.dueDate || ""}
                        onChange={(e) => handleInputChange("dueDate", formatIsoDateInput(e.target.value))}
                        {...getInputFieldProps("dueDate")}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-birth-date`}
                    htmlFor="birthDate"
                    label={t(locale, "clients.form.birth-date")}
                    labelAccessory={renderFieldMessage("birthDate", `${base}_basic-grid_field-birth-date_helper`)}
                >
                    <FormTextInput
                        ref={birthDateInputRef}
                        id="birthDate"
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="2026-11-20"
                        value={formData.birthDate || ""}
                        onChange={(e) => handleInputChange("birthDate", formatIsoDateInput(e.target.value))}
                        {...getInputFieldProps("birthDate")}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-phone`}
                    htmlFor="phone"
                    label={t(locale, "clients.form.phone")}
                    required
                    labelAccessory={renderFieldMessage("phone", `${base}_basic-grid_field-phone_helper`)}
                >
                    <FormTextInput
                        ref={phoneInputRef}
                        id="phone"
                        type="tel"
                        inputMode="numeric"
                        placeholder="010-1234-5678"
                        value={formData.phone ?? ""}
                        onChange={(e) => {
                            handleInputChange("phone", formatKoreanPhoneNumber(e.target.value));
                            clearFormError();
                        }}
                        maxLength={20}
                        {...getInputFieldProps("phone")}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-area`}
                    htmlFor="clients-form-area"
                    label="관할 지역"
                    labelAccessory={renderSlotMessage(areaFieldMessage, areaMessageId, `${base}_basic-grid_field-area_helper`)}
                >
                    <FormNativeSelect
                        id="clients-form-area"
                        aria-describedby={areaMessageId}
                        value={formData.areaId ?? ""}
                        options={areaOptions}
                        placeholder={isAvailableClientAreasLoading ? "지역을 불러오는 중" : "관할 지역 선택"}
                        onValueChange={(value) => handleChange("areaId", value || null)}
                        disabled={isAvailableClientAreasLoading}
                        wrapDataComponent={`${base}_basic-grid_field-area_select-wrap`}
                        selectDataComponent={`${base}_basic-grid_field-area_select`}
                        iconDataComponent={`${base}_basic-grid_field-area_select-icon`}
                    />
                </FormField>

                <FormField
                    data-component={`${base}_basic-grid_field-address`}
                    htmlFor="address"
                    label={t(locale, "clients.form.address")}
                    required
                    className="sm:col-span-2"
                    labelAccessory={renderFieldMessage("address", `${base}_basic-grid_field-address_helper`)}
                >
                    <FormTextInput
                        ref={addressInputRef}
                        id="address"
                        placeholder="인천광역시 서구"
                        value={formData.address ?? ""}
                        onChange={(e) => handleInputChange("address", e.target.value)}
                        {...getInputFieldProps("address")}
                    />
                </FormField>
            </FormGrid>
        </ClientDialogSection>
    );

    const employeeSection = (
        <ClientDialogSection
            dataComponent={`${base}_section-employee`}
            title={t(locale, "clients.form.section-employee")}
            description="서비스를 담당할 제공인력을 배정해 주세요."
        >
            <FormGrid data-component={`${base}_employee-grid`}>
                <EmployeeAutocomplete
                    data-component={`${base}_employee-grid_primary-employee-autocomplete`}
                    refreshOnMount
                    value={formData.primaryEmployeeId}
                    onChange={(id) => handleChange("primaryEmployeeId", id)}
                    label={t(locale, "clients.form.primary-employee")}
                    excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                    allowManualEntry
                    onManualEntry={() => {
                        openEmployeeDialog("primary");
                    }}
                    error={serverEmployeeMessages.primary !== undefined}
                    helperText={serverEmployeeMessages.primary?.text}
                    triggerButtonRef={primaryEmployeeTriggerRef}
                />
                <EmployeeAutocomplete
                    data-component={`${base}_employee-grid_secondary-employee-autocomplete`}
                    refreshOnMount
                    value={formData.secondaryEmployeeId ?? null}
                    onChange={(id) => handleChange("secondaryEmployeeId", id)}
                    label={t(locale, "clients.form.secondary-employee")}
                    excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                    allowManualEntry
                    onManualEntry={() => {
                        openEmployeeDialog("secondary");
                    }}
                    error={serverEmployeeMessages.secondary !== undefined}
                    helperText={serverEmployeeMessages.secondary?.text}
                    triggerButtonRef={secondaryEmployeeTriggerRef}
                />
            </FormGrid>
        </ClientDialogSection>
    );

    const voucherInfoSections = (
        <>
            <ClientDialogSection
                dataComponent={`${base}_section-service`}
                title={t(locale, "clients.form.section-service")}
                description="선택 항목입니다. 상담 단계에서는 입력하지 않아도 됩니다."
            >
                <TogglePill
                    data-component={`${base}_field-voucher-client`}
                    value={formData.voucherClient}
                    onValueChange={handleVoucherClientChange}
                    leftLabel={t(locale, "clients.form.voucher-client")}
                    rightLabel={t(locale, "clients.form.self-pay-client")}
                    ariaLabel={t(locale, "clients.form.customer-type")}
                />

                <FormGrid data-component={`${base}_service-grid`}>
                    {formData.voucherClient && (
                        <>
                            <FormField
                                data-component={`${base}_service-grid_field-voucher-year`}
                                htmlFor="clients-form-voucher-year"
                                label={t(locale, "clients.form.voucher-year")}
                            >
                                <FormNativeSelect
                                    id="clients-form-voucher-year"
                                    value={resolvedVoucherYear.toString()}
                                    options={voucherYearOptions}
                                    placeholder={t(locale, "clients.form.voucher-year")}
                                    onValueChange={handleVoucherYearChange}
                                    wrapDataComponent={`${base}_service-grid_field-voucher-year_select-wrap`}
                                    selectDataComponent={`${base}_service-grid_field-voucher-year_select`}
                                    iconDataComponent={`${base}_service-grid_field-voucher-year_select-icon`}
                                />
                            </FormField>

                            <FormField
                                data-component={`${base}_service-grid_field-voucher-type`}
                                htmlFor="clients-form-voucher-type"
                                label={t(locale, "clients.form.voucher-type")}
                            >
                                <FormNativeSelect
                                    id="clients-form-voucher-type"
                                    value={formData.type || ""}
                                    options={voucherTypeOptions}
                                    placeholder={t(locale, "clients.form.voucher-type")}
                                    onValueChange={handleTypeChange}
                                    wrapDataComponent={`${base}_service-grid_field-voucher-type_select-wrap`}
                                    selectDataComponent={`${base}_service-grid_field-voucher-type_select`}
                                    iconDataComponent={`${base}_service-grid_field-voucher-type_select-icon`}
                                />
                            </FormField>
                        </>
                    )}

                    <FormField
                        data-component={`${base}_service-grid_field-duration`}
                        htmlFor="clients-form-duration"
                        label={t(locale, "clients.form.duration")}
                        labelAccessory={renderSlotMessage(durationFieldMessage, durationMessageId, `${base}_service-grid_field-duration_helper`)}
                    >
                        <div className="relative">
                            <FormNativeSelect
                                id="clients-form-duration"
                                aria-describedby={durationFieldMessage ? durationMessageId : undefined}
                                aria-invalid={durationFieldMessage ? true : undefined}
                                value={formData.duration?.toString() || ""}
                                options={durationOptions}
                                placeholder={t(locale, "clients.form.duration")}
                                onValueChange={(value) => {
                                    handleChange("duration", value ? Number(value) : null);
                                    setPricesManuallyEdited(false);
                                }}
                                disabled={formData.voucherClient
                                    ? !formData.type || isPriceLoading
                                    : isOutOfPocketPriceLoading || isOutOfPocketPriceError}
                                wrapDataComponent={`${base}_service-grid_field-duration_select-wrap`}
                                selectDataComponent={`${base}_service-grid_field-duration_select`}
                                iconDataComponent={`${base}_service-grid_field-duration_select-icon`}
                            />
                            {(formData.voucherClient ? isPriceLoading : isOutOfPocketPriceLoading) && (
                                <div className="absolute right-10 top-1/2 -translate-y-1/2">
                                    <Spinner className="h-4 w-4" />
                                </div>
                            )}
                        </div>
                    </FormField>
                </FormGrid>
            </ClientDialogSection>

            <ClientDialogSection
                dataComponent={`${base}_section-pricing`}
                title={t(locale, "clients.form.section-pricing")}
                description={formData.voucherClient
                    ? "서비스 금액과 지원 금액을 확인하고 조정해 주세요."
                    : "기간별 총 서비스 금액을 확인하고 조정해 주세요."}
            >
                <FormGrid
                    data-component={`${base}_pricing-grid`}
                    className={formData.voucherClient ? "lg:grid-cols-3" : undefined}
                >
                    <FormField
                        data-component={`${base}_pricing-grid_field-full-price`}
                        htmlFor="fullPrice"
                        label={t(locale, "clients.form.full-price")}
                    >
                        <FormTextInputWithSuffix
                            data-component={`${base}_pricing-grid_field-full-price_amount`}
                            id="fullPrice"
                            value={arePriceInputsLocked ? "" : formatPrice(formData.fullPrice || "")}
                            onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                            disabled={arePriceInputsLocked}
                            suffix="원"
                        />
                    </FormField>

                    {formData.voucherClient && <FormField
                        data-component={`${base}_pricing-grid_field-grant`}
                        htmlFor="grant"
                        label={t(locale, "clients.form.grant")}
                    >
                        <FormTextInputWithSuffix
                            data-component={`${base}_pricing-grid_field-grant_amount`}
                            id="grant"
                            value={arePriceInputsLocked ? "" : formatPrice(formData.grant || "")}
                            onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                            disabled={arePriceInputsLocked}
                            suffix="원"
                        />
                    </FormField>}

                    {formData.voucherClient && <FormField
                        data-component={`${base}_pricing-grid_field-actual-price`}
                        htmlFor="actualPrice"
                        label={t(locale, "clients.form.actual-price")}
                    >
                        <FormTextInputWithSuffix
                            data-component={`${base}_pricing-grid_field-actual-price_amount`}
                            id="actualPrice"
                            value={arePriceInputsLocked ? "" : formatPrice(formData.actualPrice || "")}
                            onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                            disabled={arePriceInputsLocked}
                            suffix="원"
                        />
                    </FormField>}
                </FormGrid>
            </ClientDialogSection>
        </>
    );

    const contractInfoSections = (
        <>
            <ClientDialogSection
                dataComponent={`${base}_section-contract`}
                title={t(locale, "clients.form.section-contract")}
                description="선택 항목입니다. 예약이 확정되면 서비스 일정을 입력해 주세요."
            >
                <FormGrid data-component={`${base}_contract-grid`} className="lg:grid-cols-3">
                    <FormField
                        data-component={`${base}_contract-grid_field-contract-status`}
                        htmlFor="clients-form-contract-status"
                        label={t(locale, "clients.form.contract-status")}
                    >
                        <FormNativeSelect
                            id="clients-form-contract-status"
                            value={formData.serviceStatus || ""}
                            options={serviceStatusOptions}
                            placeholder={t(locale, "clients.form.contract-status")}
                            onValueChange={(value) => handleChange("serviceStatus", value)}
                            wrapDataComponent={`${base}_contract-grid_field-contract-status_select-wrap`}
                            selectDataComponent={`${base}_contract-grid_field-contract-status_select`}
                            iconDataComponent={`${base}_contract-grid_field-contract-status_select-icon`}
                        />
                    </FormField>

                    <FormField
                        data-component={`${base}_contract-grid_field-start-date`}
                        htmlFor="startDate"
                        label={t(locale, "clients.form.start-date")}
                        labelAccessory={renderFieldMessage("startDate", `${base}_contract-grid_field-start-date_helper`)}
                    >
                        <FormTextInput
                            ref={startDateInputRef}
                            id="startDate"
                            type="text"
                            inputMode="numeric"
                            maxLength={10}
                            placeholder="2026-12-01"
                            value={formData.startDate || ""}
                            onChange={(e) => handleInputChange("startDate", formatIsoDateInput(e.target.value))}
                            {...getInputFieldProps("startDate")}
                        />
                    </FormField>

                    <FormField
                        data-component={`${base}_contract-grid_field-end-date`}
                        htmlFor="endDate"
                        label={t(locale, "clients.form.end-date")}
                        labelAccessory={renderFieldMessage("endDate", `${base}_contract-grid_field-end-date_helper`)}
                    >
                        <FormTextInput
                            ref={endDateInputRef}
                            id="endDate"
                            type="text"
                            inputMode="numeric"
                            maxLength={10}
                            placeholder="2026-12-19"
                            value={formData.endDate || ""}
                            onChange={(e) => handleInputChange("endDate", formatIsoDateInput(e.target.value))}
                            {...getInputFieldProps("endDate")}
                        />
                    </FormField>
                    {calendarLoadNotice ? <div className="lg:col-span-3">{calendarLoadNotice}</div> : null}
                </FormGrid>
            </ClientDialogSection>

            <ClientDialogSection
                dataComponent={`${base}_section-flags`}
                title={t(locale, "clients.form.section-flags")}
                description="추가 서비스 옵션을 설정해 주세요."
            >
                <div className={cn(
                    "grid gap-[calc(12px*var(--glint-ui-scale,1))]",
                    isEditMode ? "lg:grid-cols-2" : "lg:grid-cols-3",
                )}>
                    <FormSwitchRow
                        data-component={`${base}_field-care-center`}
                        title={t(locale, "clients.form.care-center")}
                        checked={formData.careCenter === true}
                        onToggle={() => handleChange("careCenter", !formData.careCenter)}
                        buttonAriaLabel={t(locale, "clients.form.care-center")}
                    />
                    <FormSwitchRow
                        data-component={`${base}_field-breast-pump`}
                        title={t(locale, "clients.form.breast-pump")}
                        checked={formData.breastPump}
                        onToggle={() => handleChange("breastPump", !formData.breastPump)}
                        buttonAriaLabel={t(locale, "clients.form.breast-pump")}
                    />
                    {!isEditMode ? (
                        <FormSwitchRow
                            data-component={`${base}_field-message-automation`}
                            title={t(locale, "clients.form.message-automation")}
                            checked={formData.applyMessageAutomation !== false}
                            onToggle={() => handleChange("applyMessageAutomation", formData.applyMessageAutomation === false)}
                            buttonAriaLabel={t(locale, "clients.form.message-automation")}
                        />
                    ) : null}
                </div>
            </ClientDialogSection>
        </>
    );

    const panelBasicInfoStep = (
        <>
            <FormField
                data-component={`${base}_name-input`}
                htmlFor="name"
                label={t(locale, "clients.form.name")}
                required
                labelAccessory={renderFieldMessage("name", `${base}_name-input_helper`)}
            >
                <FormTextInput
                    ref={nameInputRef}
                    id="name"
                    placeholder="홍길동"
                    value={formData.name}
                    onChange={(event) => handleInputChange("name", event.target.value)}
                    {...getInputFieldProps("name")}
                />
            </FormField>

            <FormField
                data-component={`${base}_birthday-input`}
                htmlFor="birthday"
                label={t(locale, "clients.form.birthday")}
                required
                labelAccessory={renderFieldMessage("birthday", `${base}_birthday-input_helper`)}
            >
                <FormTextInput
                    ref={birthdayInputRef}
                    id="birthday"
                    placeholder="1958-03-03"
                    inputMode="numeric"
                    value={formData.birthday ?? ""}
                    onChange={(event) => handleInputChange("birthday", formatIsoDateInput(event.target.value))}
                    maxLength={10}
                    {...getInputFieldProps("birthday")}
                />
            </FormField>

            <FormField
                data-component={`${base}_due-date-input`}
                htmlFor="dueDate"
                label={t(locale, "clients.form.due-date")}
                labelAccessory={renderFieldMessage("dueDate", `${base}_due-date-input_helper`)}
            >
                <FormTextInput
                    ref={dueDateInputRef}
                    id="dueDate"
                    placeholder="2026-11-20"
                    inputMode="numeric"
                    value={formData.dueDate || ""}
                    onChange={(event) => handleInputChange("dueDate", formatIsoDateInput(event.target.value))}
                    maxLength={10}
                    {...getInputFieldProps("dueDate")}
                />
            </FormField>

            <FormField
                data-component={`${base}_birth-date-input`}
                htmlFor="birthDate"
                label={t(locale, "clients.form.birth-date")}
                labelAccessory={renderFieldMessage("birthDate", `${base}_birth-date-input_helper`)}
            >
                <FormTextInput
                    ref={birthDateInputRef}
                    id="birthDate"
                    placeholder="2026-11-20"
                    inputMode="numeric"
                    value={formData.birthDate || ""}
                    onChange={(event) => handleInputChange("birthDate", formatIsoDateInput(event.target.value))}
                    maxLength={10}
                    {...getInputFieldProps("birthDate")}
                />
            </FormField>

            <FormField
                data-component={`${base}_phone-input`}
                htmlFor="phone"
                label={t(locale, "clients.form.phone")}
                required
                labelAccessory={renderFieldMessage("phone", `${base}_phone-input_helper`)}
            >
                <FormTextInput
                    ref={phoneInputRef}
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="010-1234-5678"
                    value={formData.phone ?? ""}
                    onChange={(event) => {
                        handleInputChange("phone", formatKoreanPhoneNumber(event.target.value));
                        clearFormError();
                    }}
                    maxLength={20}
                    {...getInputFieldProps("phone")}
                />
            </FormField>

            <FormField
                data-component={`${base}_area-field`}
                htmlFor="clients-form-panel-area"
                label="관할 지역"
                labelAccessory={renderSlotMessage(areaFieldMessage, areaMessageId, `${base}_area-field_helper`)}
            >
                <FormNativeSelect
                    id="clients-form-panel-area"
                    aria-describedby={areaMessageId}
                    value={formData.areaId ?? ""}
                    options={areaOptions}
                    placeholder={isAvailableClientAreasLoading ? "지역을 불러오는 중" : "관할 지역 선택"}
                    onValueChange={(value) => handleChange("areaId", value || null)}
                    disabled={isAvailableClientAreasLoading}
                    wrapDataComponent={`${base}_area-field_select-wrap`}
                    selectDataComponent={`${base}_area-field_select`}
                    iconDataComponent={`${base}_area-field_select-icon`}
                />
            </FormField>

            <FormField
                data-component={`${base}_address-input`}
                htmlFor="address"
                label={t(locale, "clients.form.address")}
                required
                className={PANEL_FULL_FIELD_CLASS_NAME}
                labelAccessory={renderFieldMessage("address", `${base}_address-input_helper`)}
            >
                <FormTextInput
                    ref={addressInputRef}
                    id="address"
                    placeholder="인천광역시 서구"
                    value={formData.address ?? ""}
                    onChange={(event) => handleInputChange("address", event.target.value)}
                    {...getInputFieldProps("address")}
                />
            </FormField>
        </>
    );

    const panelEmployeeStep = (
        <>
            <EmployeeAutocomplete
                data-component={`${base}_employee-step_primary-employee-autocomplete`}
                value={formData.primaryEmployeeId}
                onChange={(id) => handleChange("primaryEmployeeId", id)}
                label={t(locale, "clients.form.primary-employee")}
                excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                allowManualEntry
                onManualEntry={() => {
                    openEmployeeDialog("primary");
                }}
                error={serverEmployeeMessages.primary !== undefined}
                helperText={serverEmployeeMessages.primary?.text}
                triggerButtonRef={primaryEmployeeTriggerRef}
            />
            <EmployeeAutocomplete
                data-component={`${base}_employee-step_secondary-employee-autocomplete`}
                value={formData.secondaryEmployeeId ?? null}
                onChange={(id) => handleChange("secondaryEmployeeId", id)}
                label={t(locale, "clients.form.secondary-employee")}
                excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                allowManualEntry
                onManualEntry={() => {
                    openEmployeeDialog("secondary");
                }}
                error={serverEmployeeMessages.secondary !== undefined}
                helperText={serverEmployeeMessages.secondary?.text}
                triggerButtonRef={secondaryEmployeeTriggerRef}
            />
        </>
    );

    const panelVoucherInfoStep = (
        <>
            <div className={cn(PANEL_FULL_FIELD_CLASS_NAME, "flex justify-center")}>
                <TogglePill
                    data-component={`${base}_voucher-client-field`}
                    value={formData.voucherClient}
                    onValueChange={handleVoucherClientChange}
                    leftLabel={t(locale, "clients.form.voucher-client")}
                    rightLabel={t(locale, "clients.form.self-pay-client")}
                    ariaLabel={t(locale, "clients.form.customer-type")}
                />
            </div>

            {formData.voucherClient && (
                <>
                    <FormField
                        data-component={`${base}_voucher-year-field`}
                        htmlFor="clients-form-panel-voucher-year"
                        label={t(locale, "clients.form.voucher-year")}
                    >
                        <FormNativeSelect
                            id="clients-form-panel-voucher-year"
                            value={resolvedVoucherYear.toString()}
                            options={voucherYearOptions}
                            placeholder={t(locale, "clients.form.voucher-year")}
                            onValueChange={handleVoucherYearChange}
                            wrapDataComponent={`${base}_voucher-year-field_select-wrap`}
                            selectDataComponent={`${base}_voucher-year-field_select`}
                            iconDataComponent={`${base}_voucher-year-field_select-icon`}
                        />
                    </FormField>

                    <FormField
                        data-component={`${base}_voucher-type-field`}
                        htmlFor="clients-form-panel-voucher-type"
                        label={t(locale, "clients.form.voucher-type")}
                    >
                        <FormNativeSelect
                            id="clients-form-panel-voucher-type"
                            value={formData.type || ""}
                            options={voucherTypeOptions}
                            placeholder={t(locale, "clients.form.voucher-type")}
                            onValueChange={handleTypeChange}
                            wrapDataComponent={`${base}_voucher-type-field_select-wrap`}
                            selectDataComponent={`${base}_voucher-type-field_select`}
                            iconDataComponent={`${base}_voucher-type-field_select-icon`}
                        />
                    </FormField>
                </>
            )}

            <FormField
                data-component={`${base}_duration-field`}
                htmlFor="clients-form-panel-duration"
                label={t(locale, "clients.form.duration")}
                labelAccessory={renderSlotMessage(durationFieldMessage, durationMessageId, `${base}_duration-field_helper`)}
            >
                <div className="relative">
                    <FormNativeSelect
                        id="clients-form-panel-duration"
                        aria-describedby={durationFieldMessage ? durationMessageId : undefined}
                        aria-invalid={durationFieldMessage ? true : undefined}
                        value={formData.duration?.toString() || ""}
                        options={durationOptions}
                        placeholder={t(locale, "clients.form.duration")}
                        onValueChange={(value) => {
                            handleChange("duration", value ? Number(value) : null);
                            setPricesManuallyEdited(false);
                        }}
                        disabled={formData.voucherClient
                            ? !formData.type || isPriceLoading
                            : isOutOfPocketPriceLoading || isOutOfPocketPriceError}
                        wrapDataComponent={`${base}_duration-field_select-wrap`}
                        selectDataComponent={`${base}_duration-field_select`}
                        iconDataComponent={`${base}_duration-field_select-icon`}
                    />
                    {(formData.voucherClient ? isPriceLoading : isOutOfPocketPriceLoading) && (
                        <div className="absolute right-10 top-1/2 -translate-y-1/2">
                            <Spinner className="h-4 w-4" />
                        </div>
                    )}
                </div>
            </FormField>

            <FormField
                data-component={`${base}_full-price-input`}
                htmlFor="fullPrice"
                label={t(locale, "clients.form.full-price")}
            >
                <FormTextInput
                    id="fullPrice"
                    value={arePriceInputsLocked ? "" : formatPrice(formData.fullPrice || "")}
                    onChange={(event) => handlePriceChange("fullPrice", event.target.value.replace(/,/g, ""))}
                    disabled={arePriceInputsLocked}
                />
            </FormField>

            {formData.voucherClient && <FormField
                data-component={`${base}_grant-input`}
                htmlFor="grant"
                label={t(locale, "clients.form.grant")}
            >
                <FormTextInput
                    id="grant"
                    value={arePriceInputsLocked ? "" : formatPrice(formData.grant || "")}
                    onChange={(event) => handlePriceChange("grant", event.target.value.replace(/,/g, ""))}
                    disabled={arePriceInputsLocked}
                />
            </FormField>}

            {formData.voucherClient && <FormField
                data-component={`${base}_actual-price-input`}
                htmlFor="actualPrice"
                label={t(locale, "clients.form.actual-price")}
            >
                <FormTextInput
                    id="actualPrice"
                    value={arePriceInputsLocked ? "" : formatPrice(formData.actualPrice || "")}
                    onChange={(event) => handlePriceChange("actualPrice", event.target.value.replace(/,/g, ""))}
                    disabled={arePriceInputsLocked}
                />
            </FormField>}
        </>
    );

    const panelContractInfoStep = (
        <>
            <FormField
                data-component={`${base}_contract-status-field`}
                htmlFor="clients-form-panel-contract-status"
                label={t(locale, "clients.form.contract-status")}
            >
                <FormNativeSelect
                    id="clients-form-panel-contract-status"
                    value={formData.serviceStatus || ""}
                    options={serviceStatusOptions}
                    placeholder={t(locale, "clients.form.contract-status")}
                    onValueChange={(value) => handleChange("serviceStatus", value)}
                    wrapDataComponent={`${base}_contract-status-field_select-wrap`}
                    selectDataComponent={`${base}_contract-status-field_select`}
                    iconDataComponent={`${base}_contract-status-field_select-icon`}
                />
            </FormField>

            <FormField
                data-component={`${base}_start-date-input`}
                htmlFor="startDate"
                label={t(locale, "clients.form.start-date")}
                labelAccessory={renderFieldMessage("startDate", `${base}_start-date-input_helper`)}
            >
                <FormTextInput
                    ref={startDateInputRef}
                    id="startDate"
                    placeholder="2026-12-01"
                    inputMode="numeric"
                    value={formData.startDate || ""}
                    onChange={(event) => handleInputChange("startDate", formatIsoDateInput(event.target.value))}
                    maxLength={10}
                    {...getInputFieldProps("startDate")}
                />
            </FormField>

            <FormField
                data-component={`${base}_end-date-input`}
                htmlFor="endDate"
                label={t(locale, "clients.form.end-date")}
                labelAccessory={renderFieldMessage("endDate", `${base}_end-date-input_helper`)}
            >
                <FormTextInput
                    ref={endDateInputRef}
                    id="endDate"
                    placeholder="2026-12-19"
                    inputMode="numeric"
                    value={formData.endDate || ""}
                    onChange={(event) => handleInputChange("endDate", formatIsoDateInput(event.target.value))}
                    maxLength={10}
                    {...getInputFieldProps("endDate")}
                />
            </FormField>
            {calendarLoadNotice ? <div className={PANEL_FULL_FIELD_CLASS_NAME}>{calendarLoadNotice}</div> : null}

            <div className={cn(
                PANEL_FULL_FIELD_CLASS_NAME,
                "grid gap-[calc(12px*var(--glint-ui-scale,1))]",
                isEditMode ? "lg:grid-cols-2" : "lg:grid-cols-3",
            )}>
                <FormSwitchRow
                    data-component={`${base}_care-center-field`}
                    size="control"
                    title={t(locale, "clients.form.care-center")}
                    checked={formData.careCenter === true}
                    onToggle={() => handleChange("careCenter", !formData.careCenter)}
                    buttonAriaLabel={t(locale, "clients.form.care-center")}
                />
                <FormSwitchRow
                    data-component={`${base}_breast-pump-field`}
                    size="control"
                    title={t(locale, "clients.form.breast-pump")}
                    checked={formData.breastPump}
                    onToggle={() => handleChange("breastPump", !formData.breastPump)}
                    buttonAriaLabel={t(locale, "clients.form.breast-pump")}
                />
                {!isEditMode ? (
                    <FormSwitchRow
                        data-component={`${base}_message-automation-field`}
                        size="control"
                        title={t(locale, "clients.form.message-automation")}
                        checked={formData.applyMessageAutomation !== false}
                        onToggle={() => handleChange("applyMessageAutomation", formData.applyMessageAutomation === false)}
                        buttonAriaLabel={t(locale, "clients.form.message-automation")}
                    />
                ) : null}
            </div>
        </>
    );

    const dialogFormSteps = [
        <Fragment key="basic-info">{basicInfoSection}</Fragment>,
        <Fragment key="employee">{employeeSection}</Fragment>,
        <Fragment key="voucher-info">{voucherInfoSections}</Fragment>,
        <Fragment key="contract-info">{contractInfoSections}</Fragment>,
    ] as const;
    const panelFormSteps = [
        panelBasicInfoStep,
        panelEmployeeStep,
        panelVoucherInfoStep,
        panelContractInfoStep,
    ] as const;

    const formError = error ? (
        <Alert
            ref={summaryRef}
            tabIndex={-1}
            variant="destructive"
            data-component={`${base}_error-summary`}
        >
            <AlertDescription>
                <div className="flex flex-col gap-2">
                    <p>{error.message}</p>
                    {summaryErrorEntries.length > 0 ? (
                        <ul className="flex flex-col gap-1">
                            {summaryErrorEntries.map(({ fieldError, id }) => (
                                <li key={id} id={id}>
                                    <span>{`${resolveProblemPresentation(locale).unmappedField}: ${fieldError.detail}`}</span>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    {isUnknownOutcome ? (
                        <p>
                            {resolveProblemPresentation(locale).checkStatus}
                        </p>
                    ) : null}
                    {error.requestId ? (
                        <FormHelperText data-component={`${base}_error-summary_request-id`}>
                            {locale === "en" ? `Request ID: ${error.requestId}` : `요청 ID: ${error.requestId}`}
                        </FormHelperText>
                    ) : null}
                </div>
            </AlertDescription>
        </Alert>
    ) : null;

    const formContent = surface === "panel" ? (
        <SteppedWizardPanelContent
            ref={contentRef}
            dataComponent={`${base}_content`}
            stepContentClassName={PANEL_STEP_CONTENT_CLASS_NAME}
            feedback={formError}
        >
            {panelFormSteps[activeStep]}
        </SteppedWizardPanelContent>
    ) : (
        <div
            ref={contentRef}
            data-component={`${base}_content`}
            className="space-y-5"
        >
            {formError}
            {dialogFormSteps}
        </div>
    );

    const durationConfirmationDialog = (
        <Dialog
            open={open && pendingDurationConfirmation !== null}
            onOpenChange={(isOpen) => { if (!isOpen) setPendingDurationConfirmation(null); }}
        >
            <FormDialogShell
                data-component={`${base}_duration-confirmation`}
                size="compact"
                title="서비스 기간 확인"
                description="평일 기준으로 서비스 기간이 맞지 않아요. 그래도 저장할까요?"
                footer={(
                    <>
                        <Button
                            type="button"
                            variant="outline"
                            data-component={`${base}_duration-confirmation_cancel`}
                            onClick={() => setPendingDurationConfirmation(null)}
                        >
                            취소
                        </Button>
                        <Button
                            type="button"
                            data-component={`${base}_duration-confirmation_confirm`}
                            disabled={isSubmitting || isUnknownOutcome}
                            onClick={() => {
                                if (pendingDurationConfirmation !== null) {
                                    void handleSubmit(pendingDurationConfirmation);
                                }
                            }}
                        >
                            확인
                        </Button>
                    </>
                )}
            >
                <p data-component={`${base}_duration-confirmation_message`}>
                    평일 기준으로 서비스 기간이 맞지 않습니다. 그래도 저장할까요?
                </p>
            </FormDialogShell>
        </Dialog>
    );

    const panelFooter = panelFormActions;
    const employeeRegistrationDialog = (
        <EmployeeFormDialog
            open={isEmployeeDialogOpen}
            onClose={handleEmployeeDialogClose}
            onSuccess={handleEmployeeCreated}
        />
    );

    if (surface === "panel" && !open) {
        return null;
    }

    if (surface === "panel") {
        const panelLayout = renderLayout ? renderLayout({ content: formContent, footer: panelFooter }) : (
            <>
                {formContent}
                <footer data-component={`${base}_footer`} data-slot="detail-panel-footer" className={DETAIL_PANEL_FOOTER_CLASS_NAME}>
                    {panelFooter}
                </footer>
            </>
        );

        return (
            <>
                {panelLayout}
                {employeeRegistrationDialog}
                {durationConfirmationDialog}
            </>
        );
    }

    return (
        <>
            <Dialog data-component={`${base}`} open={open} onOpenChange={(isOpen) => !isOpen && handleDialogClose()}>
                <FormDialogShell
                    dataComponent={`${base}`}
                    title={formTitle}
                    contentClassName="space-y-5"
                    footer={dialogFormActions}
                >
                    {notice && (
                        <p data-component={`${base}_notice`} className="text-sm text-v3-text-muted" role="note">
                            {notice}
                        </p>
                    )}
                    {formContent}
                </FormDialogShell>
            </Dialog>
            {employeeRegistrationDialog}
            {durationConfirmationDialog}
        </>
    );
}
