"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AUTH_ROUTES } from "@/lib/auth/routes";
import { authApi } from "@/services/api";

type VerifyEmailStatus = "loading" | "success" | "error" | "no-token";
type ResendMessage = { type: "success" | "error"; text: string } | null;

export function useVerifyEmailPageController() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<VerifyEmailStatus>(token ? "loading" : "no-token");
  const [message, setMessage] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState<ResendMessage>(null);

  useEffect(() => {
    if (!token) {
      setStatus("no-token");
      return;
    }

    let cancelled = false;

    const verifyEmail = async () => {
      try {
        const response = await authApi.verifyEmail(token);

        if (cancelled) {
          return;
        }

        if (response.success) {
          setStatus("success");
          setMessage(response.message || "이메일 인증이 완료되었습니다.");
        } else {
          setStatus("error");
          setMessage(response.message || "이메일 인증에 실패했습니다.");
        }
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        console.error("Email verification error:", requestError);
        setStatus("error");
        setMessage("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
      }
    };

    void verifyEmail();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleResendChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setResendEmail(event.target.value);
    if (resendMessage) {
      setResendMessage(null);
    }
  };

  const handleResendSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resendEmail.trim()) {
      return;
    }

    setResendLoading(true);
    setResendMessage(null);

    try {
      const response = await authApi.resendVerification(resendEmail);
      setResendMessage({
        type: response.success ? "success" : "error",
        text: response.message || (response.success
          ? "인증 이메일이 재발송되었습니다."
          : "재발송에 실패했습니다."),
      });
    } catch (requestError) {
      console.error("Resend verification error:", requestError);
      setResendMessage({
        type: "error",
        text: "네트워크 오류가 발생했습니다.",
      });
    } finally {
      setResendLoading(false);
    }
  };

  return {
    status,
    message,
    resendEmail,
    resendLoading,
    resendMessage,
    handleResendChange,
    handleResendSubmit,
    goToLogin: () => router.push(AUTH_ROUTES.login),
  };
}
