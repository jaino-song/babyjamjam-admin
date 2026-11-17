import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface NotificationSettingsRowProps {
  /** Canonical data-component value for this row. */
  dataComponent: string;
  label: string;
  icon: LucideIcon;
  tone: "primary" | "orange" | "green" | "purple" | "muted" | "burgundy";
  description: ReactNode;
  rightContent?: ReactNode;
  className?: string;
}

export function NotificationSettingsRow({
  dataComponent,
  label,
  icon: Icon,
  tone,
  description,
  rightContent,
  className,
}: NotificationSettingsRowProps) {
  return (
    <div
      className={`list-item notification-settings-row ${className ?? ""}`}
      data-component={dataComponent}
      data-slot="notification-settings-row"
      data-source-component="NotificationSettingsRow"
    >
      <div
        className={`trigger-icon trigger-icon-${tone}`}
        data-component={`${dataComponent}_icon`}
        data-slot="trigger-icon"
      >
        <Icon size={18} strokeWidth={2.5} />
      </div>

      <div className="trigger-info" data-component={`${dataComponent}_info`} data-slot="trigger-info">
        <div className="trigger-title" data-component={`${dataComponent}_info_title`} data-slot="trigger-title">
          {label}
        </div>
        <div className="trigger-meta" data-component={`${dataComponent}_info_meta`} data-slot="trigger-meta">
          {description}
        </div>
      </div>

      {rightContent ? (
        <div className="notification-row-control" data-component={`${dataComponent}_control`} data-slot="notification-row-control">
          {rightContent}
        </div>
      ) : null}
    </div>
  );
}
