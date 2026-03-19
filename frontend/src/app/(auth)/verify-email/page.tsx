"use client";

import { VerifyEmailPageDesktop } from "@/features/auth/verify-email/desktop/verify-email-page-desktop";
import { VerifyEmailPageMobile } from "@/features/auth/verify-email/mobile/verify-email-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function VerifyEmailPage() {
  const shellVariant = useAuthShellVariant();

  return shellVariant === "mobile" ? <VerifyEmailPageMobile /> : <VerifyEmailPageDesktop />;
}
