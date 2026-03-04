import * as React from "react";
import Link from "next/link";
import { Alert, type AlertProps } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface AlertCardDataComponents {
  root?: string;
  icon?: string;
  content?: string;
  closeButton?: string;
  message?: string;
  actionContainer?: string;
  actionLink?: string;
  actionButton?: string;
}

interface AlertCardProps
  extends Omit<AlertProps, "children" | "dataComponents" | "data-component"> {
  message: React.ReactNode;
  action?: React.ReactNode;
  actionLabel?: React.ReactNode;
  actionHref?: string;
  actionOnClick?: () => void;
  messageClassName?: string;
  actionClassName?: string;
  actionLinkClassName?: string;
  actionButtonClassName?: string;
  "data-component"?: string;
  dataComponents?: AlertCardDataComponents;
}

export function AlertCard({
  message,
  action,
  actionLabel,
  actionHref,
  actionOnClick,
  messageClassName,
  actionClassName,
  actionLinkClassName,
  actionButtonClassName,
  "data-component": dataComponent,
  dataComponents,
  ...alertProps
}: AlertCardProps) {
  const componentName = dataComponent ?? "alert-card";
  const componentSlots = {
    root: dataComponents?.root ?? componentName,
    icon: dataComponents?.icon ?? `${componentName}-icon`,
    content: dataComponents?.content ?? `${componentName}-content`,
    closeButton: dataComponents?.closeButton ?? `${componentName}-close-button`,
    message: dataComponents?.message ?? `${componentName}-message`,
    actionContainer:
      dataComponents?.actionContainer ?? `${componentName}-action-container`,
    actionLink: dataComponents?.actionLink ?? `${componentName}-action-link`,
    actionButton: dataComponents?.actionButton ?? `${componentName}-action-button`,
  };

  const shouldRenderAction = Boolean(action || actionLabel);

  return (
    <Alert
      {...alertProps}
      data-component={componentSlots.root}
      dataComponents={{
        root: componentSlots.root,
        icon: componentSlots.icon,
        content: componentSlots.content,
        closeButton: componentSlots.closeButton,
      }}
    >
      <div data-component={componentSlots.message} className={cn(messageClassName)}>
        {message}
      </div>

      {shouldRenderAction && (
        <div
          data-component={componentSlots.actionContainer}
          className={cn("mt-1", actionClassName)}
        >
          {action ||
            (actionHref ? (
              <Link
                href={actionHref}
                data-component={componentSlots.actionLink}
                className={cn("text-destructive underline hover:no-underline", actionLinkClassName)}
              >
                {actionLabel}
              </Link>
            ) : (
              <button
                type="button"
                onClick={actionOnClick}
                data-component={componentSlots.actionButton}
                className={cn("text-destructive underline hover:no-underline", actionButtonClassName)}
              >
                {actionLabel}
              </button>
            ))}
        </div>
      )}
    </Alert>
  );
}
