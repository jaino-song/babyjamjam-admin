"use client";

import { CallbackPageDesktop } from "@/features/auth/callback/desktop/callback-page-desktop";
import { CallbackPageMobile } from "@/features/auth/callback/mobile/callback-page-mobile";
import { useAuthShellVariant } from "@/features/auth/shared/use-auth-shell-variant";

export default function AuthCallbackPage() {
  const shellVariant = useAuthShellVariant();

  return shellVariant === "mobile" ? <CallbackPageMobile /> : <CallbackPageDesktop />;
}
