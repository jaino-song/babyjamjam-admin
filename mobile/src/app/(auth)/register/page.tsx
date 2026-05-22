"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, Link2 } from "lucide-react";

import { authApi } from "@/services/api";
import {
  registerSchema,
  checkPasswordStrength,
  getEmailFormatError,
  sanitizeNameInput,
  type RegisterFormData,
} from "@/lib/validations/auth";
import "@/components/app/mobile-redesign/redesign.css";

interface RegisterErrorData {
  errors?: string[];
  message?: string;
}
interface AxiosLikeError {
  response?: { data?: RegisterErrorData };
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
        if (prev.email !== EMAIL_DUPLICATE_ERROR) return prev;
        const next = { ...prev };
        delete next.email;
        return next;
      });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsCheckingEmailDuplicate(true);
      void authApi
        .checkEmailExists(normalizedEmail)
        .then(({ exists, linkable }) => {
          if (cancelled) return;
          const dup = exists && !linkable;
          setIsEmailDuplicate(dup);
          setErrors((prev) => {
            const next = { ...prev };
            if (dup) next.email = EMAIL_DUPLICATE_ERROR;
            else if (next.email === EMAIL_DUPLICATE_ERROR) delete next.email;
            return next;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setIsEmailDuplicate(false);
          setErrors((prev) => {
            if (prev.email !== EMAIL_DUPLICATE_ERROR) return prev;
            const next = { ...prev };
            delete next.email;
            return next;
          });
        })
        .finally(() => {
          if (!cancelled) setIsCheckingEmailDuplicate(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setIsCheckingEmailDuplicate(false);
    };
  }, [normalizedEmail, emailFormatError]);

  const handleChange = (field: keyof RegisterFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = field === "name" ? sanitizeNameInput(e.target.value) : e.target.value;
    const nextEmailError = field === "email" ? getEmailFormatError(value) : undefined;
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        if (field === "email" && (emailTouched || Boolean(prev.email)) && nextEmailError) {
          next.email = nextEmailError;
        }
        return next;
      });
    } else if (field === "email" && emailTouched && nextEmailError) {
      setErrors((prev) => ({ ...prev, email: nextEmailError }));
    }
    setServerError(null);
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    const emailError = getEmailFormatError(formData.email ?? "");
    if (!emailError) return;
    setErrors((prev) => ({ ...prev, email: emailError }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);

    if (isCheckingEmailDuplicate) return;
    if (isEmailDuplicate) {
      setErrors((prev) => ({ ...prev, email: EMAIL_DUPLICATE_ERROR }));
      return;
    }

    setErrors((prev) => {
      const next = { ...prev };
      if (next.email === EMAIL_DUPLICATE_ERROR) delete next.email;
      return next;
    });

    const result = registerSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as string;
        if (!fieldErrors[field]) fieldErrors[field] = issue.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);
    try {
      const response = await authApi.register(result.data.email, result.data.password, result.data.name);
      if (response.success) {
        if (response.code === "ACCOUNTS_LINKED") setAccountsLinked(true);
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
      if (errorData?.errors) setServerError(errorData.errors.join("\n"));
      else if (errorData?.message) setServerError(errorData.message);
      else setServerError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="auth-page" data-component="auth-register">
        <div className="auth-brand">
          <div className="auth-logo">
            <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
          </div>
          <div className="auth-title">
            {accountsLinked ? "계정이 연결되었습니다!" : "회원가입 완료!"}
          </div>
        </div>

        <div
          className="auth-status"
          data-component="auth-register-success"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            paddingTop: 8,
          }}
        >
          <div
            className="status-icon success"
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 18,
              background: accountsLinked
                ? "hsl(var(--v3-primary-light))"
                : "hsl(var(--v3-green-light))",
              color: accountsLinked ? "hsl(var(--v3-primary))" : "hsl(var(--v3-green))",
            }}
          >
            {accountsLinked ? <Link2 size={32} strokeWidth={2.5} /> : <CheckCircle size={32} strokeWidth={2.5} />}
          </div>
          <p
            style={{
              fontSize: "0.86rem",
              color: "hsl(var(--v3-dark))",
              lineHeight: 1.55,
            }}
          >
            {accountsLinked ? (
              <>
                기존 카카오 계정에 비밀번호가 추가되었습니다.
                <br />
                이메일을 확인하여 계정을 활성화하면
                <br />
                카카오와 이메일 모두로 로그인할 수 있습니다.
              </>
            ) : (
              <>
                인증 이메일이 발송되었습니다.
                <br />
                이메일을 확인하여 계정을 활성화해 주세요.
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          className="auth-btn"
          style={{ marginTop: 28 }}
          onClick={() => router.push("/login")}
          data-component="auth-register-success-login-btn"
        >
          로그인 페이지로 이동
        </button>
      </div>
    );
  }

  return (
    <div className="auth-page" data-component="auth-register">
      <div className="auth-brand">
        <div className="auth-logo">
          <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
        </div>
        <div className="auth-title">회원가입</div>
        <div className="auth-sub">아래의 항목들을 작성해 주세요</div>
      </div>

      {serverError && (
        <div className="auth-server-error" role="alert">
          {serverError}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit} data-component="auth-register-form">
        <input
          className={`auth-input ${errors.email ? "error" : ""}`}
          type="email"
          placeholder="이메일"
          autoComplete="email"
          value={formData.email ?? ""}
          onChange={handleChange("email")}
          onBlur={handleEmailBlur}
          disabled={isLoading}
          aria-invalid={!!errors.email}
        />
        {errors.email && <div className="auth-input-error">{errors.email}</div>}

        <input
          className={`auth-input ${errors.name ? "error" : ""}`}
          type="text"
          placeholder="이름"
          autoComplete="name"
          value={formData.name ?? ""}
          onChange={handleChange("name")}
          disabled={isLoading}
          aria-invalid={!!errors.name}
        />
        {errors.name && <div className="auth-input-error">{errors.name}</div>}

        <input
          className={`auth-input ${errors.password ? "error" : ""}`}
          type="password"
          placeholder="비밀번호 (8자 이상)"
          autoComplete="new-password"
          value={formData.password ?? ""}
          onChange={handleChange("password")}
          disabled={isLoading}
          aria-invalid={!!errors.password}
        />
        {errors.password && <div className="auth-input-error">{errors.password}</div>}

        {formData.password && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 4 }}>
            {passwordStrength.requirements.map((rule) => (
              <div
                key={rule.label}
                style={{
                  fontSize: "0.68rem",
                  color: rule.met ? "hsl(var(--v3-green))" : "hsl(var(--v3-text-muted))",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: rule.met ? "hsl(var(--v3-green))" : "hsl(var(--v3-border))",
                  }}
                />
                {rule.label}
              </div>
            ))}
          </div>
        )}

        <input
          className={`auth-input ${errors.confirmPassword ? "error" : ""}`}
          type="password"
          placeholder="비밀번호 확인"
          autoComplete="new-password"
          value={formData.confirmPassword ?? ""}
          onChange={handleChange("confirmPassword")}
          disabled={isLoading}
          aria-invalid={!!errors.confirmPassword}
        />
        {errors.confirmPassword && <div className="auth-input-error">{errors.confirmPassword}</div>}

        <button
          type="submit"
          className="auth-btn"
          disabled={isLoading || isCheckingEmailDuplicate}
          data-component="auth-register-submit"
        >
          {isLoading ? "처리 중…" : "회원가입"}
        </button>
      </form>

      <div className="auth-links" style={{ justifyContent: "center" }}>
        <span>이미 계정이 있으신가요?&nbsp;</span>
        <Link href="/login">로그인</Link>
      </div>
    </div>
  );
}
