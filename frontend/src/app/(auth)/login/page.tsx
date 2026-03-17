"use client";

import { LoginPageDesktop } from "@/features/auth/login/desktop/login-page-desktop";
import { LoginPageMobile } from "@/features/auth/login/mobile/login-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function LoginPage() {
  const shellVariant = useAuthShellVariant();

  return shellVariant === "mobile" ? <LoginPageMobile /> : <LoginPageDesktop />;
}
