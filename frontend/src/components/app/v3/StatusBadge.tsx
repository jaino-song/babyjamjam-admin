"use client";

export type StatusType = 'active' | 'pending' | 'expired' | 'completed' | 'signed' | 'breastPump' | 'careCenter';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
}

const statusConfig: Record<StatusType, { bg: string; text: string; defaultLabel: string }> = {
  active: { bg: 'bg-v3-green-light', text: 'text-v3-green', defaultLabel: '활성' },
  signed: { bg: 'bg-v3-green-light', text: 'text-v3-green', defaultLabel: '서명완료' },
  pending: { bg: 'bg-v3-orange-light', text: 'text-v3-orange', defaultLabel: '대기' },
  expired: { bg: 'bg-v3-burgundy-light', text: 'text-v3-burgundy', defaultLabel: '만료' },
  completed: { bg: 'bg-v3-dim-white', text: 'text-v3-text-muted', defaultLabel: '완료' },
  breastPump: { bg: 'bg-v3-burgundy-light', text: 'text-v3-burgundy', defaultLabel: '유축기 대여' },
  careCenter: { bg: 'bg-v3-primary-light', text: 'text-v3-primary', defaultLabel: '조리원 이용' },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <span
      data-component="status-badge"
      className={`inline-flex items-center rounded-[50px] px-3 py-1 text-[0.65rem] font-semibold ${config.bg} ${config.text}`}
    >
      {label || config.defaultLabel}
    </span>
  );
}
