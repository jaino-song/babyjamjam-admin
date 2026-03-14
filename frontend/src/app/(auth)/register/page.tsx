"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { Check, CheckCircle, ChevronLeft, ChevronRight, Link2 } from "lucide-react";
import { authApi } from "@/services/api";
import { api } from "@/lib/api/client";
import { registerSchema, checkPasswordStrength, type RegisterFormData } from "@/lib/validations/auth";
import { AuthPanel } from "@/components/auth/auth-panel";
import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { FormField } from "@/components/auth/form-field";
import { SelectField } from "@/components/auth/select-field";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { REGISTERABLE_ROLE_OPTIONS } from "@/lib/constants/roles";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const REGISTER_STEPS = [1, 2, 3] as const;

const ACCOUNT_FIELDS = ["email", "name", "password", "confirmPassword"] as const;
const PERSONAL_FIELDS = ["phone", "birthDate"] as const;
const BRANCH_FIELDS = ["organizationId", "role"] as const;
const REGISTER_CARD_CLASS_NAME = "gap-5 !p-5 sm:!p-6 [&_[data-component='auth-register-title']]:!text-[1.72rem] md:[&_[data-component='auth-register-title']]:!text-[1.5rem] [&_[data-component='auth-register-subtitle']]:!max-w-[30ch] [&_[data-component='auth-register-subtitle']]:!text-[0.82rem] md:[&_[data-component='auth-register-subtitle']]:!text-[0.76rem]";
const REGISTER_PRIMARY_BUTTON_CLASS_NAME = "h-10 px-5 gap-1.5 text-[0.72rem] md:text-[0.77rem] font-bold";
const REGISTER_SECONDARY_BUTTON_CLASS_NAME = "h-10 px-5 gap-1.5 text-[0.72rem] md:text-[0.77rem] font-semibold";
const REGISTER_PASSWORD_REQUIREMENTS_CLASS_NAME = "justify-center [&_li]:text-[0.78rem] [&_svg]:h-3.5 [&_svg]:w-3.5";
const REGISTER_SUBTITLE = "필수 정보를 단계별로 입력해 주세요.";
const PASSWORD_MISMATCH_ERROR = "비밀번호가 일치하지 않습니다.";
const PHONE_DUPLICATE_ERROR = "이미 존재하는 사용자 입니다.";

type RegisterField = keyof RegisterFormData;
type RegisterStep = 0 | 1 | 2;

const STEP_FIELDS: Record<RegisterStep, readonly RegisterField[]> = {
    0: ACCOUNT_FIELDS,
    1: PERSONAL_FIELDS,
    2: BRANCH_FIELDS,
};

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

function getConfirmPasswordMismatchError(password?: string, confirmPassword?: string) {
    if (!password || !confirmPassword) {
        return undefined;
    }

    return password === confirmPassword ? undefined : PASSWORD_MISMATCH_ERROR;
}

function DesktopRegisterStepIndicator({ currentStep }: { currentStep: number }) {
    return (
        <div
            data-component="auth-register-stepper-desktop"
            className="hidden md:flex items-center justify-center gap-0"
        >
            {REGISTER_STEPS.map((step, idx) => {
                const isCompleted = idx < currentStep;
                const isCurrent = idx === currentStep;

                return (
                    <div key={step} data-component="auth-register-stepper-desktop-item" className="contents">
                        <div
                            data-component="auth-register-stepper-desktop-step"
                            className={cn("flex items-center", isCurrent && "text-v3-primary", isCompleted && "text-v3-dark")}
                        >
                            <div
                                data-component="auth-register-stepper-desktop-circle"
                                className={cn(
                                    "flex h-7 w-7 items-center justify-center rounded-full text-[0.68rem] font-bold transition-all duration-300",
                                    isCompleted && "bg-v3-primary text-white shadow-[0_2px_8px_hsla(214,100%,34%,0.2)]",
                                    isCurrent && "bg-v3-primary text-white shadow-[0_2px_12px_hsla(214,100%,34%,0.3)] scale-110",
                                    !isCompleted && !isCurrent && "bg-v3-dim-white text-v3-text-muted border-2 border-v3-border",
                                )}
                            >
                                {isCompleted ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : idx + 1}
                            </div>
                        </div>

                        {idx < REGISTER_STEPS.length - 1 && (
                            <div
                                data-component="auth-register-stepper-desktop-connector"
                                className={cn(
                                    "mx-1.5 h-0.5 w-10 rounded-full",
                                    idx < currentStep ? "bg-v3-primary" : "bg-v3-border",
                                )}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function MobileRegisterStepIndicator({ currentStep }: { currentStep: number }) {
    const progress = ((currentStep + 1) / REGISTER_STEPS.length) * 100;

    return (
        <div data-component="auth-register-stepper-mobile" className="md:hidden">
            <div data-component="auth-register-stepper-mobile-header" className="mb-2 flex items-center justify-end">
                <span className="text-[0.64rem] font-semibold text-v3-text-muted">
                    {currentStep + 1} / {REGISTER_STEPS.length} 단계
                </span>
            </div>
            <div data-component="auth-register-stepper-mobile-track" className="h-1.5 w-full overflow-hidden rounded-full bg-v3-border">
                <div
                    data-component="auth-register-stepper-mobile-progress"
                    className="h-full rounded-full bg-gradient-to-r from-v3-primary to-blue-500 transition-all duration-400"
                    style={{
                        width: `${progress}%`,
                        transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
                    }}
                />
            </div>
        </div>
    );
}

export default function RegisterPage() {
    const router = useRouter();
    const [formData, setFormData] = useState<Partial<RegisterFormData>>({
        email: "",
        password: "",
        confirmPassword: "",
        name: "",
        phone: "",
        birthDate: "",
        organizationId: "",
        role: undefined,
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [accountsLinked, setAccountsLinked] = useState(false);
    const [organizations, setOrganizations] = useState<{ value: string; label: string }[]>([]);
    const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
    const [currentStep, setCurrentStep] = useState<RegisterStep>(0);
    const [isCheckingPhoneDuplicate, setIsCheckingPhoneDuplicate] = useState(false);
    const [isPhoneDuplicate, setIsPhoneDuplicate] = useState(false);

    const phoneDigits = (formData.phone ?? "").replace(/\D/g, "");

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

    useEffect(() => {
        if (phoneDigits.length !== 11) {
            setIsCheckingPhoneDuplicate(false);
            setIsPhoneDuplicate(false);
            setErrors((prev) => {
                if (prev.phone !== PHONE_DUPLICATE_ERROR) {
                    return prev;
                }
                const nextErrors = { ...prev };
                delete nextErrors.phone;
                return nextErrors;
            });
            return;
        }

        const abortController = new AbortController();

        setIsCheckingPhoneDuplicate(true);

        void api.get("/auth/check-phone", {
            params: { phone: phoneDigits },
            signal: abortController.signal,
        })
            .then((response) => {
                if (abortController.signal.aborted) {
                    return;
                }

                const exists = response.data?.exists === true;
                setIsPhoneDuplicate(exists);
                setErrors((prev) => {
                    const nextErrors = { ...prev };
                    if (exists) {
                        nextErrors.phone = PHONE_DUPLICATE_ERROR;
                    } else if (nextErrors.phone === PHONE_DUPLICATE_ERROR) {
                        delete nextErrors.phone;
                    }
                    return nextErrors;
                });
            })
            .catch(() => {
                if (abortController.signal.aborted) {
                    return;
                }
                setIsPhoneDuplicate(false);
            })
            .finally(() => {
                if (!abortController.signal.aborted) {
                    setIsCheckingPhoneDuplicate(false);
                }
            });

        return () => {
            abortController.abort();
            setIsCheckingPhoneDuplicate(false);
        };
    }, [phoneDigits]);

    const passwordStrength = checkPasswordStrength(formData.password || "");

    const clearFieldErrors = (fields: readonly RegisterField[]) => {
        setErrors((prev) => {
            const nextErrors = { ...prev };
            fields.forEach((field) => {
                delete nextErrors[field];
            });
            return nextErrors;
        });
    };

    const collectFieldErrors = (
        issues: { path: PropertyKey[]; message: string }[],
        fields?: readonly RegisterField[],
    ) => {
        const allowedFields = fields ? new Set<string>(fields) : null;
        const nextErrors: Record<string, string> = {};

        issues.forEach((issue) => {
            const field = issue.path[0];
            if (typeof field !== "string") {
                return;
            }
            if (allowedFields && !allowedFields.has(field)) {
                return;
            }
            if (!nextErrors[field]) {
                nextErrors[field] = issue.message;
            }
        });

        return nextErrors;
    };

    const validateStep = (step: RegisterStep) => {
        const fields = STEP_FIELDS[step];
        const result = registerSchema.safeParse(formData);
        const fieldErrors = result.success ? {} : collectFieldErrors(result.error.issues, fields);

        if (step === 1 && phoneDigits.length === 11) {
            if (isCheckingPhoneDuplicate) {
                return false;
            }

            if (isPhoneDuplicate) {
                fieldErrors.phone = PHONE_DUPLICATE_ERROR;
            }
        }

        setErrors((prev) => {
            const nextErrors = { ...prev };
            fields.forEach((field) => {
                delete nextErrors[field];
            });
            return { ...nextErrors, ...fieldErrors };
        });

        return Object.keys(fieldErrors).length === 0;
    };

    const handleChange = (field: keyof RegisterFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        const nextFormData = { ...formData, [field]: value };

        setFormData(nextFormData);
        setErrors((prev) => {
            const newErrors = { ...prev };
            delete newErrors[field];

            if (field === "password" || field === "confirmPassword") {
                const mismatchError = getConfirmPasswordMismatchError(
                    nextFormData.password,
                    nextFormData.confirmPassword,
                );

                if (mismatchError) {
                    newErrors.confirmPassword = mismatchError;
                } else if (newErrors.confirmPassword === PASSWORD_MISMATCH_ERROR) {
                    delete newErrors.confirmPassword;
                }
            }

            return newErrors;
        });
        setServerError(null);
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = formatPhoneInput(e.target.value);

        setFormData((prev) => ({ ...prev, phone: value }));
        setErrors((prev) => {
            const nextErrors = { ...prev };
            delete nextErrors.phone;
            return nextErrors;
        });
        setIsPhoneDuplicate(false);
        setServerError(null);
    };

    const handleBirthDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedBirthDate = formatBirthDateInput(e.target.value);
        setFormData((prev) => ({ ...prev, birthDate: formattedBirthDate }));

        if (errors.birthDate) {
            setErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors.birthDate;
                return newErrors;
            });
        }

        setServerError(null);
    };

    const handleSelectChange = (field: keyof RegisterFormData) => (value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
        setServerError(null);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setServerError(null);

        if (currentStep < REGISTER_STEPS.length - 1) {
            if (validateStep(currentStep)) {
                const nextStep = (currentStep + 1) as RegisterStep;
                clearFieldErrors(STEP_FIELDS[nextStep]);
                setCurrentStep(nextStep);
            }
            return;
        }

        // Validate with Zod
        const result = registerSchema.safeParse(formData);
        if (!result.success) {
            const fieldErrors = collectFieldErrors(result.error.issues);
            setErrors(fieldErrors);
            if (ACCOUNT_FIELDS.some((field) => fieldErrors[field])) {
                setCurrentStep(0);
            } else if (PERSONAL_FIELDS.some((field) => fieldErrors[field])) {
                setCurrentStep(1);
            } else {
                setCurrentStep(2);
            }
            return;
        }

        setIsLoading(true);

        try {
            const response = await authApi.register({
                email: result.data.email,
                password: result.data.password,
                name: result.data.name,
                phone: result.data.phone,
                birthDate: result.data.birthDate,
                organizationId: result.data.organizationId,
                role: result.data.role,
            });

            if (response.success) {
                // Check if accounts were linked (Kakao + email now both available)
                if (response.code === 'ACCOUNTS_LINKED') {
                    setAccountsLinked(true);
                }
                setIsSuccess(true);
            } else {
                if (response.code === "P2002" && response.message?.includes("phone")) {
                    setErrors((prev) => ({ ...prev, phone: PHONE_DUPLICATE_ERROR }));
                    setCurrentStep(0);
                    return;
                }
                setServerError(response.message || "회원가입에 실패했습니다.");
            }
        } catch (err: unknown) {
            console.error("Registration error:", err);
            // Check if this is an axios error with response data
            const errorData = axios.isAxiosError(err) ? err.response?.data : undefined;
            if (errorData?.code === "P2002" && (errorData?.field === "phone" || errorData?.message?.includes("phone"))) {
                setErrors((prev) => ({ ...prev, phone: PHONE_DUPLICATE_ERROR }));
                setCurrentStep(1);
            } else if (errorData?.errors) {
                // Password validation errors from backend
                setServerError(errorData.errors.join('\n'));
            } else if (errorData?.message) {
                setServerError(errorData.message);
            } else {
                setServerError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handlePreviousStep = () => {
        const previousStep = Math.max(currentStep - 1, 0) as RegisterStep;
        clearFieldErrors(STEP_FIELDS[currentStep]);
        setServerError(null);
        setCurrentStep(previousStep);
    };

    const getCardTitle = () => {
        if (!isSuccess) return "회원가입";
        return accountsLinked ? "계정이 연결되었습니다!" : "회원가입 완료!";
    };

    const showConfirmPasswordMismatch = errors.confirmPassword === PASSWORD_MISMATCH_ERROR;
    const showPhoneDuplicateWarning = errors.phone === PHONE_DUPLICATE_ERROR;
    const hasStepOneRequirements =
        Boolean(formData.email?.trim()) &&
        Boolean(formData.name?.trim()) &&
        Boolean(formData.password) &&
        Boolean(formData.confirmPassword) &&
        passwordStrength.isValid &&
        !showConfirmPasswordMismatch &&
        !errors.email &&
        !errors.name &&
        !errors.password;
    const hasStepTwoRequirements =
        phoneDigits.length === 11 &&
        Boolean(formData.birthDate) &&
        !errors.birthDate &&
        !showPhoneDuplicateWarning &&
        !isPhoneDuplicate &&
        !isCheckingPhoneDuplicate;
    const hasStepThreeRequirements =
        Boolean(formData.organizationId) &&
        Boolean(formData.role) &&
        !isLoadingOrgs &&
        !errors.organizationId &&
        !errors.role;
    const isCurrentStepActionDisabled =
        currentStep === 0
            ? !hasStepOneRequirements
            : currentStep === 1
                ? !hasStepTwoRequirements
                : !hasStepThreeRequirements;

    if (isSuccess) {
        return (
            <AuthPanel
                data-component="auth-register"
                dataComponents={{
                    container: "auth-register-container",
                    card: "auth-register-card",
                    header: "auth-register-header",
                    title: "auth-register-title",
                    subtitle: "auth-register-subtitle",
                    content: "auth-register-content",
                }}
                title={getCardTitle()}
                subtitle="이메일 인증 후 로그인을 진행해 주세요."
                className={REGISTER_CARD_CLASS_NAME}
                contentClassName="items-center text-center"
            >
                {accountsLinked ? (
                    <>
                        <div data-component="auth-register-success-icon" className="rounded-full bg-primary/10 p-3">
                            <Link2 className="h-12 w-12 text-primary" />
                        </div>
                        <p data-component="auth-register-success-message" className="text-muted-foreground">
                            기존 카카오 계정에 비밀번호가 추가되었습니다.
                            <br />
                            이메일을 확인하여 계정을 활성화하면
                            <br />
                            카카오와 이메일 모두로 로그인할 수 있습니다.
                        </p>
                    </>
                ) : (
                    <>
                        <div data-component="auth-register-success-icon" className="rounded-full bg-success/10 p-3">
                            <CheckCircle className="h-12 w-12 text-success" />
                        </div>
                        <p data-component="auth-register-success-message" className="text-muted-foreground">
                            인증 이메일이 발송되었습니다.
                            <br />
                            이메일을 확인하여 계정을 활성화해 주세요.
                        </p>
                    </>
                )}

                <Button
                    data-component="auth-register-success-login-btn"
                    variant="positive"
                    size="md"
                    className={cn("w-full", REGISTER_PRIMARY_BUTTON_CLASS_NAME)}
                    onClick={() => router.push("/login")}
                >
                    로그인 페이지로 이동
                </Button>
            </AuthPanel>
        );
    }

    return (
            <AuthPanel
                data-component="auth-register"
                dataComponents={{
                    container: "auth-register-container",
                    card: "auth-register-card",
                header: "auth-register-header",
                title: "auth-register-title",
                subtitle: "auth-register-subtitle",
                content: "auth-register-content",
                }}
                title="회원가입"
                subtitle={REGISTER_SUBTITLE}
                className={REGISTER_CARD_CLASS_NAME}
                contentClassName="gap-[18px]"
            >
            <DesktopRegisterStepIndicator currentStep={currentStep} />
            <MobileRegisterStepIndicator currentStep={currentStep} />

            {serverError && (
                <div data-component="auth-register-alert">
                    <Alert variant="destructive" onClose={() => setServerError(null)}>
                        {serverError}
                    </Alert>
                </div>
            )}

            <form
                onSubmit={handleSubmit}
                data-component="auth-register-form"
                className="flex flex-col gap-[18px] [&_label]:text-[0.82rem] [&_p]:leading-[1.45]"
            >
                <div
                    key={currentStep}
                    data-component={`auth-register-step-${currentStep + 1}`}
                    className="animate-fade-in"
                >
                    <div
                        data-component="auth-register-step-title"
                        className="mb-3 text-[0.64rem] font-semibold uppercase tracking-[0.1em] text-v3-text-muted md:mb-4"
                    >
                        {currentStep + 1}단계
                    </div>

                    <div data-component="auth-register-step-fields" className="flex flex-col gap-[14px]">
                        {currentStep === 0 ? (
                            <>
                                <FormField
                                    label="이메일"
                                    type="email"
                                    value={formData.email}
                                    onChange={handleChange("email")}
                                    error={errors.email}
                                    errorDisplay="inline"
                                    disabled={isLoading}
                                    autoComplete="email"
                                    data-component="auth-register-email-field"
                                />

                                <FormField
                                    label="이름"
                                    type="text"
                                    value={formData.name}
                                    onChange={handleChange("name")}
                                    error={errors.name}
                                    errorDisplay="inline"
                                    disabled={isLoading}
                                    autoComplete="name"
                                    data-component="auth-register-name-field"
                                />

                                <FormField
                                    label="비밀번호"
                                    type="password"
                                    value={formData.password}
                                    onChange={handleChange("password")}
                                    error={errors.password}
                                    errorDisplay="inline"
                                    disabled={isLoading}
                                    autoComplete="new-password"
                                    data-component="auth-register-password-field"
                                />

                                <div
                                    data-component="auth-register-password-requirements-wrap"
                                    className={cn(
                                        "grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-out",
                                        formData.password
                                            ? "mt-0 grid-rows-[1fr] opacity-100"
                                            : "mt-[-6px] grid-rows-[0fr] opacity-0",
                                    )}
                                >
                                    <div
                                        data-component="auth-register-password-requirements-inner"
                                        className="overflow-hidden"
                                    >
                                        <PasswordRequirements
                                            requirements={passwordStrength.requirements}
                                            orientation="horizontal"
                                            className={REGISTER_PASSWORD_REQUIREMENTS_CLASS_NAME}
                                        />
                                    </div>
                                </div>

                                <FormField
                                    label="비밀번호 확인"
                                    type="password"
                                    value={formData.confirmPassword}
                                    onChange={handleChange("confirmPassword")}
                                    error={errors.confirmPassword}
                                    errorDisplay="inline"
                                    disabled={isLoading}
                                    autoComplete="new-password"
                                    data-component="auth-register-confirm-field"
                                />
                            </>
                        ) : currentStep === 1 ? (
                            <>

                                <FormField
                                    label="전화번호"
                                    type="tel"
                                    value={formData.phone}
                                    onChange={handlePhoneChange}
                                    error={errors.phone}
                                    errorDisplay="inline"
                                    disabled={isLoading}
                                    autoComplete="tel"
                                    inputMode="numeric"
                                    maxLength={13}
                                    placeholder="010-1234-5678"
                                    data-component="auth-register-phone-field"
                                />

                                <FormField
                                    label="생년월일"
                                    type="text"
                                    value={formData.birthDate}
                                    onChange={handleBirthDateChange}
                                    error={errors.birthDate}
                                    errorDisplay="inline"
                                    disabled={isLoading}
                                    autoComplete="bday"
                                    inputMode="numeric"
                                    maxLength={10}
                                    placeholder="1990-01-01"
                                    data-component="auth-register-birthdate-field"
                                />
                            </>
                        ) : (
                            <>
                                <SelectField
                                    label="지점명"
                                    value={formData.organizationId}
                                    onValueChange={handleSelectChange("organizationId")}
                                    options={organizations}
                                    placeholder={isLoadingOrgs ? "지점 목록 불러오는 중..." : "지점을 선택해주세요"}
                                    error={errors.organizationId}
                                    errorDisplay="inline"
                                    disabled={isLoading || isLoadingOrgs}
                                    data-component="auth-register-organization-field"
                                />

                                <SelectField
                                    label="역할"
                                    value={formData.role}
                                    onValueChange={handleSelectChange("role")}
                                    options={REGISTERABLE_ROLE_OPTIONS}
                                    placeholder="역할을 선택해주세요"
                                    error={errors.role}
                                    errorDisplay="inline"
                                    disabled={isLoading}
                                    data-component="auth-register-role-field"
                                />
                            </>
                        )}
                    </div>
                </div>

                <div
                    data-component="auth-register-actions"
                    className="mt-1 flex items-center justify-between border-t border-v3-border pt-3"
                >
                    <Button
                        data-component="auth-register-prev-btn"
                        type="button"
                        variant="neutral"
                        size="md"
                        className={cn(
                            REGISTER_SECONDARY_BUTTON_CLASS_NAME,
                            currentStep === 0 && "opacity-0 pointer-events-none",
                        )}
                        onClick={handlePreviousStep}
                        disabled={isLoading || currentStep === 0}
                    >
                        <ChevronLeft className="w-4 h-4" />
                        이전
                    </Button>

                    <span className="hidden text-[0.68rem] font-semibold text-v3-text-muted md:block">
                        {currentStep + 1} / {REGISTER_STEPS.length} 단계
                    </span>

                    <Button
                        data-component={currentStep < REGISTER_STEPS.length - 1 ? "auth-register-next-btn" : "auth-register-submit-btn"}
                        type="submit"
                        variant="positive"
                        size="md"
                        className={cn(
                            REGISTER_PRIMARY_BUTTON_CLASS_NAME,
                            currentStep < REGISTER_STEPS.length - 1 ? "w-auto" : "flex-1 md:flex-none md:min-w-[132px]",
                        )}
                        disabled={isLoading || isCurrentStepActionDisabled}
                    >
                        {currentStep < REGISTER_STEPS.length - 1 ? (
                            <>
                                다음
                                <ChevronRight className="w-4 h-4" />
                            </>
                        ) : isLoading ? (
                            <Spinner size="sm" />
                        ) : (
                            "회원가입"
                        )}
                    </Button>
                </div>
            </form>

            <AuthInlineLink
                dataComponent="auth-register-login-link"
                href="/login"
                prefixText="이미 계정이 있으신가요?"
                linkLabel="로그인"
                paragraphClassName="text-[0.82rem]"
                linkClassName="text-[0.82rem]"
            />
        </AuthPanel>
    );
}
