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
      className={cn("flex h-full min-h-[320px] items-center justify-center", className)}
    >
      <div data-component={name ? `${name}-copy` : "detail-empty-state-copy"} className="text-center text-v3-text-muted">
        {Icon ? <Icon className="mx-auto mb-3 h-12 w-12 opacity-30" /> : null}
        <p className="text-[0.8rem]">{message}</p>
      </div>
    </div>
  );
}
