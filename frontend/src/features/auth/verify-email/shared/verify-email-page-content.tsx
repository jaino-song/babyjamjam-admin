"use client";

import { AlertTriangle, CheckCircle } from "lucide-react";

import { FormField } from "@/components/auth/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/app/ui/LoadingState";
import { MobileInput } from "@/features/auth/shared/mobile/mobile-input";
import { MobileInputField } from "@/features/auth/shared/mobile/mobile-input-field";
import { AuthSurface, type AuthSurfaceVariant } from "@/features/auth/shared/ui/auth-surface";
import { cn } from "@/lib/utils";
import { useVerifyEmailPageController } from "@/features/auth/verify-email/shared/use-verify-email-page-controller";

interface VerifyEmailPageContentProps {
  variant: AuthSurfaceVariant;
}

export function VerifyEmailPageContent({ variant }: VerifyEmailPageContentProps) {
  const {
    status,
    message,
    resendEmail,
    resendLoading,
    resendMessage,
    handleResendChange,
    handleResendSubmit,
    goToLogin,
  } = useVerifyEmailPageController();

  const actionButtonClassName = cn("w-full", variant === "mobile" && "rounded-full");

  const cardTitle =
    status === "loading"
      ? "이메일 인증"
      : status === "success"
        ? "인증 완료!"
        : status === "error"
          ? "인증 실패"
          : "이메일 확인 필요";

  const showResendForm = status === "error" || status === "no-token";

  return (
    <AuthSurface
      variant={variant}
      data-component="desktop_auth_verify-email"
      dataComponents={{
        container: "desktop_auth_verify-email",
        card: "desktop_auth_verify-email_card",
        header: "desktop_auth_verify-email_header",
        title: "desktop_auth_verify-email_title",
        subtitle: "desktop_auth_verify-email_subtitle",
        content: "desktop_auth_verify-email_content",
      }}
      title={cardTitle}
      contentClassName="flex flex-col gap-6"
      mobileWrapperClassName="px-4 py-6"
    >
      {status === "loading" ? (
        <LoadingState data-component="desktop_auth_verify-email_loading" label="이메일 인증 중" size="lg" />
      ) : status === "success" ? (
        <div data-component="desktop_auth_verify-email_success" className="flex flex-col items-center gap-4 text-center">
          <div data-component="desktop_auth_verify-email_success_icon" className="rounded-full bg-success/10 p-3">
            <CheckCircle className="h-12 w-12 text-success" />
          </div>
          <p className="text-muted-foreground">{message}</p>
          <Button
            data-component="desktop_auth_verify-email_success_login-btn"
            variant="positive"
            size="lg"
            className={actionButtonClassName}
            onClick={goToLogin}
          >
            로그인하기
          </Button>
        </div>
      ) : (
        <div
          data-component={status === "error" ? "desktop_auth_verify-email_error" : "desktop_auth_verify-email_no-token"}
          className="flex flex-col items-center gap-4 text-center"
        >
          <div
            data-component={status === "error" ? "desktop_auth_verify-email_error-icon" : "desktop_auth_verify-email_no-token-icon"}
            className={cn(
              "rounded-full p-3",
              status === "error" ? "bg-destructive/10" : "bg-warning/10",
            )}
          >
            <AlertTriangle className={cn("h-12 w-12", status === "error" ? "text-destructive" : "text-warning")} />
          </div>
          <p className="text-muted-foreground">
            {status === "error" ? message : "이메일에서 인증 링크를 클릭해 주세요."}
          </p>

          {showResendForm ? (
            <>
              <Alert variant="info" className="w-full text-left">
                {status === "error"
                  ? "인증 링크가 만료되었거나 이미 사용된 경우, 아래에서 재발송을 요청할 수 있어요."
                  : "인증 이메일을 받지 못하셨나요? 아래에서 재발송을 요청할 수 있습니다."}
              </Alert>

              <form onSubmit={handleResendSubmit} data-component="desktop_auth_verify-email_resend-form" className="flex w-full flex-col gap-3">
                {variant === "mobile" ? (
                  <MobileInputField
                    title="이메일 주소"
                    className="gap-2"
                    labelClassName="text-sm"
                    inputProps={{
                      id: "verify-email-resend",
                      type: "email",
                      value: resendEmail,
                      onChange: handleResendChange,
                      disabled: resendLoading,
                    }}
                    renderInput={(resolvedInputProps) => (
                      <MobileInput
                        {...resolvedInputProps}
                        data-component="desktop_auth_verify-email_resend-form_field"
                      />
                    )}
                  />
                ) : (
                  <FormField
                    label="이메일 주소"
                    type="email"
                    value={resendEmail}
                    onChange={handleResendChange}
                    disabled={resendLoading}
                    data-component="desktop_auth_verify-email_resend-form_field"
                  />
                )}

                {resendMessage ? (
                  <Alert variant={resendMessage.type === "success" ? "success" : "destructive"}>
                    {resendMessage.text}
                  </Alert>
                ) : null}

                <Button
                  data-component="desktop_auth_verify-email_resend-form_btn"
                  type="submit"
                  variant="positive-outline"
                  size="lg"
                  className={actionButtonClassName}
                  disabled={resendLoading || !resendEmail.trim()}
                  loading={resendLoading}
                  loadingLabel="인증 메일 보내는 중"
                >
                  인증 이메일 재발송
                </Button>
              </form>
            </>
          ) : null}

          <Button
            data-component="desktop_auth_verify-email_login-btn"
            variant="link"
            onClick={goToLogin}
          >
            로그인 페이지로 돌아가기
          </Button>
        </div>
      )}
    </AuthSurface>
  );
}
