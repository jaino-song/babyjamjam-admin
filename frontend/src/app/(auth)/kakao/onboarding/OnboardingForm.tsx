"use client";


import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import {
    resolveFieldMessage,
    type FieldInputState,
} from "@babyjamjam/shared/utils/field-validation-message";
import { AuthPanel } from "@/components/auth/auth-panel";
import { FormField } from "@/components/auth/form-field";
import { SelectField } from "@/components/auth/select-field";
import { Button } from "@/components/ui/button";
import { useFieldInputStates } from "@/hooks/useFieldInputStates";
import { resolveElevenDigitPhoneMessage, toFieldMessageView, type FieldMessageView } from "@/lib/forms/field-message-text";
import { t } from "@/lib/i18n/translations";
import { normalizeKoreanPhoneDigits } from "@/lib/phone";
import { useLocale } from "@/providers/LocaleProvider";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { REGISTERABLE_ROLE_OPTIONS } from "@/lib/constants/roles";
import { kakaoOnboardingSchema, type KakaoOnboardingFormData } from "@/lib/validations/auth";
import { appendSafeReturnPath } from "@/lib/auth/safe-return-path";
import { completeKakaoOnboarding } from "./actions";

const PANEL_CLASS_NAME = "gap-5 !p-5 sm:!p-6 [&_[data-component='auth-kakao-onboarding-title']]:!text-[1.72rem] md:[&_[data-component='auth-kakao-onboarding-title']]:!text-[1.5rem] [&_[data-component='auth-kakao-onboarding-subtitle']]:!max-w-[34ch] [&_[data-component='auth-kakao-onboarding-subtitle']]:!text-[0.82rem] md:[&_[data-component='auth-kakao-onboarding-subtitle']]:!text-[0.76rem]";
const PRIMARY_BUTTON_CLASS_NAME = "h-10 px-5 gap-1.5 text-[0.72rem] md:text-[0.77rem] font-bold";

interface OnboardingFormProps {
    email?: string;
    name?: string;
    profileImage?: string;
    phone?: string;
    birthDate?: string;
    role?: KakaoOnboardingFormData["role"];
    title?: string;
    subtitle?: string;
    returnPath?: string | null;
}

type OnboardingInputField = "phone" | "birthDate";

const ONBOARDING_FIELD_LABELS: Record<OnboardingInputField, string> = {
    phone: "전화번호",
    birthDate: "생년월일",
};

/** The same rule the onboarding schema applies: a birth date must be in the past. */
function isFutureBirthDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= Date.now();
}

function formatPhoneInput(value: string) {
    // Country-code input is normalized first; the mobile-only prefix policy stays.
    const digits = normalizeKoreanPhoneDigits(value).slice(0, 11);

    if (digits.length === 0) {
        return "";
    }

    if (digits[0] !== "0") {
        return "";
    }

    if (digits.length === 1) {
        return "0";
    }

    if (digits[1] !== "1") {
        return "0";
    }

    if (digits.length <= 3) {
        return digits;
    }

    if (digits.length <= 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }

    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function OnboardingForm({
    email,
    name,
    phone,
    birthDate,
    role,
    title = "카카오 가입 마무리",
    subtitle = "카카오에서 받은 계정 정보는 그대로 사용하고, 추가 정보만 입력해 주세요.",
    returnPath,
}: OnboardingFormProps) {
    const router = useRouter();
    const [formData, setFormData] = useState<Partial<KakaoOnboardingFormData>>({
        phone: phone ?? "",
        birthDate: birthDate ?? "",
        role: role ?? undefined,
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const locale = useLocale();
    const fields = useFieldInputStates<OnboardingInputField>();
    const formRef = useRef<HTMLFormElement>(null);
    const [rejectedSubmitCount, setRejectedSubmitCount] = useState(0);
    // Kakao prefills may already hold a value, so clearing one reports "required".
    const [prefilledFields] = useState<ReadonlySet<OnboardingInputField>>(
        () => new Set<OnboardingInputField>([
            ...(phone ? (["phone"] as const) : []),
            ...(birthDate ? (["birthDate"] as const) : []),
        ]),
    );

    /** The one message a field shows in its label-row slot; a schema complaint is the last resort. */
    const resolveInputMessage = (field: OnboardingInputField): FieldMessageView | null => {
        const value = formData[field] ?? "";
        const tracked = fields.stateOf(field, value);
        const state: FieldInputState = {
            ...tracked,
            hadValue: tracked.hadValue || prefilledFields.has(field),
        };
        const opts = { required: true, submitted: fields.submitted };
        const message = toFieldMessageView(
            locale,
            field === "phone"
                ? resolveElevenDigitPhoneMessage(state, opts)
                : resolveFieldMessage("date", state, opts),
            ONBOARDING_FIELD_LABELS[field],
        );
        if (message) return message;
        if (field === "birthDate" && isFutureBirthDate(value)) {
            return { tone: "error", text: t(locale, "form.validation.birthday-future") };
        }
        return errors[field] ? { tone: "error", text: errors[field] } : null;
    };
    const phoneMessage = resolveInputMessage("phone");
    const birthDateMessage = resolveInputMessage("birthDate");

    // After a refused submit, move focus to the first field that now shows an error.
    useEffect(() => {
        if (rejectedSubmitCount === 0) return;
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }, [rejectedSubmitCount]);

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setServerError(null);
        fields.setSubmitted(true);

        const result = kakaoOnboardingSchema.safeParse(formData);
        if (!result.success) {
            const nextErrors: Record<string, string> = {};
            result.error.issues.forEach((issue) => {
                const field = issue.path[0];
                if (typeof field === "string" && !nextErrors[field]) {
                    nextErrors[field] = issue.message;
                }
            });
            setErrors(nextErrors);
            setRejectedSubmitCount((count) => count + 1);
            return;
        }

        startTransition(async () => {
            const response = await completeKakaoOnboarding(result.data);
            if (!response.success) {
                // The server action already normalizes the failure through the
                // problem contract; render its copy verbatim.
                setServerError(response.error || "계정 정보를 저장하지 못했습니다.");
                return;
            }

            router.replace(appendSafeReturnPath("/login?authError=PENDING_APPROVAL", returnPath));
        });
    };

    const handleFieldChange = (field: keyof KakaoOnboardingFormData) => (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = field === "phone"
            ? formatPhoneInput(event.target.value)
            : field === "birthDate"
                ? formatIsoDateInput(event.target.value)
                : event.target.value;

        if (field === "phone" || field === "birthDate") {
            fields.onChange(field, formData[field] ?? "", value);
        }
        setFormData((prev) => ({ ...prev, [field]: value }));
        setErrors((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
        });
        setServerError(null);
    };

    const handleSelectChange = (field: keyof KakaoOnboardingFormData) => (value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setErrors((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
        });
        setServerError(null);
    };

    return (
        <AuthPanel
            data-component="desktop_auth_kakao-onboarding"
            dataComponents={{
                container: "desktop_auth_kakao-onboarding_container",
                card: "desktop_auth_kakao-onboarding_card",
                header: "desktop_auth_kakao-onboarding_header",
                title: "desktop_auth_kakao-onboarding_title",
                subtitle: "desktop_auth_kakao-onboarding_subtitle",
                content: "desktop_auth_kakao-onboarding_content",
            }}
            title={title}
            subtitle={subtitle}
            className={PANEL_CLASS_NAME}
            contentClassName="gap-[18px]"
        >
            {serverError && (
                <div data-component="desktop_auth_kakao-onboarding_alert">
                    <Alert variant="destructive" onClose={() => setServerError(null)}>
                        {serverError}
                    </Alert>
                </div>
            )}

            <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-[14px]" data-component="desktop_auth_kakao-onboarding_form">
                <FormField
                    label="이메일"
                    type="email"
                    value={email ?? ""}
                    readOnly
                    disabled
                    className="bg-v3-dim-white/80"
                    data-component="desktop_auth_kakao-onboarding_form_email-field"
                />
                <FormField
                    label="이름"
                    type="text"
                    value={name ?? ""}
                    readOnly
                    disabled
                    className="bg-v3-dim-white/80"
                    data-component="desktop_auth_kakao-onboarding_form_name-field"
                />
                <FormField
                    label="전화번호"
                    type="tel"
                    value={formData.phone}
                    onChange={handleFieldChange("phone")}
                    message={phoneMessage}
                    {...fields.focusProps("phone", formData.phone ?? "")}
                    inputMode="numeric"
                    maxLength={20}
                    placeholder="010-1234-5678"
                    disabled={isPending}
                    data-component="desktop_auth_kakao-onboarding_form_phone-field"
                />
                <FormField
                    label="생년월일"
                    type="text"
                    value={formData.birthDate}
                    onChange={handleFieldChange("birthDate")}
                    message={birthDateMessage}
                    {...fields.focusProps("birthDate", formData.birthDate ?? "")}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="1958-03-03"
                    disabled={isPending}
                    data-component="desktop_auth_kakao-onboarding_form_birthdate-field"
                />
                <SelectField
                    label="요청 권한"
                    value={formData.role}
                    onValueChange={handleSelectChange("role")}
                    options={REGISTERABLE_ROLE_OPTIONS}
                    placeholder="요청할 권한을 선택해주세요"
                    error={errors.role}
                    errorDisplay="inline"
                    disabled={isPending}
                    data-component="desktop_auth_kakao-onboarding_form_role-field"
                />

                <Button
                    type="submit"
                    variant="positive"
                    size="md"
                    className={PRIMARY_BUTTON_CLASS_NAME}
                    disabled={isPending}
                    data-component="desktop_auth_kakao-onboarding_form_submit-btn"
                >
                    {isPending ? <Spinner size="sm" /> : (
                        <>
                            가입 완료
                            <ChevronRight className="w-4 h-4" />
                        </>
                    )}
                </Button>
            </form>
        </AuthPanel>
    );
}
