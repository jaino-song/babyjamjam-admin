"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { loginWithEmail } from "./actions";
import { CardContainer } from "@/components/auth/auth-card";
import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { FormField } from "@/components/auth/form-field";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

const LoginPage = () => {
    const locale = useLocale();
    const router = useRouter();

    const [autoLogin, setAutoLogin] = useState(false);
    const [rememberId, setRememberId] = useState(false);
    const [formData, setFormData] = useState<Partial<LoginFormData>>({
        email: "",
        password: "",
    });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

    useEffect(() => {
        const savedAutoLogin = safeStorageGetItem("local", "login:autoLogin") === "true";
        const savedRememberId = safeStorageGetItem("local", "login:rememberId") === "true";
        const savedEmail = safeStorageGetItem("local", "login:savedEmail") || "";

        setAutoLogin(savedAutoLogin);
        setRememberId(savedRememberId);

        if (savedRememberId && savedEmail) {
            setFormData((prev) => ({ ...prev, email: savedEmail }));
        }
    }, []);

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
            safeStorageSetItem("local", "login:autoLogin", autoLogin ? "true" : "false");
            safeStorageSetItem("local", "login:rememberId", rememberId ? "true" : "false");
            if (rememberId) {
                safeStorageSetItem("local", "login:savedEmail", result.data.email);
            } else {
                safeStorageRemoveItem("local", "login:savedEmail");
            }

            const response = await loginWithEmail(result.data.email, result.data.password, autoLogin);

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
        <CardContainer
            data-component="auth-login"
            dataComponents={{
                container: "auth-login-container",
                card: "auth-login-card",
                header: "auth-login-header",
                title: "auth-login-title",
                subtitle: "auth-login-subtitle",
                content: "auth-login-content",
            }}
            contentClassName="flex flex-col gap-6"
            title={t(locale, "login.title")}
            subtitle={t(locale, "login.subtitle")}
        >
                {/* Error Alert */}
                {serverError && (
                    <Alert
                        variant="destructive"
                        onClose={() => {
                            setServerError(null);
                            setEmailVerificationRequired(false);
                        }}
                    >
                        <div data-component="login-error-message">
                            {serverError}
                            {emailVerificationRequired && (
                                <div data-component="login-error-verify-email" className="mt-2">
                                    <Link
                                        href="/verify-email"
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
                <form data-component="login-form" onSubmit={handleSubmit} className="space-y-4">
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

                    <div data-component="login-form-checkboxes" className="flex items-center gap-6 pt-1">
                        <div data-component="login-form-checkbox-remember-id" className="flex items-center gap-2">
                            <Checkbox
                                id="login-remember-id"
                                checked={rememberId}
                                onCheckedChange={(checked) => setRememberId(checked === true)}
                                disabled={isLoading}
                            />
                            <Label htmlFor="login-remember-id" className="text-sm text-muted-foreground select-none">
                                아이디 저장
                            </Label>
                        </div>

                        <div data-component="login-form-checkbox-auto-login" className="flex items-center gap-2">
                            <Checkbox
                                id="login-auto-login"
                                checked={autoLogin}
                                onCheckedChange={(checked) => setAutoLogin(checked === true)}
                                disabled={isLoading}
                            />
                            <Label htmlFor="login-auto-login" className="text-sm text-muted-foreground select-none">
                                자동 로그인
                            </Label>
                        </div>
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
                <div data-component="login-divider" className="relative">
                    <div data-component="login-divider-line" className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                    </div>
                    <div data-component="login-divider-text" className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">
                            또는
                        </span>
                    </div>
                </div>

                {/* OAuth Buttons */}
                <OAuthButtons disabled={isLoading} />

                <AuthInlineLink
                    dataComponent="login-forgot"
                    href="/forgot-password"
                    prefixText="비밀번호를 잊으셨나요?"
                    linkLabel="비밀번호 찾기"
                />

                {/* Register Link */}
                <AuthInlineLink
                    dataComponent="login-register-link"
                    href="/register"
                    prefixText="계정이 없으신가요?"
                    linkLabel="회원가입"
                />
        </CardContainer>
    );
};

export default LoginPage;
