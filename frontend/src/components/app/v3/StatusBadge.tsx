"use client";

import { StatusPill } from "@/components/app/ui/status-badge";

export type StatusType = 'active' | 'pending' | 'terminated' | 'expired' | 'completed' | 'signed' | 'breastPump' | 'careCenter';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
}

const statusConfig: Record<StatusType, { variant: Parameters<typeof StatusPill>[0]["variant"]; defaultLabel: string }> = {
  active: { variant: "success", defaultLabel: "활성" },
  signed: { variant: "success", defaultLabel: "서명완료" },
  pending: { variant: "warning", defaultLabel: "대기" },
  terminated: { variant: "danger", defaultLabel: "중단" },
  expired: { variant: "danger", defaultLabel: "만료" },
  completed: { variant: "neutral", defaultLabel: "완료" },
  breastPump: { variant: "danger", defaultLabel: "유축기 대여" },
  careCenter: { variant: "primary", defaultLabel: "조리원 이용" },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <StatusPill data-component="status-badge" variant={config.variant} size="sm">
      {label || config.defaultLabel}
    </StatusPill>
  );
}
