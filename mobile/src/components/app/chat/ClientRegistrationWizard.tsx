"use client";
import { normalizeApiError } from "@babyjamjam/shared";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { getUserErrorMessage } from "@babyjamjam/shared";


import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldLabelRow, fieldMessageId } from "@/components/app/ui/FieldLabelRow";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { useCreateClient } from "@/hooks/useClients";
import { useFieldMessages } from "@/hooks/use-field-messages";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { focusFirstInvalidField, type FieldSpec, type SlotMessage } from "@/lib/validations/field-message";
import { useLocale } from "@/providers/LocaleProvider";
import type { CreateClientDto } from "@/lib/client/types";
import voucherOptions from "@/components/app/messages/templates/json/voucher.json";

export type CreatedClient = {
    id: number;
    name: string;
};

interface ClientRegistrationWizardProps {
    onCreated?: (client: CreatedClient) => void;
}

const steps = ["기본 정보", "바우처 정보", "설정"] as const;

const WIZARD_MIN_HEIGHT_PX = 520;

const WIZARD_BASE = "mobile_chat_registration-wizard";

type BasicsField = "name" | "dueDate" | "phone" | "birthday" | "address";

// Top-to-bottom order of the step-1 fields; the first problem one is focused on "다음".
const BASICS_FIELD_ORDER: readonly BasicsField[] = ["name", "dueDate", "phone", "birthday", "address"];

function formatPrice(price: string): string {
    const num = parseInt(price.replace(/[,원\s]/g, ""), 10);
    if (Number.isNaN(num)) return price;
    return num.toLocaleString("ko-KR");
}

export function ClientRegistrationWizard({ onCreated }: ClientRegistrationWizardProps) {
    const locale = useLocale();
    const createClientMutation = useCreateClient();
    const [activeStep, setActiveStep] = useState(0);

    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [birthday, setBirthday] = useState("");
    const [address, setAddress] = useState("");
    const [dueDate, setDueDate] = useState("");

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
    const [submitError, setSubmitError] = useState<string | null>(null);
    // True once 다음/제출 was pressed with the voucher type or period still missing.
    const [voucherAttempted, setVoucherAttempted] = useState(false);

    const isVoucherInfoComplete =
        resolvedVoucherYear !== null &&
        voucherType.trim().length > 0 &&
        voucherDuration.trim().length > 0 &&
        fullPrice.trim().length > 0 &&
        grant.trim().length > 0 &&
        actualPrice.trim().length > 0;

    const basicsSpecs: Record<BasicsField, FieldSpec> = {
        name: { kind: "text", label: "이름", required: true },
        dueDate: { kind: "date", label: "출산 예정일", required: true },
        phone: { kind: "phone", label: "연락처", required: true, mobileOnly: true },
        birthday: { kind: "birthday", label: "생년월일", required: true },
        address: { kind: "text", label: "주소", required: true },
    };
    const basicsMessages = useFieldMessages<BasicsField>({
        values: { name, dueDate, phone, birthday, address },
        specs: basicsSpecs,
        locale,
    });
    const isBasicsValid = basicsMessages.invalidFields(BASICS_FIELD_ORDER).length === 0;

    const voucherYearMessage: SlotMessage | null = voucherAttempted && resolvedVoucherYear === null
        ? { text: "연도를 선택해 주세요", tone: "err" }
        : null;
    const voucherTypeMessage: SlotMessage | null = voucherAttempted && !voucherType
        ? { text: "유형을 선택해 주세요", tone: "err" }
        : null;
    const voucherDurationMessage: SlotMessage | null = voucherAttempted && voucherType && !voucherDuration
        ? { text: "기간을 선택해 주세요", tone: "err" }
        : null;

    const handleNext = () => {
        if (activeStep === 1 && voucherClient && !isVoucherInfoComplete) {
            // Pressing it with a problem shows the message in the field's own slot.
            setVoucherAttempted(true);
            return;
        }
        if (activeStep === 0) {
            basicsMessages.markSubmitted();
            const invalid = basicsMessages.invalidFields(BASICS_FIELD_ORDER);
            if (invalid.length > 0) {
                focusFirstInvalidField(invalid);
                return;
            }
        }
        setActiveStep((s) => Math.min(s + 1, steps.length - 1));
    };

    const handleBack = () => {
        setActiveStep((s) => Math.max(s - 1, 0));
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
        if (!isBasicsValid) {
            // Each problem is shown in its own field's message slot on the first step.
            basicsMessages.markSubmitted();
            setActiveStep(0);
            return;
        }

        if (voucherClient && !isVoucherInfoComplete) {
            setVoucherAttempted(true);
            setActiveStep(1);
            return;
        }

        setIsSubmitting(true);
        setSubmitError(null);

        try {
            const payload: Record<string, unknown> = {
                name: name.trim(),
                phone: formatKoreanPhoneNumber(phone),
                birthday: birthday,
                address: address.trim(),
                dueDate: dueDate,
                careCenter,
                voucherClient,
                breastPump,
            };

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
                primaryEmployeeId: null,
            } as CreateClientDto);
            onCreated?.(created);
        } catch (e) {
            // Shared problem contract resolution — Error.message and upstream
            // internals are never rendered; the normalized message or locally
            // authored copy is.
            const normalized = normalizeApiError(e, { locale: "ko-KR", operation: "mutation" });
            setSubmitError(normalized.verified ? normalized.message : "등록에 실패했어요.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const renderBasicsField = (
        field: BasicsField,
        label: string,
        renderInput: (props: ReturnType<typeof basicsMessages.bind> & {
            error: boolean;
            "aria-invalid": true | undefined;
            "aria-describedby": string;
        }) => ReactNode,
    ) => {
        const slot = basicsMessages.slot(field);
        const hasError = slot?.tone === "err";
        const fieldBase = `${WIZARD_BASE}_steps_${field}-field`;
        return (
            <div className="space-y-2" data-component={fieldBase}>
                <FieldLabelRow data-component={fieldBase} htmlFor={field} label={label} message={slot} />
                {renderInput({
                    ...basicsMessages.bind(field),
                    error: hasError,
                    "aria-invalid": hasError ? true : undefined,
                    "aria-describedby": fieldMessageId(field),
                })}
            </div>
        );
    };

    return (
        <div data-component="mobile_chat_registration-wizard" className="flex flex-col" style={{ minHeight: WIZARD_MIN_HEIGHT_PX }}>
            <div className="mb-4">
                <h3 className="text-base font-bold mb-1">
                    산모 등록
                </h3>
                <p className="text-sm text-muted-foreground">
                    필요한 정보만 빠르게 입력해 등록할 수 있어요.
                </p>
            </div>

            <Stepper activeStep={activeStep} className="mb-4">
                {steps.map((label, index) => (
                    <Step key={label}>
                        <StepLabel>{index + 1}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            <div data-component={`${WIZARD_BASE}_steps`} className="flex-1 min-h-0">
                {/* Step 1: Basic Info */}
                {activeStep === 0 && (
                    <div className="grid gap-4">
                        {renderBasicsField("name", "이름", (props) => (
                            <Input
                                id="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                                {...props}
                            />
                        ))}
                        {renderBasicsField("dueDate", "출산 예정일", (props) => (
                            <Input
                                id="dueDate"
                                value={dueDate}
                                onChange={(e) => setDueDate(formatIsoDateInput(e.target.value))}
                                placeholder="2026-11-20"
                                inputMode="numeric"
                                maxLength={10}
                                {...props}
                            />
                        ))}
                        {renderBasicsField("phone", "연락처", (props) => (
                            <Input
                                id="phone"
                                value={phone}
                                onChange={(e) => setPhone(formatKoreanPhoneNumber(e.target.value))}
                                placeholder="010-1234-5678"
                                inputMode="numeric"
                                maxLength={13}
                                {...props}
                            />
                        ))}
                        {renderBasicsField("birthday", "생년월일", (props) => (
                            <Input
                                id="birthday"
                                value={birthday}
                                onChange={(e) => setBirthday(formatIsoDateInput(e.target.value))}
                                placeholder="1958-03-03"
                                inputMode="numeric"
                                maxLength={10}
                                {...props}
                            />
                        ))}
                        {renderBasicsField("address", "주소", (props) => (
                            <Input
                                id="address"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                {...props}
                            />
                        ))}
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
	                                        <FieldLabelRow data-component={`${WIZARD_BASE}_steps_voucher-year-field`} htmlFor="voucherYear" label="바우처 연도" message={voucherYearMessage} />
	                                        <Select
	                                            value={resolvedVoucherYear?.toString() ?? ""}
	                                            onValueChange={handleVoucherYearChange}
	                                            disabled={isVoucherYearsLoading}
	                                        >
	                                            <SelectTrigger id="voucherYear" className="w-[140px]" aria-describedby={fieldMessageId("voucherYear")}>
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
	                                    <FieldLabelRow data-component={`${WIZARD_BASE}_steps_voucher-type-field`} htmlFor="voucherType" label="바우처 유형" message={voucherTypeMessage} />
	                                    <Select
	                                        value={voucherType}
	                                        onValueChange={handleVoucherTypeChange}
	                                        disabled={resolvedVoucherYear === null}
	                                    >
	                                        <SelectTrigger id="voucherType" className="w-full" aria-invalid={voucherTypeMessage ? true : undefined} aria-describedby={fieldMessageId("voucherType")}>
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
	                                        <FieldLabelRow data-component={`${WIZARD_BASE}_steps_voucher-duration-field`} htmlFor="voucherDuration" label="기간" message={voucherDurationMessage} />
	                                        <Select
	                                            value={voucherDuration}
	                                            onValueChange={handleVoucherDurationChange}
	                                            disabled={isVoucherPriceInfosLoading || voucherPriceInfos.length === 0}
	                                        >
	                                            <SelectTrigger id="voucherDuration" className="w-full" aria-invalid={voucherDurationMessage ? true : undefined} aria-describedby={fieldMessageId("voucherDuration")}>
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

            <div data-component="mobile_chat_registration-wizard_actions" className="flex justify-between mt-4">
                <Button
                    variant="outline"
                    onClick={handleBack}
                    disabled={activeStep === 0 || isSubmitting}
                >
                    이전
                </Button>

                {activeStep < steps.length - 1 ? (
                    <Button
                        onClick={handleNext}
                        disabled={isSubmitting}
                    >
                        다음
                    </Button>
                ) : (
                    <Button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !name.trim() || (voucherClient && !isVoucherInfoComplete)}
                    >
                        제출
                    </Button>
                )}
            </div>
        </div>
    );
}

export default ClientRegistrationWizard;
