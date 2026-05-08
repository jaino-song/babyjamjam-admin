"use client";

import { ResetPasswordPageDesktop } from "@/features/auth/reset-password/desktop/reset-password-page-desktop";
import { ResetPasswordPageMobile } from "@/features/auth/reset-password/mobile/reset-password-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function ResetPasswordPage() {
  const shellVariant = useAuthShellVariant();

  return shellVariant === "mobile" ? <ResetPasswordPageMobile /> : <ResetPasswordPageDesktop />;
}
