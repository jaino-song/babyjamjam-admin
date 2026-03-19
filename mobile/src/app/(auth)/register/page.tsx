"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Link2 } from "lucide-react";
import { authApi } from "@/services/api";
import { registerSchema, checkPasswordStrength, getEmailFormatError, sanitizeNameInput, type RegisterFormData } from "@/lib/validations/auth";
import { CardContainer } from "@/components/auth/card-container";
import { InputField } from "@/components/app/v3";
import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

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

const EMAIL_DUPLICATE_ERROR = "이미 등록된 이메일입니다.";

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
    const [isCheckingEmailDuplicate, setIsCheckingEmailDuplicate] = useState(false);
    const [isEmailDuplicate, setIsEmailDuplicate] = useState(false);
    const [emailTouched, setEmailTouched] = useState(false);

    const passwordStrength = checkPasswordStrength(formData.password || "");
    const normalizedEmail = (formData.email ?? "").trim().toLowerCase();
    const emailFormatError = getEmailFormatError(formData.email ?? "");

    useEffect(() => {
        if (!normalizedEmail || emailFormatError) {
            setIsCheckingEmailDuplicate(false);
            setIsEmailDuplicate(false);
            setErrors((prev) => {
                if (prev.email !== EMAIL_DUPLICATE_ERROR) {
                    return prev;
                }

                const nextErrors = { ...prev };
                delete nextErrors.email;
                return nextErrors;
            });
            return;
        }

        let isCancelled = false;
        const timeoutId = window.setTimeout(() => {
            setIsCheckingEmailDuplicate(true);

            void authApi.checkEmailExists(normalizedEmail)
                .then(({ exists, linkable }) => {
                    if (isCancelled) {
                        return;
                    }

                    const isDuplicate = exists && !linkable;
                    setIsEmailDuplicate(isDuplicate);
                    setErrors((prev) => {
                        const nextErrors = { ...prev };
                        if (isDuplicate) {
                            nextErrors.email = EMAIL_DUPLICATE_ERROR;
                        } else if (nextErrors.email === EMAIL_DUPLICATE_ERROR) {
                            delete nextErrors.email;
                        }
                        return nextErrors;
                    });
                })
                .catch(() => {
                    if (!isCancelled) {
                        setIsEmailDuplicate(false);
                        setErrors((prev) => {
                            if (prev.email !== EMAIL_DUPLICATE_ERROR) {
                                return prev;
                            }

                            const nextErrors = { ...prev };
                            delete nextErrors.email;
                            return nextErrors;
                        });
                    }
                })
                .finally(() => {
                    if (!isCancelled) {
                        setIsCheckingEmailDuplicate(false);
                    }
                });
        }, 250);

        return () => {
            isCancelled = true;
            window.clearTimeout(timeoutId);
            setIsCheckingEmailDuplicate(false);
        };
    }, [normalizedEmail, emailFormatError]);

    const handleChange = (field: keyof RegisterFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = field === "name" ? sanitizeNameInput(e.target.value) : e.target.value;
        const nextEmailError = field === "email" ? getEmailFormatError(value) : undefined;
        setFormData((prev) => ({ ...prev, [field]: value }));
        // Clear field error on change
        if (errors[field]) {
            setErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[field];
                if (field === "email" && (emailTouched || Boolean(prev.email)) && nextEmailError) {
                    newErrors.email = nextEmailError;
                }
                return newErrors;
            });
        } else if (field === "email" && emailTouched && nextEmailError) {
            setErrors((prev) => ({ ...prev, email: nextEmailError }));
        }
        setServerError(null);
    };

    const handleEmailBlur = () => {
        setEmailTouched(true);

        const emailError = getEmailFormatError(formData.email ?? "");

        if (!emailError) {
            return;
        }

        setErrors((prev) => ({ ...prev, email: emailError }));
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setServerError(null);

        if (isCheckingEmailDuplicate) {
            return;
        }

        if (isEmailDuplicate) {
            setErrors((prev) => ({ ...prev, email: EMAIL_DUPLICATE_ERROR }));
            return;
        }

        setErrors((prev) => {
            const nextErrors = { ...prev };
            if (nextErrors.email === EMAIL_DUPLICATE_ERROR) {
                delete nextErrors.email;
            }
            return nextErrors;
        });

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
            className="border-[1.5px] border-v3-border"
        >
            {isSuccess ? (
                <div data-component="auth-register-success" className="flex flex-col items-center gap-4 text-center">
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
                        className={PRIMARY_BTN_CLS + " w-full"}
                        onClick={() => router.push("/login")}
                    >
                        로그인 페이지로 이동
                    </Button>
                </div>
            ) : (
                <div data-component="auth-register-body" className="flex flex-col gap-6">
                    {serverError && (
                        <Alert variant="destructive" onClose={() => setServerError(null)}>
                            {serverError}
                        </Alert>
                    )}

                    <form onSubmit={handleSubmit} data-component="auth-register-form" className="flex flex-col gap-4">
                        <InputField
                            title="이메일"
                            message={errors.email}
                            messageTone="error"
                            messageId={errors.email ? "register-email-error" : undefined}
                            className="gap-2"
                            inputClassName={errors.email ? "border-destructive focus:border-destructive" : "h-[50px]"}
                            inputProps={{
                                id: "register-email",
                                type: "email",
                                value: formData.email,
                                onChange: handleChange("email"),
                                onBlur: handleEmailBlur,
                                disabled: isLoading,
                                autoComplete: "email",
                                "aria-invalid": !!errors.email,
                                "aria-describedby": errors.email ? "register-email-error" : undefined,
                            }}
                        />

                        <InputField
                            title="이름"
                            message={errors.name}
                            messageTone="error"
                            messageId={errors.name ? "register-name-error" : undefined}
                            className="gap-2"
                            inputClassName={errors.name ? "border-destructive focus:border-destructive" : "h-[50px]"}
                            inputProps={{
                                id: "register-name",
                                type: "text",
                                value: formData.name,
                                onChange: handleChange("name"),
                                disabled: isLoading,
                                autoComplete: "name",
                                "aria-invalid": !!errors.name,
                                "aria-describedby": errors.name ? "register-name-error" : undefined,
                            }}
                        />

                        <InputField
                            title="비밀번호"
                            message={errors.password}
                            messageTone="error"
                            messageId={errors.password ? "register-password-error" : undefined}
                            className="gap-2"
                            inputClassName={errors.password ? "border-destructive focus:border-destructive" : "h-[50px]"}
                            inputProps={{
                                id: "register-password",
                                type: "password",
                                value: formData.password,
                                onChange: handleChange("password"),
                                disabled: isLoading,
                                autoComplete: "new-password",
                                "aria-invalid": !!errors.password,
                                "aria-describedby": errors.password ? "register-password-error" : undefined,
                            }}
                        />

                        {formData.password && (
                            <PasswordRequirements
                                requirements={passwordStrength.requirements}
                                className="animate-fade-in"
                            />
                        )}

                        <InputField
                            title="비밀번호 확인"
                            message={errors.confirmPassword}
                            messageTone="error"
                            messageId={errors.confirmPassword ? "register-confirm-error" : undefined}
                            className="gap-2"
                            inputClassName={errors.confirmPassword ? "border-destructive focus:border-destructive" : "h-[50px]"}
                            inputProps={{
                                id: "register-confirm-password",
                                type: "password",
                                value: formData.confirmPassword,
                                onChange: handleChange("confirmPassword"),
                                disabled: isLoading,
                                autoComplete: "new-password",
                                "aria-invalid": !!errors.confirmPassword,
                                "aria-describedby": errors.confirmPassword ? "register-confirm-error" : undefined,
                            }}
                        />

                        <Button
                            data-component="auth-register-submit-btn"
                            type="submit"
                            size="lg"
                            className={PRIMARY_BTN_CLS + " w-full"}
                            disabled={isLoading || isCheckingEmailDuplicate || isEmailDuplicate || !!emailFormatError}
                        >
                            {isLoading ? <Spinner size="sm" /> : "회원가입"}
                        </Button>
                    </form>

                    <AuthInlineLink
                        dataComponent="auth-register-login-link"
                        href="/login"
                        prefixText="이미 계정이 있으신가요?"
                        linkLabel="로그인"
                    />
                </div>
            )}
        </CardContainer>
    );
}
