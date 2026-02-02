"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { authApi } from "@/services/api";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { AuthCard } from "@/components/auth/auth-card";
import { FormField } from "@/components/auth/form-field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent } from "@/components/ui/card";

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

    // Success State
    if (isSuccess) {
        return (
            <div className="flex min-h-screen items-center justify-center px-4 py-8">
                <Card className="w-full max-w-[400px] animate-scale-in">
                    <CardContent className="pt-6">
                        <div className="flex flex-col items-center space-y-4 text-center">
                            <div className="rounded-full bg-success/10 p-3">
                                <CheckCircle className="h-12 w-12 text-success" />
                            </div>
                            <h2 className="text-2xl font-bold">이메일 전송 완료</h2>
                            <p className="text-muted-foreground">
                                <strong className="text-foreground">{email}</strong>로 비밀번호 재설정 링크가 전송되었습니다.
                                <br /><br />
                                이메일을 확인하여 비밀번호를 재설정해 주세요.
                            </p>
                            <Alert variant="info" className="w-full">
                                이메일이 도착하지 않았다면 스팸 폴더를 확인해 주세요.
                            </Alert>
                            <Button
                                size="lg"
                                className="w-full mt-4"
                                onClick={() => router.push("/login")}
                            >
                                로그인 페이지로 돌아가기
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <AuthCard
            title="비밀번호 찾기"
            description="가입하신 이메일 주소를 입력하시면 비밀번호 재설정 링크를 보내드립니다."
        >
            <div className="space-y-6">
                {error && (
                    <Alert variant="destructive" onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <FormField
                        label="이메일"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={isLoading}
                        autoComplete="email"
                        autoFocus
                    />

                    <Button
                        type="submit"
                        size="lg"
                        className="w-full mt-2"
                        disabled={isLoading || !email.trim()}
                    >
                        {isLoading ? <Spinner size="sm" /> : "비밀번호 재설정 링크 전송"}
                    </Button>
                </form>

                <p className="text-center text-sm text-muted-foreground">
                    비밀번호가 기억나셨나요?{" "}
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
