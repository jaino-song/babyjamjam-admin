"use client";

import { getDefaultClientBadgeStatusToken, type ClientBadgeStatus } from "@babyjamjam/shared/tokens/status-badge";

import { StatusPill } from "@/components/app/ui/status-badge";

/**
 * ClientBadgeStatus plus the contract-only "rejected_by_reviewer" (반려됨, eformsign 071). It is not a
 * client badge status (no client badge shows it), so it stays out of the shared token table and
 * renders the solid `rejected_by_reviewer` StatusPill variant directly.
 */
export type StatusType = ClientBadgeStatus | "rejected_by_reviewer";

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
}

/** @deprecated @/components/app/ui/status-badge의 StatusBadge(variants+StatusPill)를 사용할 것 — 중복 구현 (BJJ-254) */
export function StatusBadge({ status, label }: StatusBadgeProps) {
  if (status === "rejected_by_reviewer") {
    return (
      <StatusPill variant="rejected_by_reviewer" size="sm">
        {label || "반려됨"}
      </StatusPill>
    );
  }
  const config = getDefaultClientBadgeStatusToken(status);
  return (
    <StatusPill variant={config.variant} size="sm">
      {label || config.defaultLabel}
    </StatusPill>
  );
}
