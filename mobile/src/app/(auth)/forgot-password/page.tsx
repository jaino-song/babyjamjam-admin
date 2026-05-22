"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";

import { authApi } from "@/services/api";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import "@/components/app/mobile-redesign/redesign.css";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldError(null);
    setError(null);

    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
      setFieldError(result.error.issues[0]?.message || "유효한 이메일을 입력해주세요.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await authApi.forgotPassword(email);
      if (response.success) {
        setIsSuccess(true);
      } else {
        setError(response.message || "요청 처리에 실패했습니다. 다시 시도해 주세요.");
      }
    } catch (err) {
      console.error("Forgot password error:", err);
      setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="auth-page" data-component="auth-forgot-password">
        <div className="auth-brand">
          <div className="auth-logo">
            <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
          </div>
          <div className="auth-title">이메일 전송 완료</div>
        </div>

        <div
          data-component="auth-forgot-password-success"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 18,
            paddingTop: 8,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "hsl(var(--v3-green-light))",
              color: "hsl(var(--v3-green))",
            }}
          >
            <CheckCircle size={32} strokeWidth={2.5} />
          </div>
          <p
            style={{
              fontSize: "0.86rem",
              color: "hsl(var(--v3-dark))",
              lineHeight: 1.55,
            }}
          >
            <strong>{email}</strong>로
            <br />
            비밀번호 재설정 링크가 전송되었습니다.
          </p>
          <p
            style={{
              fontSize: "0.74rem",
              color: "hsl(var(--v3-text-muted))",
              lineHeight: 1.5,
            }}
          >
            이메일이 도착하지 않았다면 스팸 폴더를 확인해 주세요.
          </p>
        </div>

        <button
          type="button"
          className="auth-btn"
          style={{ marginTop: 28 }}
          onClick={() => router.push("/login")}
          data-component="auth-forgot-password-login-btn"
        >
          로그인 페이지로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <div className="auth-page" data-component="auth-forgot-password">
      <div className="auth-brand">
        <div className="auth-logo">
          <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
        </div>
        <div className="auth-title">비밀번호 찾기</div>
        <div className="auth-sub">
          가입하신 이메일 주소를 입력하시면 비밀번호 재설정 링크를 보내드립니다.
        </div>
      </div>

      {error && (
        <div className="auth-server-error" role="alert">
          {error}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit} data-component="auth-forgot-password-form">
        <input
          className={`auth-input ${fieldError ? "error" : ""}`}
          type="email"
          placeholder="이메일"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldError) setFieldError(null);
          }}
          disabled={isLoading}
          aria-invalid={!!fieldError}
        />
        {fieldError && <div className="auth-input-error">{fieldError}</div>}

        <button
          type="submit"
          className="auth-btn"
          disabled={isLoading || !email.trim()}
          data-component="auth-forgot-password-submit-btn"
        >
          {isLoading ? "처리 중…" : "비밀번호 재설정 링크 전송"}
        </button>
      </form>

      <div className="auth-links" style={{ justifyContent: "center" }}>
        <span>비밀번호가 기억나셨나요?&nbsp;</span>
        <Link href="/login" data-component="auth-forgot-password-login-link">
          로그인
        </Link>
      </div>
    </div>
  );
}
