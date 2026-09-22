"use client";


import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { normalizeApiError, getResetPasswordErrorMessage } from "@babyjamjam/shared";

import { AUTH_ROUTES } from "@/lib/auth/routes";
import { checkPasswordStrength, resetPasswordSchema, type ResetPasswordFormData } from "@/lib/validations/auth";
import { authApi } from "@/services/api";

export function useResetPasswordPageController() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [formData, setFormData] = useState<Partial<ResetPasswordFormData>>({
    newPassword: "",
    confirmPassword: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleChange = (field: keyof ResetPasswordFormData) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [field]: event.target.value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors[field];
        return nextErrors;
      });
    }
    if (error) {
      setError(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!token) {
      setError("유효하지 않은 비밀번호 재설정 링크예요.");
      return;
    }

    const result = resetPasswordSchema.safeParse(formData);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as string;
        if (!nextErrors[field]) {
          nextErrors[field] = issue.message;
        }
      });
      setFieldErrors(nextErrors);
      return;
    }

    setIsLoading(true);

    try {
      const response = await authApi.resetPassword(token, result.data.newPassword);

      if (response.success) {
        setIsSuccess(true);
      } else {
        // The upstream `message` field is never rendered; locally authored
        // copy covers the unverified outcome.
        setError("비밀번호 재설정에 실패했어요.");
      }
    } catch (requestError) {
      console.error("Reset password error:", requestError);
      const errorData = requestError && typeof requestError === "object" && "response" in requestError
        ? (requestError as { response?: { data?: { code?: unknown } } }).response?.data
        : undefined;
      // Registered-code copy first (shared mapper), then the problem
      // contract; upstream internals are never rendered.
      const normalized = normalizeApiError(requestError, { locale: "ko-KR", operation: "mutation" });
      setError(
        getResetPasswordErrorMessage(errorData?.code)
        ?? (normalized.verified ? normalized.message : null)
        ?? "네트워크 오류가 발생했어요. 다시 시도해 주세요.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return {
    token,
    formData,
    error,
    fieldErrors,
    isLoading,
    isSuccess,
    passwordStrength: checkPasswordStrength(formData.newPassword || ""),
    status: !token ? "invalid" : isSuccess ? "success" : "form",
    cardTitle: !token ? "유효하지 않은 링크" : isSuccess ? "비밀번호 변경 완료!" : "새 비밀번호 설정",
    cardSubtitle: !token || isSuccess ? undefined : "새로운 비밀번호를 입력해 주세요.",
    handleChange,
    handleSubmit,
    clearError: () => setError(null),
    goToLogin: () => router.push(AUTH_ROUTES.login),
    goToForgotPassword: () => router.push(AUTH_ROUTES.forgotPassword),
  };
}
