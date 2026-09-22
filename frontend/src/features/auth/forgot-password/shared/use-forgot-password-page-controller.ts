"use client";


import { useRouter } from "next/navigation";
import { useState } from "react";
import { normalizeApiError } from "@babyjamjam/shared";

import { AUTH_ROUTES } from "@/lib/auth/routes";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import { authApi } from "@/services/api";

export function useForgotPasswordPageController() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
    if (error) {
      setError(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
      // Local Zod issue copy is authored by this repo's schema — render as-is.
      setError(result.error.issues[0]?.message || "유효한 이메일을 입력해주세요.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await authApi.forgotPassword(email);

      if (response.success) {
        setIsSuccess(true);
      } else {
        // The upstream `message` field is never rendered; locally authored
        // copy covers the unverified outcome.
        setError("요청 처리에 실패했어요. 다시 시도해 주세요.");
      }
    } catch (requestError) {
      console.error("Forgot password error:", requestError);
      // Shared problem contract resolution — upstream internals are never
      // rendered; the normalized message is already safe copy.
      setError(normalizeApiError(requestError, { locale: "ko-KR", operation: "mutation" }).message);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    email,
    error,
    isLoading,
    isSuccess,
    cardTitle: isSuccess ? "이메일 전송 완료" : "비밀번호 찾기",
    cardSubtitle: isSuccess
      ? undefined
      : "가입하신 이메일 주소를 입력하시면 비밀번호 재설정 링크를 보내드립니다.",
    handleEmailChange,
    handleSubmit,
    clearError: () => setError(null),
    goToLogin: () => router.push(AUTH_ROUTES.login),
  };
}
