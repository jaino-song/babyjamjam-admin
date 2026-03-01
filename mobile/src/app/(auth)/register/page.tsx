"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Link2 } from "lucide-react";
import { authApi } from "@/services/api";
import { registerSchema, checkPasswordStrength, type RegisterFormData } from "@/lib/validations/auth";
import { CardContainer } from "@/components/auth/card-container";
import { FormField } from "@/components/auth/form-field";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

const LABEL_CLS = "text-[0.85rem] font-semibold text-v3-dark";
const PRIMARY_BTN_CLS =
  "h-[50px] rounded-2xl border-none bg-v3-primary text-[0.85rem] font-bold text-white shadow-[0_2px_8px_hsla(214,100%,34%,0.2)] transition-all hover:bg-v3-primary-hover hover:-translate-y-px";

interface RegisterErrorData {
    errors?: string[];
    message?: string;
}

interface AxiosLikeError {
    response?: {
        data?: RegisterErrorData;
    };
}

export default function RegisterPage() {
    const router = useRouter();
    const [formData, setFormData] = useState<Partial<RegisterFormData>>({
        email: "",
        password: "",
        confirmPassword: "",
        name: "",
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [accountsLinked, setAccountsLinked] = useState(false);

    const passwordStrength = checkPasswordStrength(formData.password || "");

    const handleChange = (field: keyof RegisterFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({ ...prev, [field]: e.target.value }));
        // Clear field error on change
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
        setErrors({});

        // Validate with Zod
        const result = registerSchema.safeParse(formData);
        if (!result.success) {
            const fieldErrors: Record<string, string> = {};
            result.error.issues.forEach((issue) => {
                const field = issue.path[0] as string;
                if (!fieldErrors[field]) {
                    fieldErrors[field] = issue.message;
                }
            });
            setErrors(fieldErrors);
            return;
        }

        setIsLoading(true);

        try {
            const response = await authApi.register(
                result.data.email,
                result.data.password,
                result.data.name
            );

            if (response.success) {
                // Check if accounts were linked (Kakao + email now both available)
                if (response.code === 'ACCOUNTS_LINKED') {
                    setAccountsLinked(true);
                }
                setIsSuccess(true);
            } else {
                setServerError(response.message || "회원가입에 실패했습니다.");
            }
        } catch (err: unknown) {
            console.error("Registration error:", err);
            const errorData =
                typeof err === "object" && err !== null && "response" in err
                    ? (err as AxiosLikeError).response?.data
                    : undefined;
            if (errorData?.errors) {
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

    const cardTitle = isSuccess
        ? (accountsLinked ? "계정이 연결되었습니다!" : "회원가입 완료!")
        : "회원가입";

    return (
        <CardContainer
            title={cardTitle}
            subtitle={!isSuccess ? "아래의 항목들을 작성해 주세요" : undefined}
            data-component="auth-register"
            className="border-[1.5px] border-v3-border [&_[data-component='auth-register-header']]:mb-4 [&_[data-component='auth-register-header']]:flex [&_[data-component='auth-register-header']]:flex-col [&_[data-component='auth-register-header']]:items-center [&_[data-component='auth-register-header']]:gap-1 [&_[data-component='auth-register-title']]:!mb-0 [&_[data-component='auth-register-subtitle']]:!mb-0 md:[&_[data-component='auth-register-subtitle']]:!mb-0"
        >
            {isSuccess ? (
                <div data-component="auth-register-success" className="flex flex-col items-center space-y-4 text-center">
                    {accountsLinked ? (
                        <>
                            <div data-component="auth-register-success-icon" className="rounded-full bg-v3-primary-light p-3">
                                <Link2 className="h-12 w-12 text-v3-primary" />
                            </div>
                            <p className="text-[0.85rem] text-v3-text-muted leading-relaxed">
                                기존 카카오 계정에 비밀번호가 추가되었습니다.
                                <br />
                                이메일을 확인하여 계정을 활성화하면
                                <br />
                                카카오와 이메일 모두로 로그인할 수 있습니다.
                            </p>
                        </>
                    ) : (
                        <>
                            <div data-component="auth-register-success-icon" className="rounded-full bg-v3-green-light p-3">
                                <CheckCircle className="h-12 w-12 text-v3-green" />
                            </div>
                            <p className="text-[0.85rem] text-v3-text-muted leading-relaxed">
                                인증 이메일이 발송되었습니다.
                                <br />
                                이메일을 확인하여 계정을 활성화해 주세요.
                            </p>
                        </>
                    )}
                    <Button
                        data-component="auth-register-success-login-btn"
                        size="lg"
                        className={PRIMARY_BTN_CLS + " w-full mt-4"}
                        onClick={() => router.push("/login")}
                    >
                        로그인 페이지로 이동
                    </Button>
                </div>
            ) : (
                <div data-component="auth-register-content" className="space-y-6">
                    {serverError && (
                        <Alert variant="destructive" onClose={() => setServerError(null)}>
                            {serverError}
                        </Alert>
                    )}

                    <form onSubmit={handleSubmit} data-component="auth-register-form" className="space-y-4">
                        <FormField
                            label="이메일"
                            type="email"
                            value={formData.email}
                            onChange={handleChange("email")}
                            error={errors.email}
                            disabled={isLoading}
                            autoComplete="email"
                            variant="v3"
                            className="h-[50px]"
                            labelClassName={LABEL_CLS}
                            data-component="auth-register-email-field"
                        />

                        <FormField
                            label="이름"
                            type="text"
                            value={formData.name}
                            onChange={handleChange("name")}
                            error={errors.name}
                            disabled={isLoading}
                            autoComplete="name"
                            variant="v3"
                            className="h-[50px]"
                            labelClassName={LABEL_CLS}
                            data-component="auth-register-name-field"
                        />

                        <FormField
                            label="비밀번호"
                            type="password"
                            value={formData.password}
                            onChange={handleChange("password")}
                            error={errors.password}
                            disabled={isLoading}
                            autoComplete="new-password"
                            variant="v3"
                            className="h-[50px]"
                            labelClassName={LABEL_CLS}
                            data-component="auth-register-password-field"
                        />

                        {formData.password && (
                            <PasswordRequirements
                                requirements={passwordStrength.requirements}
                                className="animate-fade-in"
                            />
                        )}

                        <FormField
                            label="비밀번호 확인"
                            type="password"
                            value={formData.confirmPassword}
                            onChange={handleChange("confirmPassword")}
                            error={errors.confirmPassword}
                            disabled={isLoading}
                            autoComplete="new-password"
                            variant="v3"
                            className="h-[50px]"
                            labelClassName={LABEL_CLS}
                            data-component="auth-register-confirm-field"
                        />

                        <Button
                            data-component="auth-register-submit-btn"
                            type="submit"
                            size="lg"
                            className={PRIMARY_BTN_CLS + " w-full mt-2"}
                            disabled={isLoading}
                        >
                            {isLoading ? <Spinner size="sm" /> : "회원가입"}
                        </Button>
                    </form>

                    <p className="text-center text-sm text-muted-foreground">
                        이미 계정이 있으신가요?{" "}
                        <Link
                            href="/login"
                            className="text-primary font-medium hover:underline"
                            data-component="auth-register-login-link"
                        >
                            로그인
                        </Link>
                    </p>
                </div>
            )}
        </CardContainer>
    );
}
