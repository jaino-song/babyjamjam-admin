import type { LucideIcon } from "lucide-react";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ListEmptyStateProps {
  message: string;
  name?: string;
  icon?: LucideIcon;
  className?: string;
}

export function ListEmptyState({
  message,
  name,
  icon: Icon = History,
  className,
}: ListEmptyStateProps) {
  return (
    <div
      data-component={name}
      className={cn("flex min-h-[320px] flex-1 items-center justify-center", className)}
    >
      <div data-component={name ? `${name}-copy` : "list-empty-state-copy"} className="text-center text-v3-text-muted">
        <Icon className="mx-auto mb-3 h-12 w-12 opacity-30" />
        <p className="text-[0.85rem]">{message}</p>
      </div>
    </div>
  );
}
