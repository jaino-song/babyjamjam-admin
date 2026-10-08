import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { ListEmptyState } from "./ListEmptyState";

export interface DetailEmptyStateProps {
  message: string;
  icon?: LucideIcon;
  className?: string;
  action?: ReactNode;
}

export function DetailEmptyState({
  message,
  icon: Icon,
  className,
  action,
}: DetailEmptyStateProps) {
  return (
    <ListEmptyState
      icon={Icon}
      message={message}
      className={className}
      action={action}
    />
  );
}
