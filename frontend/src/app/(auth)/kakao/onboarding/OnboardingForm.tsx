"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { AuthPanel } from "@/components/auth/auth-panel";
import { FormField } from "@/components/auth/form-field";
import { SelectField } from "@/components/auth/select-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { REGISTERABLE_ROLE_OPTIONS } from "@/lib/constants/roles";
import { authApi } from "@/services/api";
import { kakaoOnboardingSchema, type KakaoOnboardingFormData } from "@/lib/validations/auth";
import { completeKakaoOnboarding } from "./actions";
import { completeAccountOnboarding } from "../../onboarding/actions";

const PANEL_CLASS_NAME = "gap-5 !p-5 sm:!p-6 [&_[data-component='auth-kakao-onboarding-title']]:!text-[1.72rem] md:[&_[data-component='auth-kakao-onboarding-title']]:!text-[1.5rem] [&_[data-component='auth-kakao-onboarding-subtitle']]:!max-w-[34ch] [&_[data-component='auth-kakao-onboarding-subtitle']]:!text-[0.82rem] md:[&_[data-component='auth-kakao-onboarding-subtitle']]:!text-[0.76rem]";
const PRIMARY_BUTTON_CLASS_NAME = "h-10 px-5 gap-1.5 text-[0.72rem] md:text-[0.77rem] font-bold";

interface OnboardingFormProps {
    email?: string;
    name?: string;
    profileImage?: string;
    phone?: string;
    birthDate?: string;
    organizationId?: string;
    role?: KakaoOnboardingFormData["role"];
    mode?: "kakao" | "account";
    title?: string;
    subtitle?: string;
}

function formatBirthDateInput(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 8);

    if (digits.length <= 4) {
        return digits;
    }

    if (digits.length <= 6) {
        return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    }

    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function formatPhoneInput(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);

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
    organizationId,
    role,
    mode = "kakao",
    title = "카카오 가입 마무리",
    subtitle = "카카오에서 받은 계정 정보는 그대로 사용하고, 추가 정보만 입력해 주세요.",
}: OnboardingFormProps) {
    const router = useRouter();
    const [formData, setFormData] = useState<Partial<KakaoOnboardingFormData>>({
        phone: phone ?? "",
        birthDate: birthDate ?? "",
        organizationId: organizationId ?? "",
        role: role ?? undefined,
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [organizations, setOrganizations] = useState<{ value: string; label: string }[]>([]);
    const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
    const [isPending, startTransition] = useTransition();

    useEffect(() => {
        authApi.getOrganizations()
            .then((orgs) => {
                setOrganizations(orgs.map((org) => ({ value: org.id, label: org.name })));
            })
            .catch(() => {
                setOrganizations([]);
            })
            .finally(() => setIsLoadingOrgs(false));
    }, []);

    const isDisabled = useMemo(() => {
        const result = kakaoOnboardingSchema.safeParse(formData);
        return !result.success || isPending || isLoadingOrgs;
    }, [formData, isLoadingOrgs, isPending]);

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setServerError(null);

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
            return;
        }

        startTransition(async () => {
            const response = mode === "kakao"
                ? await completeKakaoOnboarding(result.data)
                : await completeAccountOnboarding(result.data);
            if (!response.success) {
                setServerError(response.error || "계정 정보를 저장하지 못했습니다.");
                return;
            }

            if (response.requiresOrgSelection) {
                router.replace("/select-organization");
                return;
            }

            router.replace("/dashboard");
        });
    };

    const handleFieldChange = (field: keyof KakaoOnboardingFormData) => (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = field === "phone"
            ? formatPhoneInput(event.target.value)
            : field === "birthDate"
                ? formatBirthDateInput(event.target.value)
                : event.target.value;

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
            data-component="auth-kakao-onboarding"
            dataComponents={{
                container: "auth-kakao-onboarding-container",
                card: "auth-kakao-onboarding-card",
                header: "auth-kakao-onboarding-header",
                title: "auth-kakao-onboarding-title",
                subtitle: "auth-kakao-onboarding-subtitle",
                content: "auth-kakao-onboarding-content",
            }}
            title={title}
            subtitle={subtitle}
            className={PANEL_CLASS_NAME}
            contentClassName="gap-[18px]"
        >
            {serverError && (
                <div data-component="auth-kakao-onboarding-alert">
                    <Alert variant="destructive" onClose={() => setServerError(null)}>
                        {serverError}
                    </Alert>
                </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]" data-component="auth-kakao-onboarding-form">
                <FormField
                    label="이메일"
                    type="email"
                    value={email ?? ""}
                    readOnly
                    disabled
                    className="bg-v3-dim-white/80"
                    data-component="auth-kakao-onboarding-email-field"
                />
                <FormField
                    label="이름"
                    type="text"
                    value={name ?? ""}
                    readOnly
                    disabled
                    className="bg-v3-dim-white/80"
                    data-component="auth-kakao-onboarding-name-field"
                />
                <FormField
                    label="전화번호"
                    type="tel"
                    value={formData.phone}
                    onChange={handleFieldChange("phone")}
                    error={errors.phone}
                    inputMode="numeric"
                    maxLength={13}
                    placeholder="010-1234-5678"
                    disabled={isPending}
                    data-component="auth-kakao-onboarding-phone-field"
                />
                <FormField
                    label="생년월일"
                    type="text"
                    value={formData.birthDate}
                    onChange={handleFieldChange("birthDate")}
                    error={errors.birthDate}
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="1990-01-01"
                    disabled={isPending}
                    data-component="auth-kakao-onboarding-birthdate-field"
                />
                <SelectField
                    label="지점명"
                    value={formData.organizationId}
                    onValueChange={handleSelectChange("organizationId")}
                    options={organizations}
                    placeholder={isLoadingOrgs ? "지점 목록 불러오는 중..." : "지점을 선택해주세요"}
                    error={errors.organizationId}
                    disabled={isPending || isLoadingOrgs}
                    data-component="auth-kakao-onboarding-organization-field"
                />
                <SelectField
                    label="역할"
                    value={formData.role}
                    onValueChange={handleSelectChange("role")}
                    options={REGISTERABLE_ROLE_OPTIONS}
                    placeholder="역할을 선택해주세요"
                    error={errors.role}
                    disabled={isPending}
                    data-component="auth-kakao-onboarding-role-field"
                />

                <Button
                    type="submit"
                    variant="positive"
                    size="md"
                    className={PRIMARY_BUTTON_CLASS_NAME}
                    disabled={isDisabled}
                    data-component="auth-kakao-onboarding-submit-btn"
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
