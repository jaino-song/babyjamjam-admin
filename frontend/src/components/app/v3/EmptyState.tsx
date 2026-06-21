import type { LucideIcon } from "lucide-react";

import { DetailPanel } from "./DetailPanel";
import { ListEmptyState } from "./ListEmptyState";

export interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  name?: string;
  className?: string;
}

export function EmptyState({ icon: Icon, message, name, className }: EmptyStateProps) {
  return (
    <DetailPanel
      emptyState={
        <ListEmptyState
          name={name}
          icon={Icon}
          message={message}
          className={className}
        />
      }
    >
      {null}
    </DetailPanel>
  );
}
