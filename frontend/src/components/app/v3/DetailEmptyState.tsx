import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DetailEmptyStateProps {
  message: string;
  name?: string;
  icon?: LucideIcon;
  className?: string;
}

export function DetailEmptyState({
  message,
  name,
  icon: Icon,
  className,
}: DetailEmptyStateProps) {
  return (
    <div
      data-component={name}
      className={cn("flex h-full min-h-[calc(320px*var(--v3-ui-scale,1))] items-center justify-center", className)}
    >
      <div data-component={name ? `${name}-copy` : "detail-empty-state-copy"} className="text-center text-v3-text-muted">
        {Icon ? <Icon className="mx-auto mb-[calc(12px*var(--v3-ui-scale,1))] h-[calc(48px*var(--v3-ui-scale,1))] w-[calc(48px*var(--v3-ui-scale,1))] opacity-30" /> : null}
        <p className="text-[calc(12.8px*var(--v3-ui-scale,1))]">{message}</p>
      </div>
    </div>
  );
}
