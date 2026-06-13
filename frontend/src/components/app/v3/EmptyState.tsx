import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  name?: string;
  className?: string;
}

export function EmptyState({ icon: Icon, message, name, className }: EmptyStateProps) {
  return (
    <div
      data-component={name}
      className={`flex h-full min-h-0 items-center justify-center rounded-[28px] bg-white shadow-v3 ${className ?? ""}`}
    >
      <div className="text-center text-v3-text-muted">
        {Icon && <Icon className="mx-auto mb-[calc(12px*var(--v3-ui-scale,1))] h-[calc(48px*var(--v3-ui-scale,1))] w-[calc(48px*var(--v3-ui-scale,1))] opacity-30" />}
        <p className="text-[calc(12.8px*var(--v3-ui-scale,1))]">{message}</p>
      </div>
    </div>
  );
}
