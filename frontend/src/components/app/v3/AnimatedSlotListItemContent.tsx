"use client";

import { cloneElement, createElement, isValidElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type AnimatedSlotListItemIcon = LucideIcon | ReactNode;

export interface AnimatedSlotListItemContentProps {
  icon: AnimatedSlotListItemIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  dataComponent?: string;
  iconContainerClassName?: string;
  iconClassName?: string;
  contentClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  metaClassName?: string;
}

export function AnimatedSlotListItemContent({
  icon: Icon,
  title,
  subtitle,
  meta,
  status,
  dataComponent = "animated-slot-list-item-content",
  iconContainerClassName,
  iconClassName,
  contentClassName,
  titleClassName,
  subtitleClassName,
  metaClassName,
}: AnimatedSlotListItemContentProps) {
  const hasSupportingContent = Boolean(subtitle || meta);
  const iconClassNames = cn(
    "h-[calc(20px*var(--v3-ui-scale,1))] w-[calc(20px*var(--v3-ui-scale,1))]",
    iconClassName
  );
  const isIconComponent =
    typeof Icon === "function" ||
    (typeof Icon === "object" &&
      Icon !== null &&
      ("render" in Icon || "type" in Icon));
  const iconNode = isValidElement<{ className?: string }>(Icon) ? (
    cloneElement(Icon, {
      className: cn(Icon.props.className, iconClassNames),
    })
  ) : isIconComponent ? (
    createElement(Icon as LucideIcon, { className: iconClassNames })
  ) : (
    <span className={cn("text-[calc(14px*var(--v3-ui-scale,1))] font-bold leading-none", iconClassName)}>
      {Icon}
    </span>
  );

  return (
    <>
      <div
        data-component={`${dataComponent}-icon`}
        className={cn(
          "flex h-[calc(44px*var(--v3-ui-scale,1))] w-[calc(44px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-text-muted shadow-md",
          iconContainerClassName
        )}
      >
        {iconNode}
      </div>

      <div
        data-component={`${dataComponent}-content`}
        className={cn("min-w-0 flex-1", contentClassName)}
      >
        <div
          data-component={`${dataComponent}-title-row`}
          className={cn(
            "flex items-center gap-[calc(8px*var(--v3-ui-scale,1))]",
            hasSupportingContent && "mb-[calc(2px*var(--v3-ui-scale,1))]"
          )}
        >
          <span
            data-component={`${dataComponent}-title`}
            className={cn(
              "truncate text-[calc(13.6px*var(--v3-ui-scale,1))] font-bold text-v3-dark",
              titleClassName
            )}
          >
            {title}
          </span>
        </div>

        {subtitle ? (
          <div
            data-component={`${dataComponent}-subtitle`}
            className={cn(
              "flex items-center gap-[calc(8px*var(--v3-ui-scale,1))] truncate text-[calc(11.2px*var(--v3-ui-scale,1))] text-v3-text-muted",
              subtitleClassName
            )}
          >
            {subtitle}
          </div>
        ) : null}

        {meta ? (
          <div
            data-component={`${dataComponent}-meta`}
            className={cn(
              "mt-[calc(6px*var(--v3-ui-scale,1))] flex items-center gap-[calc(12px*var(--v3-ui-scale,1))] overflow-hidden whitespace-nowrap text-[calc(10.4px*var(--v3-ui-scale,1))] leading-none text-v3-text-muted",
              metaClassName
            )}
          >
            {meta}
          </div>
        ) : null}
      </div>

      {status ? (
        <div data-component={`${dataComponent}-status`} className="shrink-0">
          {status}
        </div>
      ) : null}
    </>
  );
}
