"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Link2 } from "lucide-react";

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
const REGISTER_TOTAL_STEPS = 3;
const BRANCH_OPTIONS = ["인천점", "서울 강동점", "서울 강남점", "부천점", "인천 연수점", "안양점"];
const ROLE_OPTIONS = ["지점장", "매니저", "상담원"];

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<Partial<RegisterFormData>>({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
  });
  const [profileData, setProfileData] = useState({
    phone: "",
    birthDate: "",
    branch: "",
    role: "",
  });
  const [currentStep, setCurrentStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [accountsLinked, setAccountsLinked] = useState(false);
  const [isCheckingEmailDuplicate, setIsCheckingEmailDuplicate] = useState(false);
  const [isEmailDuplicate, setIsEmailDuplicate] = useState(false);
  const [isEmailLinkable, setIsEmailLinkable] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const passwordStrength = checkPasswordStrength(formData.password || "");
  const passwordStrengthRows = [
    { label: "최소 8자 이상", met: passwordStrength.requirements.some((rule) => rule.label === "최소 8자 이상" && rule.met) },
    {
      label: "대/소문자 포함",
      met:
        passwordStrength.requirements.some((rule) => rule.label === "대문자 포함" && rule.met) &&
        passwordStrength.requirements.some((rule) => rule.label === "소문자 포함" && rule.met),
    },
    { label: "숫자 포함", met: passwordStrength.requirements.some((rule) => rule.label === "숫자 포함" && rule.met) },
    {
      label: "특수문자 1개 이상",
      met: passwordStrength.requirements.some((rule) => rule.label === "특수문자 포함" && rule.met),
    },
  ];
  const normalizedEmail = (formData.email ?? "").trim().toLowerCase();
  const emailFormatError = getEmailFormatError(formData.email ?? "");
  const canShowEmailTrailing = Boolean(normalizedEmail) && !emailFormatError;
  const passwordsMatch = Boolean(formData.confirmPassword) && formData.password === formData.confirmPassword;
  const emailTrailingLabel = isCheckingEmailDuplicate
    ? "확인 중"
    : isEmailDuplicate
      ? "중복 이메일"
      : isEmailLinkable
        ? "카카오 연결 가능"
        : "이메일 확인됨";

  useEffect(() => {
    if (!normalizedEmail || emailFormatError) {
      setIsCheckingEmailDuplicate(false);
      setIsEmailDuplicate(false);
      setIsEmailLinkable(false);
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
          setIsEmailLinkable(exists && linkable);
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
          setIsEmailLinkable(false);
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

  const handleProfileChange =
    (field: keyof typeof profileData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setProfileData((prev) => ({ ...prev, [field]: e.target.value }));
      setServerError(null);
    };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    const emailError = getEmailFormatError(formData.email ?? "");
    if (!emailError) return;
    setErrors((prev) => ({ ...prev, email: emailError }));
  };

  const handleAccountStepNext = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);

    if (isCheckingEmailDuplicate) return;
    if (isEmailDuplicate) {
      setErrors((prev) => ({ ...prev, email: EMAIL_DUPLICATE_ERROR }));
      return;
    }

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

    setErrors({});
    setCurrentStep(2);
  };

  const handleProfileStepNext = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);
    setCurrentStep(3);
  };

  const handlePreviousStep = () => {
    setServerError(null);
    setCurrentStep((step) => Math.max(1, step - 1));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);

    if (isCheckingEmailDuplicate) return;
    if (isEmailDuplicate) {
      setErrors((prev) => ({ ...prev, email: EMAIL_DUPLICATE_ERROR }));
      setCurrentStep(1);
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
      setCurrentStep(1);
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
        <div className="auth-brand" data-component="auth-register-brand">
          <div className="auth-logo" data-component="auth-register-logo">
            <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
          </div>
          <div className="auth-title" data-component="auth-register-title">회원가입</div>
          <div className="auth-sub" data-component="auth-register-subtitle">필수 정보를 단계별로 입력해 주세요.</div>
        </div>

        <div className="auth-status" data-component="auth-register-success">
          <div className={`status-icon success ${accountsLinked ? "linked" : ""}`} data-component="auth-register-success-icon">
            {accountsLinked ? <Link2 size={32} strokeWidth={2.5} /> : <CheckCircle size={32} strokeWidth={2.5} />}
          </div>
          <div className="status-message" data-component="auth-register-success-title">
            <strong>{accountsLinked ? "계정이 연결되었습니다!" : "회원가입 완료!"}</strong>
          </div>
          <div className="status-message" data-component="auth-register-success-message">
            {accountsLinked ? (
              <span>
                기존 카카오 계정에 비밀번호가 추가되었습니다.
                <br />
                이메일을 확인하여 계정을 활성화하면
                <br />
                카카오와 이메일 모두로 로그인할 수 있습니다.
              </span>
            ) : (
              <span>
                인증 이메일이 발송되었습니다.
                <br />
                이메일을 확인하여 계정을 활성화해 주세요.
              </span>
            )}
          </div>
        </div>

        <div className="auth-actions auth-success-actions" data-component="auth-register-success-actions">
          <button
            type="button"
            className="auth-btn full"
            onClick={() => router.push("/login")}
            data-component="auth-register-success-login-btn"
          >
            로그인 페이지로 이동
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" data-component="auth-register">
      <div className="auth-brand" data-component="auth-register-brand">
        <div className="auth-logo" data-component="auth-register-logo">
          <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={80} height={80} priority />
        </div>
        <div className="auth-title" data-component="auth-register-title">회원가입</div>
        <div className="auth-sub" data-component="auth-register-subtitle">필수 정보를 단계별로 입력해 주세요.</div>
      </div>

      <div
        className="step-indicator"
        aria-label={`회원가입 ${currentStep}단계 / ${REGISTER_TOTAL_STEPS}단계`}
        data-component="auth-register-step-indicator"
      >
        {Array.from({ length: REGISTER_TOTAL_STEPS }, (_, index) => {
          const step = index + 1;
          return (
            <span
              key={step}
              className={`step-dot ${step === currentStep ? "active" : ""} ${
                step < currentStep ? "done" : ""
              }`}
              aria-hidden="true"
            />
          );
        })}
        <span className="step-count">{currentStep} / {REGISTER_TOTAL_STEPS}</span>
      </div>

      {serverError && (
        <div className="auth-server-error" role="alert" data-component="auth-register-server-error">
          {serverError}
        </div>
      )}

      {currentStep === 1 && (
        <form className="auth-form auth-step-view active" onSubmit={handleAccountStepNext} data-component="auth-register-form">
          <div className="auth-input-group" data-component="auth-register-email-field">
            <label className="auth-label" htmlFor="register-email">이메일</label>
            <div className="auth-input-wrap" data-component="auth-register-email-input-wrap">
              <input
                id="register-email"
                className={`auth-input has-trailing ${errors.email ? "error" : ""}`}
                type="email"
                placeholder="example@email.com"
                autoComplete="email"
                value={formData.email ?? ""}
                onChange={handleChange("email")}
                onBlur={handleEmailBlur}
                disabled={isLoading}
                aria-invalid={!!errors.email}
              />
              {canShowEmailTrailing && <span className="auth-input-trailing">{emailTrailingLabel}</span>}
            </div>
            {errors.email && <div className="auth-helper error" data-component="auth-register-email-error">{errors.email}</div>}
          </div>

          <div className="auth-input-group" data-component="auth-register-name-field">
            <label className="auth-label" htmlFor="register-name">이름</label>
            <input
              id="register-name"
              className={`auth-input ${errors.name ? "error" : ""}`}
              type="text"
              placeholder="이름 입력"
              autoComplete="name"
              value={formData.name ?? ""}
              onChange={handleChange("name")}
              disabled={isLoading}
              aria-invalid={!!errors.name}
            />
            {errors.name && <div className="auth-helper error" data-component="auth-register-name-error">{errors.name}</div>}
          </div>

          <div className="auth-input-group" data-component="auth-register-password-field">
            <label className="auth-label" htmlFor="register-password">비밀번호</label>
            <input
              id="register-password"
              className={`auth-input ${errors.password ? "error" : ""}`}
              type="password"
              placeholder="8자 이상"
              autoComplete="new-password"
              value={formData.password ?? ""}
              onChange={handleChange("password")}
              disabled={isLoading}
              aria-invalid={!!errors.password}
            />
            {errors.password && <div className="auth-helper error" data-component="auth-register-password-error">{errors.password}</div>}
            <div className="pw-strength" data-component="auth-register-password-strength">
              {passwordStrengthRows.map((rule) => (
                <div key={rule.label} className={`pw-strength-row ${rule.met ? "ok" : ""}`} data-component="auth-register-password-strength-row">
                  <span className="dot" />
                  {rule.label}
                </div>
              ))}
            </div>
          </div>

          <div className="auth-input-group" data-component="auth-register-password-confirm-field">
            <label className="auth-label" htmlFor="register-password-confirm">비밀번호 확인</label>
            <input
              id="register-password-confirm"
              className={`auth-input ${errors.confirmPassword ? "error" : ""}`}
              type="password"
              placeholder="비밀번호 다시 입력"
              autoComplete="new-password"
              value={formData.confirmPassword ?? ""}
              onChange={handleChange("confirmPassword")}
              disabled={isLoading}
              aria-invalid={!!errors.confirmPassword}
            />
            {errors.confirmPassword ? (
              <div className="auth-helper error" data-component="auth-register-password-confirm-error">{errors.confirmPassword}</div>
            ) : (
              <div
                className={`auth-helper ${passwordsMatch ? "ok" : "placeholder"}`}
                data-component="auth-register-password-confirm-ok"
              >
                ✓ 비밀번호가 일치합니다.
              </div>
            )}
          </div>

          <div className="auth-actions" data-component="auth-register-step-actions">
            <button
              type="submit"
              className="auth-btn full"
              disabled={isLoading || isCheckingEmailDuplicate}
              data-component="auth-register-step-next"
            >
              다음
              <ChevronRight size={14} strokeWidth={2.5} />
            </button>
          </div>
        </form>
      )}

      {currentStep === 2 && (
        <form className="auth-form auth-step-view active" onSubmit={handleProfileStepNext} data-component="auth-register-profile-form">
          <div className="auth-input-group" data-component="auth-register-phone-field">
            <label className="auth-label" htmlFor="register-phone">전화번호</label>
            <input
              id="register-phone"
              className="auth-input"
              type="tel"
              placeholder="010-1234-5678"
              inputMode="numeric"
              maxLength={13}
              autoComplete="tel"
              value={profileData.phone}
              onChange={handleProfileChange("phone")}
              disabled={isLoading}
            />
            {profileData.phone && <div className="auth-helper ok" data-component="auth-register-phone-ok">✓ 등록 가능한 번호입니다.</div>}
          </div>

          <div className="auth-input-group" data-component="auth-register-birth-field">
            <label className="auth-label" htmlFor="register-birth">생년월일</label>
            <input
              id="register-birth"
              className="auth-input"
              type="text"
              placeholder="1990-01-01"
              inputMode="numeric"
              maxLength={10}
              autoComplete="bday"
              value={profileData.birthDate}
              onChange={handleProfileChange("birthDate")}
              disabled={isLoading}
            />
            <div className="auth-helper" data-component="auth-register-birth-helper">YYYY-MM-DD 형식으로 입력해 주세요.</div>
          </div>

          <div className="auth-actions" data-component="auth-register-step-actions">
            <button type="button" className="auth-btn secondary" onClick={handlePreviousStep} disabled={isLoading}>
              <ChevronLeft size={14} strokeWidth={2.5} />
              이전
            </button>
            <button type="submit" className="auth-btn" disabled={isLoading}>
              다음
              <ChevronRight size={14} strokeWidth={2.5} />
            </button>
          </div>
        </form>
      )}

      {currentStep === 3 && (
        <form className="auth-form auth-step-view active" onSubmit={handleSubmit} data-component="auth-register-submit-form">
          <div className="auth-input-group" data-component="auth-register-branch-field">
            <label className="auth-label" htmlFor="register-branch">지점명</label>
            <div className="auth-select-wrap" data-component="auth-register-branch-select-wrap">
              <select
                id="register-branch"
                className="auth-select"
                value={profileData.branch}
                onChange={handleProfileChange("branch")}
                disabled={isLoading}
              >
                <option value="">지점을 선택해주세요</option>
                {BRANCH_OPTIONS.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
              <ChevronDown className="auth-select-chev" size={16} strokeWidth={2.5} aria-hidden="true" />
            </div>
          </div>

          <div className="auth-input-group" data-component="auth-register-role-field">
            <label className="auth-label" htmlFor="register-role">역할</label>
            <div className="auth-select-wrap" data-component="auth-register-role-select-wrap">
              <select
                id="register-role"
                className="auth-select"
                value={profileData.role}
                onChange={handleProfileChange("role")}
                disabled={isLoading}
              >
                <option value="">역할을 선택해주세요</option>
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <ChevronDown className="auth-select-chev" size={16} strokeWidth={2.5} aria-hidden="true" />
            </div>
            <div className="auth-helper" data-component="auth-register-role-helper">선택한 지점의 관리자가 가입을 승인해야 합니다.</div>
          </div>

          <div className="auth-actions" data-component="auth-register-step-actions">
            <button type="button" className="auth-btn secondary" onClick={handlePreviousStep} disabled={isLoading}>
              <ChevronLeft size={14} strokeWidth={2.5} />
              이전
            </button>
            <button
              type="submit"
              className="auth-btn"
              disabled={isLoading || isCheckingEmailDuplicate}
              data-component="auth-register-submit"
            >
              {isLoading ? "처리 중…" : "회원가입"}
            </button>
          </div>
        </form>
      )}

      <div className="auth-footer-link" data-component="auth-register-footer-link">
        <span>이미 계정이 있으신가요?&nbsp;</span>
        <Link href="/login">로그인</Link>
      </div>
    </div>
  );
}
