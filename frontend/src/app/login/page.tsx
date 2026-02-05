"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t } from "../lib/i18n/translations";
import { useLocale } from "../(components)/LocaleProvider";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { loginWithEmail } from "./actions";
import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

const LoginPage = () => {
    const locale = useLocale();
    const router = useRouter();

    const [formData, setFormData] = useState<Partial<LoginFormData>>({
        email: "",
        password: "",
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

    const handleChange = (field: keyof LoginFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData((prev) => ({ ...prev, [field]: e.target.value }));
        if (errors[field]) {
            setErrors((prev) => {
                const newErrors = { ...prev };
                delete newErrors[field];
                return newErrors;
            });
        }
        setServerError(null);
        setEmailVerificationRequired(false);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setServerError(null);
        setErrors({});
        setEmailVerificationRequired(false);

        // Validate with Zod
        const result = loginSchema.safeParse(formData);
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
            const response = await loginWithEmail(result.data.email, result.data.password);

            if (response.success) {
                if (response.requiresOrgSelection) {
                    router.replace("/select-organization");
                } else {
                    router.replace("/dashboard");
                }
            } else {
                setServerError(response.error || "로그인에 실패했습니다.");
                if (response.emailVerificationRequired) {
                    setEmailVerificationRequired(true);
                }
            }
        } catch (err) {
            console.error("Login error:", err);
            setServerError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthCard
            title={t(locale, "login.title")}
            description={t(locale, "login.subtitle")}
        >
            <div className="space-y-6">
                {/* Error Alert */}
                {serverError && (
                    <Alert
                        variant="destructive"
                        onClose={() => {
                            setServerError(null);
                            setEmailVerificationRequired(false);
                        }}
                    >
                        <div>
                            {serverError}
                            {emailVerificationRequired && (
                                <div className="mt-2">
                                    <Link
                                        href="/auth/verify-email"
                                        className="text-destructive underline hover:no-underline"
                                    >
                                        인증 이메일 재발송
                                    </Link>
                                </div>
                            )}
                        </div>
                    </Alert>
                )}

                {/* Login Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <FormField
                        label="이메일"
                        type="email"
                        value={formData.email}
                        onChange={handleChange("email")}
                        error={errors.email}
                        disabled={isLoading}
                        autoComplete="email"
                    />

                    <FormField
                        label="비밀번호"
                        type="password"
                        value={formData.password}
                        onChange={handleChange("password")}
                        error={errors.password}
                        disabled={isLoading}
                        autoComplete="current-password"
                    />

                    <div className="flex justify-end">
                        <Link
                            href="/auth/forgot-password"
                            className="text-sm text-muted-foreground hover:text-primary transition-colors"
                        >
                            비밀번호를 잊으셨나요?
                        </Link>
                    </div>

                    <Button
                        type="submit"
                        size="lg"
                        className="w-full"
                        disabled={isLoading}
                    >
                        {isLoading ? <Spinner size="sm" /> : "로그인"}
                    </Button>
                </form>

                {/* Divider */}
                <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">
                            또는
                        </span>
                    </div>
                </div>

                {/* OAuth Buttons */}
                <OAuthButtons disabled={isLoading} />

                {/* Register Link */}
                <p className="text-center text-sm text-muted-foreground">
                    계정이 없으신가요?{" "}
                    <Link
                        href="/auth/register"
                        className="text-primary font-medium hover:underline"
                    >
                        회원가입
                    </Link>
                </p>
            </div>
        </AuthCard>
    );
};

export default LoginPage;
