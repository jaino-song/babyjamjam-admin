import * as React from "react";
import { cn } from "@/lib/utils";
import { CardShell } from "@/components/ui/card-shell";
import { AuthPanelHeader } from "@/components/auth/auth-panel-header";

export interface AuthPanelProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  containerClassName?: string;
  className?: string;
  contentClassName?: string;
  disableAnimation?: boolean;
  headerActionsLeft?: React.ReactNode;
  headerActionsRight?: React.ReactNode;
  "data-component"?: string;
  dataComponents?: {
    container?: string;
    card?: string;
    headerActions?: string;
    header?: string;
    title?: string;
    subtitle?: string;
    content?: string;
  };
}

export function AuthPanel({
  children,
  title,
  subtitle,
  containerClassName,
  className,
  contentClassName,
  disableAnimation = false,
  headerActionsLeft,
  headerActionsRight,
  "data-component": dataComponent,
  dataComponents,
}: AuthPanelProps) {
  const hasHeaderActions = Boolean(headerActionsLeft || headerActionsRight);
  const componentName = dataComponent ?? "auth-panel";
  const componentSlots = {
    container: dataComponents?.container ?? `${componentName}-container`,
    card: dataComponents?.card ?? `${componentName}-card`,
    headerActions: dataComponents?.headerActions ?? `${componentName}-header-actions`,
    header: dataComponents?.header ?? `${componentName}-header`,
    title: dataComponents?.title ?? `${componentName}-title`,
    subtitle: dataComponents?.subtitle ?? `${componentName}-subtitle`,
    content: dataComponents?.content ?? `${componentName}-content`,
  };

  return (
    <div
      data-component={componentSlots.container}
      className={cn(
        "relative flex !h-auto min-h-full w-full items-start justify-center py-4 md:py-8 lg:items-center",
        containerClassName
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-2 mx-auto h-40 w-full max-w-[640px] rounded-full bg-[radial-gradient(circle_at_top,_rgba(18,54,106,0.16),_transparent_72%)] blur-3xl"
      />

      <div className="relative w-[85%] max-w-[460px]">
        <CardShell
          data-component={componentSlots.card}
          animated={!disableAnimation}
          className={className}
        >
          {hasHeaderActions ? (
            <div
              data-component={componentSlots.headerActions}
              className="flex items-center justify-between"
            >
              <div>{headerActionsLeft}</div>
              <div>{headerActionsRight}</div>
            </div>
          ) : null}

          <AuthPanelHeader
            title={title}
            subtitle={subtitle}
            dataComponent={componentSlots.header}
            titleDataComponent={componentSlots.title}
            subtitleDataComponent={componentSlots.subtitle}
          />

          <div
            data-component={componentSlots.content}
            className={cn("flex flex-col gap-6", contentClassName)}
          >
            {children}
          </div>
        </CardShell>
      </div>
    </div>
  );
}
