import type { LucideIcon } from "lucide-react";

import { DetailPanel } from "./DetailPanel";
import { ListEmptyState } from "./ListEmptyState";

export interface EmptyStateProps {
  "data-component"?: string;
  icon?: LucideIcon;
  message: string;
  className?: string;
}

export function EmptyState({ "data-component": dataComponent, icon: Icon, message, className }: EmptyStateProps) {
  return (
    <DetailPanel data-component={dataComponent ?? "desktop_v3_split-layout_detail-panel"}
      emptyState={
        <ListEmptyState
          data-component={dataComponent ? `${dataComponent}_overlay_copy` : undefined}
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
