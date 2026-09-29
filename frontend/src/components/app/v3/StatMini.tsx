"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatMiniDensity = "default" | "responsive-square";

export interface StatMiniProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "onClick"> {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  colorIndex?: number;
  animationDelay?: React.CSSProperties["animationDelay"];
  isLoading?: boolean;
  counter?: string;
  density?: StatMiniDensity;
  className?: string;
  "data-component"?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  interactive?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-expanded"?: React.AriaAttributes["aria-expanded"];
  "aria-controls"?: string;
}

const colorVariants = [
  { bg: "bg-v3-primary-light", text: "text-v3-primary" },
  { bg: "bg-v3-orange-light", text: "text-v3-orange" },
  { bg: "bg-v3-green-light", text: "text-v3-green" },
  { bg: "bg-v3-burgundy-light", text: "text-v3-burgundy" },
] as const;

export const StatMini = React.forwardRef<HTMLButtonElement | HTMLDivElement, StatMiniProps>(
  function StatMini(
    {
      icon: Icon,
      value,
      label,
      colorIndex = 0,
      animationDelay,
      isLoading = false,
      counter = "",
      density = "default",
      className,
      "data-component": dataComponent = "desktop_v3_stat-mini",
      onClick,
      interactive = false,
      disabled = false,
      "aria-label": ariaLabel,
      "aria-expanded": ariaExpanded,
      "aria-controls": ariaControls,
      ...rest
    },
    ref,
  ) {
    const variant = colorVariants[colorIndex % colorVariants.length];
    const animationStyle = animationDelay ? { animationDelay } : undefined;
    const isResponsiveSquare = density === "responsive-square";
    const rootClassName = cn(
      isResponsiveSquare
        ? "flex h-auto min-h-[calc(96px*var(--glint-ui-scale,1))] aspect-square w-[calc(96px*var(--glint-ui-scale,1))] items-center justify-center whitespace-normal rounded-[20px] border-0 bg-white p-[calc(12px*var(--glint-ui-scale,1))] text-center shadow-v3 min-[961px]:min-h-[calc(85px*var(--glint-ui-scale,1))] min-[961px]:aspect-auto min-[961px]:w-[calc(176px*var(--glint-ui-scale,1))] min-[961px]:justify-start min-[961px]:gap-[calc(16px*var(--glint-ui-scale,1))] min-[961px]:p-[calc(16px*var(--glint-ui-scale,1))] min-[961px]:text-left"
        : "flex h-auto min-h-[calc(85px*var(--glint-ui-scale,1))] w-[calc(176px*var(--glint-ui-scale,1))] items-center justify-start gap-[calc(16px*var(--glint-ui-scale,1))] whitespace-normal rounded-[20px] border-0 bg-white p-[calc(16px*var(--glint-ui-scale,1))] shadow-v3",
      // Component-level animation so stats behave identically across pages.
      "animate-v3-pop-up",
      className,
    );

    const content = (
      <>
        <div
          data-component={`${dataComponent}_icon`}
          data-slot="stat-mini-icon"
          className={cn(
            "h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px]",
            isResponsiveSquare ? "hidden min-[961px]:flex" : "flex",
            isLoading ? "bg-v3-dim-white" : variant.bg,
          )}
        >
          {isLoading ? (
            <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(24px*var(--glint-ui-scale,1))] rounded-md bg-white/70" />
          ) : (
            <Icon
              className={`!h-[calc(24px*var(--glint-ui-scale,1))] !w-[calc(24px*var(--glint-ui-scale,1))] ${variant.text}`}
            />
          )}
        </div>
        {isLoading ? (
          <div
            data-slot="stat-mini-content"
            className={cn("min-w-0 space-y-[calc(8px*var(--glint-ui-scale,1))]", isResponsiveSquare && "min-[961px]:text-left")}
          >
            <Skeleton
              data-slot="stat-mini-value"
              className="h-[calc(33px*var(--glint-ui-scale,1))] w-[calc(64px*var(--glint-ui-scale,1))] bg-v3-dim-white"
            />
            <Skeleton
              data-slot="stat-mini-label"
              className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(80px*var(--glint-ui-scale,1))] bg-v3-dim-white"
            />
          </div>
        ) : (
          <div data-slot="stat-mini-content" className="min-w-0">
            <span
              data-slot="stat-mini-value-row"
              className={cn(
                "flex items-center gap-[calc(4px*var(--glint-ui-scale,1))]",
                isResponsiveSquare && "justify-center min-[961px]:justify-start",
              )}
            >
              <p
                data-slot="stat-mini-value"
                className="min-w-0 break-words text-[calc(24px*var(--glint-ui-scale,1))] font-bold text-v3-dark"
              >
                {value}
              </p>
              <p className="mb-[calc(4px*var(--glint-ui-scale,1))] self-end text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">{counter}</p>
            </span>
            <p data-slot="stat-mini-label" className="break-words text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">
              {label}
            </p>
          </div>
        )}
      </>
    );

    if (interactive || onClick) {
      return (
        <Button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          variant="ghost"
          data-component={dataComponent}
          data-slot="stat-mini"
          className={rootClassName}
          style={animationStyle}
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          aria-expanded={ariaExpanded}
          aria-controls={ariaControls}
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          {content}
        </Button>
      );
    }

    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        data-component={dataComponent}
        data-slot="stat-mini"
        className={rootClassName}
        style={animationStyle}
        {...rest}
      >
        {content}
      </div>
    );
  },
);

StatMini.displayName = "StatMini";
