"use client";

import { ForgotPasswordPageDesktop } from "@/features/auth/forgot-password/desktop/forgot-password-page-desktop";
import { ForgotPasswordPageMobile } from "@/features/auth/forgot-password/mobile/forgot-password-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function ForgotPasswordPage() {
  const shellVariant = useAuthShellVariant();

  return shellVariant === "mobile" ? <ForgotPasswordPageMobile /> : <ForgotPasswordPageDesktop />;
}
