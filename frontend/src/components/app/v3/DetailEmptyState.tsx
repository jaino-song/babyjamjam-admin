import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { ListEmptyState } from "./ListEmptyState";

export interface DetailEmptyStateProps {
  "data-component"?: string;
  message: string;
  icon?: LucideIcon;
  className?: string;
  action?: ReactNode;
}

export function DetailEmptyState({
  "data-component": dataComponent,
  message,
  icon: Icon,
  className,
  action,
}: DetailEmptyStateProps) {
  return (
    <ListEmptyState
      data-component={dataComponent}
      sourceComponent="DetailEmptyState"
      icon={Icon}
      message={message}
      className={className}
      action={action}
    />
  );
}
