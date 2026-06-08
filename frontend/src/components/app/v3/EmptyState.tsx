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
      className={`bg-white rounded-[28px] shadow-v3 flex items-center justify-center h-full min-h-0 ${className ?? ""}`}
    >
      <div className="text-center text-v3-text-muted">
        {Icon && <Icon className="w-12 h-12 mx-auto mb-3 opacity-30" />}
        <p className="text-[0.8rem]">{message}</p>
      </div>
    </div>
  );
}
