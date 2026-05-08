"use client";

import { useIsMobile } from "@/hooks/useIsMobile";

export function useAuthShellVariant(): "desktop" | "mobile" {
  const isMobile = useIsMobile();
  return isMobile ? "mobile" : "desktop";
}
