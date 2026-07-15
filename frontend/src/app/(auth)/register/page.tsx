"use client";

import { RegisterPageDesktop } from "@/features/auth/register/desktop/register-page-desktop";
import { RegisterPageMobile } from "@/features/auth/register/mobile/register-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function RegisterPage() {
  const shellVariant = useAuthShellVariant();

  return shellVariant === "mobile" ? <RegisterPageMobile /> : <RegisterPageDesktop />;
}
