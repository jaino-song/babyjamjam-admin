import type { LucideIcon } from "lucide-react";

import { ListEmptyState } from "./ListEmptyState";

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
    <ListEmptyState
      name={name}
      icon={Icon}
      message={message}
      className={className}
    />
  );
}
