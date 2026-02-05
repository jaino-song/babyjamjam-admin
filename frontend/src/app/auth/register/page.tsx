"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Link2 } from "lucide-react";
import { authApi } from "@/services/api";
import { registerSchema, checkPasswordStrength, type RegisterFormData } from "@/lib/validations/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";

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
        } catch (err: any) {
            console.error("Registration error:", err);
            // Check if this is an axios error with response data
            const errorData = err?.response?.data;
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

    // Success State
    if (isSuccess) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4 py-8">
                <Card className="w-full max-w-[400px] animate-scale-in">
                    <CardContent className="pt-6">
                        <div className="flex flex-col items-center space-y-4 text-center">
                            {accountsLinked ? (
                                <>
                                    <div className="rounded-full bg-primary/10 p-3">
                                        <Link2 className="h-12 w-12 text-primary" />
                                    </div>
                                    <h2 className="text-2xl font-bold">계정이 연결되었습니다!</h2>
                                    <p className="text-muted-foreground">
                                        기존 카카오 계정에 비밀번호가 추가되었습니다.
                                        <br />
                                        이메일을 확인하여 계정을 활성화하면
                                        <br />
                                        카카오와 이메일 모두로 로그인할 수 있습니다.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div className="rounded-full bg-success/10 p-3">
                                        <CheckCircle className="h-12 w-12 text-success" />
                                    </div>
                                    <h2 className="text-2xl font-bold">회원가입 완료!</h2>
                                    <p className="text-muted-foreground">
                                        인증 이메일이 발송되었습니다.
                                        <br />
                                        이메일을 확인하여 계정을 활성화해 주세요.
                                    </p>
                                </>
                            )}
                            <Button
                                size="lg"
                                className="w-full mt-4"
                                onClick={() => router.push("/login")}
                            >
                                로그인 페이지로 이동
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <AuthCard title="회원가입">
            <div className="space-y-6">
                {serverError && (
                    <Alert variant="destructive" onClose={() => setServerError(null)}>
                        {serverError}
                    </Alert>
                )}

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
                        label="이름"
                        type="text"
                        value={formData.name}
                        onChange={handleChange("name")}
                        error={errors.name}
                        disabled={isLoading}
                        autoComplete="name"
                    />

                    <FormField
                        label="비밀번호"
                        type="password"
                        value={formData.password}
                        onChange={handleChange("password")}
                        error={errors.password}
                        disabled={isLoading}
                        autoComplete="new-password"
                    />

                    {/* Password Requirements */}
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
                    />

                    <Button
                        type="submit"
                        size="lg"
                        className="w-full mt-2"
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
                    >
                        로그인
                    </Link>
                </p>
            </div>
        </AuthCard>
    );
}
