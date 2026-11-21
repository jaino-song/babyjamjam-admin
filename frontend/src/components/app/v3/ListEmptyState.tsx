import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ListEmptyStateProps {
  "data-component"?: string;
  message: string;
  icon?: LucideIcon;
  className?: string;
  /** Optional call to action rendered under the message. */
  action?: ReactNode;
}

export function ListEmptyState({
  "data-component": dataComponent = "desktop_v3_list-empty-state_copy",
  message,
  icon: Icon = History,
  className,
  action,
}: ListEmptyStateProps) {
  return (
    <div
      className={cn("flex min-h-full flex-1 items-center justify-center", className)}
    >
      <div data-component={dataComponent} className="text-center text-v3-text-muted">
        <Icon className="mx-auto mb-[calc(12px*var(--glint-ui-scale,1))] h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] opacity-30" />
        <p className="text-[calc(12.8px*var(--glint-ui-scale,1))]">{message}</p>
        {action ? (
          <div data-component={`${dataComponent}_action`} className="mt-[calc(16px*var(--glint-ui-scale,1))] flex justify-center">
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
