"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { authApi } from "@/services/api";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { CardContainer } from "@/components/auth/auth-card";
import { AuthInlineLink } from "@/components/auth/auth-inline-link";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";


export default function ForgotPasswordPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);

        // Validate with Zod
        const result = forgotPasswordSchema.safeParse({ email });
        if (!result.success) {
            setError(result.error.issues[0]?.message || "유효한 이메일을 입력해주세요.");
            return;
        }

        setIsLoading(true);

        try {
            const response = await authApi.forgotPassword(email);

            // Always show success to prevent email enumeration
            // The backend also returns success even if email doesn't exist
            if (response.success) {
                setIsSuccess(true);
            } else {
                // In case backend explicitly returns failure
                setError(response.message || "요청 처리에 실패했습니다. 다시 시도해 주세요.");
            }
        } catch (err) {
            console.error("Forgot password error:", err);
            setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
        } finally {
            setIsLoading(false);
        }
    };

    const cardTitle = isSuccess ? "이메일 전송 완료" : "비밀번호 찾기";
    const cardSubtitle = isSuccess
        ? undefined
        : "가입하신 이메일 주소를 입력하시면 비밀번호 재설정 링크를 보내드립니다.";

    return (
        <CardContainer
            data-component="auth-forgot-password"
            dataComponents={{
                container: "auth-forgot-password",
                card: "auth-forgot-password-card",
                header: "auth-forgot-password-header",
                title: "auth-forgot-password-title",
                subtitle: "auth-forgot-password-subtitle",
                content: "auth-forgot-password-content",
            }}
            contentClassName="flex flex-col gap-6"
            title={cardTitle}
            subtitle={cardSubtitle}
        >
            {isSuccess ? (
                <div data-component="auth-forgot-password-success" className="flex flex-col items-center gap-6 text-center">
                    <div data-component="auth-forgot-password-success-icon" className="rounded-full bg-success/10 p-3">
                        <CheckCircle className="h-12 w-12 text-success" />
                    </div>
                    <div data-component="auth-forgot-password-success-message" className="flex flex-col text-center text-muted-foreground">
                        <div data-component="auth-forgot-password-success-message-lines" className="flex flex-col">
                            <p>
                                <strong className="text-foreground">{email}</strong>로
                            </p>
                            <p>
                                비밀번호 재설정 링크가 전송되었습니다.
                            </p>
                        </div>
                    </div>
                    <p className="text-center text-muted-foreground">
                        이메일을 확인하여 비밀번호를 재설정해 주세요.
                    </p>
                    <Alert variant="info" className="w-full text-left">
                        이메일이 도착하지 않았다면 스팸 폴더를 확인해 주세요.
                    </Alert>
                    <Button
                        data-component="auth-forgot-password-login-btn"
                        size="lg"
                        className="w-full rounded-2xl"
                        onClick={() => router.push("/login")}
                    >
                        로그인 페이지로 돌아가기
                    </Button>
                </div>
            ) : (
                <>
                    {error && (
                        <Alert variant="destructive" onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}

                    <form onSubmit={handleSubmit} data-component="auth-forgot-password-form" className="flex flex-col gap-4">
                        <FormField
                            label="이메일"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isLoading}
                            autoComplete="email"
                            autoFocus
                            data-component="auth-forgot-password-email-field"
                        />

                        <Button
                            data-component="auth-forgot-password-submit-btn"
                            type="submit"
                            size="lg"
                            className="w-full rounded-2xl"
                            disabled={isLoading || !email.trim()}
                        >
                            {isLoading ? <Spinner size="sm" /> : "비밀번호 재설정 링크 전송"}
                        </Button>
                    </form>

                    <AuthInlineLink
                        dataComponent="auth-forgot-password-login-link"
                        href="/login"
                        prefixText="비밀번호가 기억나셨나요?"
                        linkLabel="로그인"
                    />
                </>
            )}
        </CardContainer>
    );
}
