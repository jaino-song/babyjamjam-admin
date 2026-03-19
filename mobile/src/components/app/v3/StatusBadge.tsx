"use client";

import { StatusPill } from "@/components/app/ui/status-badge";

export type StatusType = 'active' | 'pending' | 'expired' | 'completed' | 'signed';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
}

const statusConfig: Record<StatusType, { variant: Parameters<typeof StatusPill>[0]["variant"]; defaultLabel: string }> = {
  active: { variant: "success", defaultLabel: "활성" },
  signed: { variant: "success", defaultLabel: "서명완료" },
  pending: { variant: "warning", defaultLabel: "대기" },
  expired: { variant: "danger", defaultLabel: "만료" },
  completed: { variant: "neutral", defaultLabel: "완료" },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <StatusPill data-component="status-badge" variant={config.variant} size="sm">
      {label || config.defaultLabel}
    </StatusPill>
  );
}
