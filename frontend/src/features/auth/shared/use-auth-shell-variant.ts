"use client";

import { useSyncExternalStore } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";

type AuthShellVariant = "desktop" | "mobile";
const subscribe = () => () => {};

export function useAuthShellVariant(): AuthShellVariant;
export function useAuthShellVariant(opts: { deferUntilMounted: true }): AuthShellVariant | null;
export function useAuthShellVariant(opts?: { deferUntilMounted?: boolean }): AuthShellVariant | null {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const isMobile = useIsMobile();

  if (opts?.deferUntilMounted && !mounted) {
    return null;
  }

  return isMobile ? "mobile" : "desktop";
}
