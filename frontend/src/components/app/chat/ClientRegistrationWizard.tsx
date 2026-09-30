"use client";
import { isValidBirthdayIsoDate, normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import {
    isRealIsoDate,
    resolveFieldMessage,
    type FieldInputState,
    type FieldKind,
} from "@babyjamjam/shared/utils/field-validation-message";
import { getUserErrorMessage } from "@babyjamjam/shared";


import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { normalizeApiError } from "@babyjamjam/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldMessageText } from "@/components/app/ui/field-message";
import { Separator } from "@/components/ui/separator";
import { Stepper, Step, StepLabel } from "@/components/ui/stepper";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SelectGroup,
    SelectLabel as SelectGroupLabel,
} from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import { useVoucherPriceInfos, useVoucherYears } from "@/hooks/useVoucherData";
import {
    useCreateEmployee,
    useEmployees,
    type CreateEmployeeDto,
    type Employee,
} from "@/hooks/useEmployees";
import { useCreateClient } from "@/hooks/useClients";
import { useFieldInputStates } from "@/hooks/useFieldInputStates";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import {
    resolveElevenDigitPhoneMessage,
    toFieldMessageView,
    type FieldMessageView,
} from "@/lib/forms/field-message-text";
import type { CreateClientDto } from "@/lib/client/types";
import type { ClientRegistrationDraft } from "@/lib/client/client-registration-extraction";
import {
    CLIENT_REGISTRATION_ERROR_MESSAGES,
    buildCanonicalClientRegistrationBasics,
    formatKoreanPhoneNumber,
    getCanonicalClientRegistrationError,
    normalizeCompactDateForSubmit,
} from "@/lib/client/client-registration-formats";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { WORK_AREAS, normalizeEmployeeGrade } from "@/components/app/employees/employee-form.constants";

export type CreatedClient = {
    id: number;
    name: string;
};

interface ClientRegistrationWizardProps {
    initialDraft?: ClientRegistrationDraft;
    onCreated?: (client: CreatedClient) => void;
}

const steps = ["기본 정보", "바우처 정보", "설정"] as const;

const WIZARD_MIN_HEIGHT_PX = 520;

/** Text inputs that show their validation message in the label-row slot. */
type WizardInputField =
    | "name"
    | "dueDate"
    | "phone"
    | "birthday"
    | "address"
    | "employeeName"
    | "employeePhone";

/** Element ids double as the focus targets for the first problem field. */
const WIZARD_INPUT_FIELD_CONFIG: Record<WizardInputField, { kind: FieldKind; label: string; id: string }> = {
    name: { kind: "text", label: "이름", id: "name" },
    dueDate: { kind: "date", label: "출산 예정일", id: "dueDate" },
    phone: { kind: "phone", label: "연락처", id: "phone" },
    birthday: { kind: "date", label: "생년월일", id: "birthday" },
    address: { kind: "text", label: "주소", id: "address" },
    employeeName: { kind: "text", label: "제공인력 이름", id: "employee-name" },
    employeePhone: { kind: "phone", label: "연락처", id: "employee-phone" },
};

/** Listed in form order: the first one with a problem receives focus on submit. */
const WIZARD_BASIC_FIELDS: readonly WizardInputField[] = ["name", "dueDate", "phone", "birthday", "address"];
const WIZARD_BASE = "desktop_chat_page_wizard-registration";

/**
 * The wizard keeps the due date as the typed YYYY-MM-DD string. The canonical
 * registration helpers (shared with the contract form) still speak YYMMDD, so
 * the value is converted right before it reaches them. Returns "" for anything
 * that is not a real date they can round-trip.
 */
function isoDueDateToCompact(iso: string): string {
    if (!isRealIsoDate(iso)) return "";
    const compact = iso.slice(2).replace(/\D/g, "");
    return normalizeCompactDateForSubmit(compact) === iso ? compact : "";
}

interface WizardFieldRowProps {
    field: WizardInputField;
    message: FieldMessageView | null;
    children: ReactNode;
}

/** A label whose validation message sits at the right end of the same row and never changes its height. */
function WizardFieldRow({ field, message, children }: WizardFieldRowProps) {
    const { id, label } = WIZARD_INPUT_FIELD_CONFIG[field];
    return (
        <div className="space-y-2" data-component={`${WIZARD_BASE}_${id}-field`}>
            <div className="flex h-[1lh] min-w-0 items-center justify-between gap-2 text-sm leading-[1.3]">
                <Label htmlFor={id} className="shrink-0 leading-[1.3]">{label}</Label>
                {message ? (
                    <FieldMessageText
                        id={`${id}-message`}
                        tone={message.tone}
                        data-component={`${WIZARD_BASE}_${id}-field_message`}
                        className="ml-auto min-w-0"
                    >
                        {message.text}
                    </FieldMessageText>
                ) : null}
            </div>
            {children}
        </div>
    );
}

function formatPrice(price: string): string {
    const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
    if (Number.isNaN(num)) return price;
    return num.toLocaleString("ko-KR");
}

export function ClientRegistrationWizard({
    initialDraft,
    onCreated,
}: ClientRegistrationWizardProps) {
    const createClientMutation = useCreateClient();
    const createEmployeeMutation = useCreateEmployee();
    const {
        data: employees = [],
        isLoading: isEmployeesLoading,
        isFetching: isEmployeesFetching,
        isError: isEmployeesError,
        refetch: refetchEmployees,
    } = useEmployees();
    const [activeStep, setActiveStep] = useState(0);

    const [name, setName] = useState(initialDraft?.name ?? "");
    const [phone, setPhone] = useState(initialDraft?.phone ? formatKoreanPhoneNumber(initialDraft.phone) : "");
    const [birthday, setBirthday] = useState(normalizeBirthdayIsoDate(initialDraft?.birthday) ?? initialDraft?.birthday ?? "");
    const [address, setAddress] = useState(initialDraft?.address ?? "");
    // The extracted draft carries the due date as YYMMDD; the form holds YYYY-MM-DD.
    const [dueDate, setDueDate] = useState(normalizeCompactDateForSubmit(initialDraft?.dueDate ?? ""));

    const [isRegisteringEmployee, setIsRegisteringEmployee] = useState(false);
    const [employeeName, setEmployeeName] = useState(initialDraft?.employeeName ?? "");
    const [createdEmployeeId, setCreatedEmployeeId] = useState<number | null>(null);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
    const [employeePhone, setEmployeePhone] = useState("");
    const [employeeGrade, setEmployeeGrade] = useState("스탠다드");
    const [employeeWorkArea, setEmployeeWorkArea] = useState<string>(WORK_AREAS[0]);

    const [voucherClient, setVoucherClient] = useState(true);
    const { data: voucherYears = [], isLoading: isVoucherYearsLoading } = useVoucherYears();
    const [voucherYear, setVoucherYear] = useState<number | null>(null);
    const [voucherType, setVoucherType] = useState("");
    const [voucherDuration, setVoucherDuration] = useState("");
    const [fullPrice, setFullPrice] = useState("");
    const [grant, setGrant] = useState("");
    const [actualPrice, setActualPrice] = useState("");

    const resolvedVoucherYear = useMemo(() => {
        if (voucherYear !== null) return voucherYear;
        if (voucherYears.length === 0) return null;
        return Math.max(...voucherYears);
    }, [voucherYear, voucherYears]);

    const { data: voucherPriceInfos = [], isLoading: isVoucherPriceInfosLoading } = useVoucherPriceInfos(
        voucherType,
        resolvedVoucherYear ?? undefined,
    );

    const [careCenter, setCareCenter] = useState(false);
    const [breastPump, setBreastPump] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isEmployeeRetrying, setIsEmployeeRetrying] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const locale = useLocale();
    const fields = useFieldInputStates<WizardInputField>();
    const stepsRef = useRef<HTMLDivElement>(null);
    const pendingFocusFieldRef = useRef<WizardInputField | null>(null);
    // Values that arrived prefilled count as "had a value", so clearing one reports "required".
    const [prefilledFields] = useState<ReadonlySet<WizardInputField>>(
        () => new Set<WizardInputField>(
            (Object.entries({
                name: initialDraft?.name ?? "",
                dueDate,
                phone,
                birthday,
                address: initialDraft?.address ?? "",
                employeeName: initialDraft?.employeeName ?? "",
                employeePhone: "",
            }) as Array<[WizardInputField, string]>)
                .filter(([, value]) => value !== "")
                .map(([field]) => field),
        ),
    );

    const isVoucherInfoComplete =
        resolvedVoucherYear !== null &&
        voucherType.trim().length > 0 &&
        voucherDuration.trim().length > 0 &&
        fullPrice.trim().length > 0 &&
        grant.trim().length > 0 &&
        actualPrice.trim().length > 0;

    const matchingEmployees = employees.filter(
        (candidate: Employee) => candidate.name === employeeName.trim(),
    );
    const selectedEmployee = selectedEmployeeId === null
        ? undefined
        : matchingEmployees.find((employee) => employee.id === selectedEmployeeId);
    const matchedEmployee = selectedEmployee
        ?? (selectedEmployeeId === null && matchingEmployees.length === 1 ? matchingEmployees[0] : undefined);
    const hasInvalidEmployeeSelection = employeeName.trim().length > 0
        && selectedEmployeeId !== null
        && selectedEmployee === undefined;
    const hasAmbiguousEmployeeMatch = createdEmployeeId === null
        // A stale explicit id must block while any same-name option remains,
        // but zero matches should expose the registration path instead.
        && ((matchingEmployees.length > 0 && hasInvalidEmployeeSelection)
            || (matchingEmployees.length > 1 && !selectedEmployee));
    const isEmployeeLookupBlocked = createdEmployeeId === null
        && employeeName.trim().length > 0
        && (isEmployeesLoading || isEmployeesFetching || isEmployeesError || isEmployeeRetrying);
    const needsEmployeeRegistration = Boolean(employeeName.trim())
        && !isEmployeesLoading
        && !isEmployeesFetching
        && !isEmployeesError
        && !isEmployeeRetrying
        && matchingEmployees.length === 0
        && createdEmployeeId === null;
    const canRegisterEmployee = employeeName.trim().length >= 2
        && employeePhone.replace(/\D/g, "").length === 11
        && Boolean(employeeWorkArea)
        && !isEmployeesFetching
        && !isEmployeeRetrying;

    useEffect(() => {
        if (isRegisteringEmployee && (matchingEmployees.length > 0 || isEmployeesError)) {
            setIsRegisteringEmployee(false);
        }
    }, [isEmployeesError, isRegisteringEmployee, matchingEmployees.length]);

    const dueDateSkipped = Boolean(initialDraft?.skippedFields?.includes("dueDate"));
    const dueDateCompact = isoDueDateToCompact(dueDate);

    const inputValueOf = (field: WizardInputField): string => ({
        name,
        dueDate,
        phone,
        birthday,
        address,
        employeeName,
        employeePhone,
    })[field];

    /**
     * The one message an input shows in its label-row slot. `settled` evaluates
     * only the input's own rules as if the user already left the field and
     * pressed next, which is how the wizard decides whether a field has a problem.
     */
    const resolveWizardFieldMessage = (field: WizardInputField, settled = false): FieldMessageView | null => {
        const { kind, label } = WIZARD_INPUT_FIELD_CONFIG[field];
        const value = inputValueOf(field);
        const tracked = fields.stateOf(field, kind === "text" ? value.trim() : value);
        const state: FieldInputState = {
            ...tracked,
            hadValue: tracked.hadValue || prefilledFields.has(field),
            focused: settled ? false : tracked.focused,
        };
        const opts = {
            required: field === "dueDate" ? !dueDateSkipped : true,
            submitted: settled || fields.submitted,
        };

        const formatMessage = toFieldMessageView(
            locale,
            kind === "phone" ? resolveElevenDigitPhoneMessage(state, opts) : resolveFieldMessage(kind, state, opts),
            label,
        );
        if (formatMessage) return formatMessage;

        if (field === "birthday" && value.length === 10 && !isValidBirthdayIsoDate(value)) {
            return { tone: "error", text: t(locale, "form.validation.birthday-future") };
        }
        // A real date the registration helpers cannot represent (outside 1970-2069).
        if (field === "dueDate" && value.length === 10 && dueDateCompact === "") {
            return { tone: "error", text: t(locale, "form.validation.date-invalid") };
        }
        return null;
    };

    const fieldMessages = Object.fromEntries(
        (Object.keys(WIZARD_INPUT_FIELD_CONFIG) as WizardInputField[]).map((field) => [
            field,
            resolveWizardFieldMessage(field),
        ]),
    ) as Record<WizardInputField, FieldMessageView | null>;

    const getFirstProblemField = (): WizardInputField | undefined =>
        WIZARD_BASIC_FIELDS.find((field) => resolveWizardFieldMessage(field, true)?.tone === "error");

    const focusField = (field: WizardInputField) => {
        stepsRef.current?.querySelector<HTMLElement>(`#${WIZARD_INPUT_FIELD_CONFIG[field].id}`)?.focus();
    };

    // A submit that bounced back to the first step focuses its first problem field once it renders.
    useEffect(() => {
        const field = pendingFocusFieldRef.current;
        if (field === null || activeStep !== 0 || isRegisteringEmployee) return;
        pendingFocusFieldRef.current = null;
        focusField(field);
    }, [activeStep, isRegisteringEmployee]);

    const handleFieldChange = (
        field: WizardInputField,
        nextValue: string,
        setValue: (value: string) => void,
    ) => {
        fields.onChange(field, inputValueOf(field), nextValue);
        setValue(nextValue);
    };

    /** Error state, a11y wiring and focus tracking shared by every inline-validated input. */
    const getInputFieldProps = (field: WizardInputField) => {
        const message = fieldMessages[field];
        return {
            error: message?.tone === "error",
            "aria-invalid": message?.tone === "error" ? true : undefined,
            "aria-describedby": message ? `${WIZARD_INPUT_FIELD_CONFIG[field].id}-message` : undefined,
            ...fields.focusProps(field, inputValueOf(field)),
        };
    };

    const hasBasicsProblem = WIZARD_BASIC_FIELDS.some(
        (field) => resolveWizardFieldMessage(field, true)?.tone === "error",
    );

    const canGoNext = (() => {
        if (activeStep === 0) {
            return !hasBasicsProblem && !isEmployeeLookupBlocked && !hasAmbiguousEmployeeMatch;
        }
        if (activeStep === 1) {
            if (!voucherClient) return true;
            return isVoucherInfoComplete;
        }
        return true;
    })();

    const handleNext = () => {
        if (!canGoNext) {
            const problemField = activeStep === 0 ? getFirstProblemField() : undefined;
            if (problemField) {
                fields.setSubmitted(true);
                focusField(problemField);
            }
            return;
        }
        setActiveStep((s) => Math.min(s + 1, steps.length - 1));
    };

    const handleBack = () => {
        setActiveStep((s) => Math.max(s - 1, 0));
    };

    const handleEmployeeRetry = async () => {
        if (createdEmployeeId !== null || !employeeName.trim() || isEmployeeRetrying) return;

        setIsEmployeeRetrying(true);
        setSubmitError(null);

        try {
            await refetchEmployees();
        } catch {
            // The query's error state remains the source of truth for the retry UI.
        } finally {
            setIsEmployeeRetrying(false);
        }
    };

    const handleVoucherYearChange = (year: string) => {
        setVoucherYear(Number(year));
        setVoucherType("");
        setVoucherDuration("");
        setFullPrice("");
        setGrant("");
        setActualPrice("");
    };

    const handleVoucherTypeChange = (type: string) => {
        setVoucherType(type);
        setVoucherDuration("");
        setFullPrice("");
        setGrant("");
        setActualPrice("");
    };

    const handleVoucherDurationChange = (duration: string) => {
        const selected = voucherPriceInfos.find((v) => v.duration === duration);
        if (!selected) return;

        setVoucherDuration(duration);
        setFullPrice(selected.fullPrice?.toString() ?? "");
        setGrant(selected.grant?.toString() ?? "");
        setActualPrice(selected.actualPrice?.toString() ?? "");
    };

    const handleSubmit = async () => {
        if (employeeName.trim() && createdEmployeeId === null && (isEmployeesFetching || isEmployeeRetrying)) {
            setSubmitError("제공인력 정보를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.");
            setActiveStep(0);
            return;
        }

        const basicsInput = { name, phone, birthday, address, dueDate: dueDateCompact };
        const canonicalError = getCanonicalClientRegistrationError(basicsInput);
        // The due date is the last rule checked, so this only ever drops a due-date
        // complaint for a date the user chose to skip.
        const basicsError = canonicalError === CLIENT_REGISTRATION_ERROR_MESSAGES.dueDate
            && dueDateSkipped
            && dueDate === ""
            ? null
            : canonicalError;
        if (basicsError) {
            const problemField = getFirstProblemField();
            if (problemField) {
                // The field's own message says what to fix; take the user to it.
                fields.setSubmitted(true);
                pendingFocusFieldRef.current = problemField;
                setSubmitError(null);
                setActiveStep(0);
            } else {
                setSubmitError(basicsError);
            }
            return;
        }

        if (voucherClient && !isVoucherInfoComplete) {
            setSubmitError("바우처 정보를 입력해주세요.");
            return;
        }

        if (employeeName && createdEmployeeId === null && !matchedEmployee) {
            setSubmitError("제공인력 정보가 변경되었습니다. 제공인력을 다시 확인해 주세요.");
            setActiveStep(0);
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const payload: Record<string, unknown> = {
                ...buildCanonicalClientRegistrationBasics(basicsInput),
                careCenter,
                voucherClient,
                breastPump,
            };

            if (!dueDateCompact) delete payload.dueDate;

            if (voucherClient) {
                payload.type = voucherType;

                const durationNumber = Number(voucherDuration);
                if (!Number.isNaN(durationNumber)) {
                    payload.duration = durationNumber;
                }

                payload.fullPrice = fullPrice;
                payload.grant = grant;
                payload.actualPrice = actualPrice;
            }

            const created = await createClientMutation.mutateAsync({
                ...payload,
                primaryEmployeeId: createdEmployeeId ?? matchedEmployee?.id ?? null,
            } as CreateClientDto);
            onCreated?.(created);
        } catch (e) {
            // Registered problem message (verified) or locally authored copy —
            // upstream internals are never rendered.
            const normalized = normalizeApiError(e, { locale: "ko-KR", operation: "mutation" });
            setSubmitError(normalized.verified ? normalized.message : "등록에 실패했어요.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEmployeeSubmit = async () => {
        if (!canRegisterEmployee) return;

        setIsSubmitting(true);
        try {
            const createdEmployee = await createEmployeeMutation.mutateAsync({
                name: employeeName.trim(),
                workArea: [employeeWorkArea],
                phone: employeePhone.replace(/\D/g, ""),
                grade: normalizeEmployeeGrade(employeeGrade),
                openToNextWork: true,
            } satisfies CreateEmployeeDto);
            setCreatedEmployeeId(createdEmployee.id);
            setIsRegisteringEmployee(false);
            handleNext();
        } catch (e) {
            // Registered problem message (verified) or locally authored copy —
            // upstream internals are never rendered.
            const normalized = normalizeApiError(e, { locale: "ko-KR", operation: "mutation" });
            setSubmitError(normalized.verified ? normalized.message : "제공인력 등록에 실패했어요.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div data-component="desktop_chat_page_wizard-registration" className="flex flex-col" style={{ minHeight: WIZARD_MIN_HEIGHT_PX }}>
            <div className="mb-4">
                <h3 className="text-base font-bold mb-1">
                    산모 등록
                </h3>
                <p className="text-sm text-muted-foreground">
                    {initialDraft
                        ? "대화에서 받은 정보를 채웠어요. 부족한 항목을 입력해 주세요."
                        : "필요한 정보만 빠르게 입력해 등록할 수 있어요."}
                </p>
            </div>

            <Stepper activeStep={activeStep} className="mb-4">
                {steps.map((label, index) => (
                    <Step key={label}>
                        <StepLabel>{index + 1}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            <div ref={stepsRef} data-component="desktop_chat_page_wizard-registration_steps" className="flex-1 min-h-0">
                {/* Step 1: Basic Info */}
                {activeStep === 0 && !isRegisteringEmployee && (
                    <div className="grid gap-4">
                        <WizardFieldRow field="name" message={fieldMessages.name}>
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => handleFieldChange("name", e.target.value, setName)}
                                autoFocus
                                {...getInputFieldProps("name")}
                            />
                        </WizardFieldRow>
                        <WizardFieldRow field="dueDate" message={fieldMessages.dueDate}>
                            <Input
                                id="dueDate"
                                type="text"
                                inputMode="numeric"
                                maxLength={10}
                                placeholder="2026-11-20"
                                value={dueDate}
                                onChange={(e) => handleFieldChange("dueDate", formatIsoDateInput(e.target.value), setDueDate)}
                                {...getInputFieldProps("dueDate")}
                            />
                        </WizardFieldRow>
                        <WizardFieldRow field="phone" message={fieldMessages.phone}>
                            <Input
                                id="phone"
                                value={phone}
                                onChange={(e) => handleFieldChange("phone", formatKoreanPhoneNumber(e.target.value), setPhone)}
                                placeholder="010-1234-5678"
                                maxLength={13}
                                {...getInputFieldProps("phone")}
                            />
                        </WizardFieldRow>
                        <WizardFieldRow field="birthday" message={fieldMessages.birthday}>
                            <Input
                                id="birthday"
                                value={birthday}
                                onChange={(e) => handleFieldChange("birthday", formatIsoDateInput(e.target.value), setBirthday)}
                                placeholder="1958-03-03"
                                inputMode="numeric"
                                maxLength={10}
                                {...getInputFieldProps("birthday")}
                            />
                        </WizardFieldRow>
                        <WizardFieldRow field="address" message={fieldMessages.address}>
                            <Input
                                id="address"
                                placeholder="상세 주소"
                                value={address}
                                onChange={(e) => handleFieldChange("address", e.target.value, setAddress)}
                                {...getInputFieldProps("address")}
                            />
                        </WizardFieldRow>
                        {createdEmployeeId === null && matchingEmployees.length > 0 && (matchingEmployees.length > 1 || hasInvalidEmployeeSelection) && (
                            <div className="space-y-2">
                                <Label htmlFor="employee-selection">제공인력 선택</Label>
                                <Select
                                    value={selectedEmployeeId?.toString() ?? ""}
                                    onValueChange={(value) => setSelectedEmployeeId(Number(value))}
                                >
                                    <SelectTrigger id="employee-selection" aria-label="제공인력 선택">
                                        <SelectValue placeholder="동명이인 중 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {matchingEmployees.map((employee) => (
                                            <SelectItem key={employee.id} value={employee.id.toString()}>
                                                {employee.name} ({employee.phone})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                )}

                {isRegisteringEmployee && (
                    <div className="grid gap-4">
                        <WizardFieldRow field="employeeName" message={fieldMessages.employeeName}>
                            <Input
                                id="employee-name"
                                value={employeeName}
                                onChange={(e) => handleFieldChange("employeeName", e.target.value, setEmployeeName)}
                                autoFocus
                                {...getInputFieldProps("employeeName")}
                            />
                        </WizardFieldRow>
                        <WizardFieldRow field="employeePhone" message={fieldMessages.employeePhone}>
                            <Input
                                id="employee-phone"
                                value={employeePhone}
                                onChange={(e) => handleFieldChange("employeePhone", formatKoreanPhoneNumber(e.target.value), setEmployeePhone)}
                                placeholder="010-1234-5678"
                                maxLength={13}
                                {...getInputFieldProps("employeePhone")}
                            />
                        </WizardFieldRow>
                        <div className="space-y-2">
                            <Label htmlFor="employee-grade">등급</Label>
                            <Select value={employeeGrade} onValueChange={setEmployeeGrade}>
                                <SelectTrigger id="employee-grade" aria-label="등급">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {["프리미엄", "베스트", "스탠다드"].map((grade) => (
                                        <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="employee-work-area">근무 가능 지역</Label>
                            <Select value={employeeWorkArea} onValueChange={setEmployeeWorkArea}>
                                <SelectTrigger id="employee-work-area" aria-label="근무 가능 지역">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {WORK_AREAS.map((area) => (
                                        <SelectItem key={area} value={area}>{area}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}

                {/* Step 2: Voucher Info */}
                {activeStep === 1 && (
                    <div className="grid gap-4">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="voucherClient"
                                checked={voucherClient}
                                onCheckedChange={(checked) => setVoucherClient(checked === true)}
                            />
                            <Label htmlFor="voucherClient">바우처 대상</Label>
                        </div>

                        {voucherClient && (
                            <>
	                                <div className="flex gap-4 items-center flex-wrap">
	                                    <div className="space-y-2 min-w-[140px]">
	                                        <Label>바우처 연도</Label>
	                                        <Select
	                                            value={resolvedVoucherYear?.toString() ?? ""}
	                                            onValueChange={handleVoucherYearChange}
	                                            disabled={isVoucherYearsLoading}
	                                        >
	                                            <SelectTrigger className="w-[140px]" aria-label="바우처 연도">
	                                                <SelectValue placeholder="연도 선택" />
	                                            </SelectTrigger>
	                                            <SelectContent>
	                                                {voucherYears.map((year) => (
	                                                    <SelectItem key={year} value={year.toString()}>
                                                        {year}년
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

	                                <div className="space-y-2">
	                                    <Label>바우처 유형</Label>
	                                    <Select
	                                        value={voucherType}
	                                        onValueChange={handleVoucherTypeChange}
	                                        disabled={resolvedVoucherYear === null}
	                                    >
	                                        <SelectTrigger className="w-full" aria-label="바우처 유형">
	                                            <SelectValue placeholder="유형 선택" />
	                                        </SelectTrigger>
	                                        <SelectContent>
	                                            {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => (
	                                                <SelectGroup key={groupName}>
                                                    <SelectGroupLabel>{groupName}</SelectGroupLabel>
                                                    {Object.entries(types).map(([typeValue, typeData]) => (
                                                        <SelectItem key={typeValue} value={typeValue}>
                                                            {typeData.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectGroup>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {voucherType && (
	                                    <div className="space-y-2">
	                                        <Label>기간</Label>
	                                        <Select
	                                            value={voucherDuration}
	                                            onValueChange={handleVoucherDurationChange}
	                                            disabled={isVoucherPriceInfosLoading || voucherPriceInfos.length === 0}
	                                        >
	                                            <SelectTrigger className="w-full" aria-label="기간">
	                                                <SelectValue placeholder="기간 선택" />
	                                            </SelectTrigger>
	                                            <SelectContent>
	                                                {voucherPriceInfos.map((v) => (
	                                                    <SelectItem key={v.duration} value={v.duration}>
                                                        {v.duration}일
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}

                                {voucherType && isVoucherPriceInfosLoading && (
                                    <div className="flex justify-center py-2">
                                        <Spinner size="sm" />
                                    </div>
                                )}

                                {voucherDuration && fullPrice && grant && actualPrice && (
                                    <>
                                        <Separator />
                                        <div className="grid gap-1.5">
                                            <p className="text-sm text-muted-foreground">
                                                총액: {formatPrice(fullPrice)}원
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                정부지원금: {formatPrice(grant)}원
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                본인부담금: {formatPrice(actualPrice)}원
                                            </p>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Step 3: Settings */}
                {activeStep === 2 && (
                    <div className="grid gap-3">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="careCenter"
                                checked={careCenter}
                                onCheckedChange={(checked) => setCareCenter(checked === true)}
                            />
                            <Label htmlFor="careCenter">조리원 여부</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="breastPump"
                                checked={breastPump}
                                onCheckedChange={(checked) => setBreastPump(checked === true)}
                            />
                            <Label htmlFor="breastPump">유축기</Label>
                        </div>
                    </div>
                )}
            </div>

            {submitError && (
                <Alert variant="destructive" className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{submitError}</AlertDescription>
                </Alert>
            )}

            {employeeName.trim() && createdEmployeeId === null && (isEmployeesError || isEmployeeRetrying) && (
                <Alert variant={isEmployeeRetrying ? "default" : "destructive"} className="mt-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="flex items-center justify-between gap-3">
                        <span>
                            {isEmployeeRetrying
                                ? "제공인력 정보를 다시 확인하고 있습니다."
                                : "제공인력 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."}
                        </span>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleEmployeeRetry()}
                            disabled={isEmployeeRetrying}
                            aria-busy={isEmployeeRetrying}
                        >
                            {isEmployeeRetrying ? (
                                <>
                                    <Spinner size="sm" aria-hidden="true" />
                                    재시도 중...
                                </>
                            ) : "다시 시도"}
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            <div data-component="desktop_chat_page_wizard-registration_actions" className="flex justify-between mt-4">
                <Button
                    variant="outline"
                    onClick={() => {
                        if (isRegisteringEmployee) {
                            setIsRegisteringEmployee(false);
                            return;
                        }
                        handleBack();
                    }}
                    disabled={(!isRegisteringEmployee && activeStep === 0) || isSubmitting}
                >
                    이전
                </Button>

                {activeStep < steps.length - 1 ? (
                    <Button
                        onClick={() => {
                            if (!isRegisteringEmployee && needsEmployeeRegistration) {
                                setIsRegisteringEmployee(true);
                                return;
                            }
                            if (isRegisteringEmployee) {
                                void handleEmployeeSubmit();
                                return;
                            }
                            handleNext();
                        }}
                        disabled={isRegisteringEmployee
                            ? !canRegisterEmployee || isSubmitting
                            : !canGoNext || isSubmitting}
                    >
                        {isRegisteringEmployee ? "제공인력 등록" : "다음"}
                    </Button>
                ) : (
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting
                            || !name.trim()
                            || Boolean(employeeName.trim()
                                && createdEmployeeId === null
                                && (isEmployeesFetching || isEmployeesError || isEmployeeRetrying || hasInvalidEmployeeSelection))
                            || (voucherClient && !isVoucherInfoComplete)}
                    >
                        제출
                    </Button>
                )}
            </div>
        </div>
    );
}

export default ClientRegistrationWizard;
