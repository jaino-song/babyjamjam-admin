"use client";

import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  /** Display label below the circle. */
  label: string;
  /**
   * Whether this step is complete.
   * Ignored when `activeStep` is provided on the parent.
   */
  done?: boolean;
  /** Optional icon rendered inside the circle instead of the step number. */
  icon?: React.ReactNode;
}

type StepperSize = "sm" | "md" | "lg" | "fluid";

type StepState = "done" | "active" | "pending";

export interface StepperProps {
  /** Step definitions — length determines how many steps are shown. */
  steps: StepperStep[];
  /**
   * When set, step state is derived automatically:
   *  - index < activeStep  → done
   *  - index === activeStep → active (current)
   *  - index > activeStep  → pending
   *
   * Overrides individual `step.done` values.
   */
  activeStep?: number;
  /** Visual size. @default "md" */
  size?: StepperSize;
  /** Show a check icon for completed steps instead of the step number. @default false */
  showCheckOnDone?: boolean;
  /** Additional class names on the root wrapper. */
  className?: string;
  /** Additional class names on each connector — useful for widening spacing for long labels. */
  connectorClassName?: string;
  /** Collapse to the latest completed step and the next step when a detail header is too narrow. */
  collapseOnHeaderOverflow?: boolean;
  /** Collapse immediately when the parent layout already knows the full stepper will not fit. */
  forceCollapsed?: boolean;
}

const SIZE_MAP: Record<StepperSize, { root: string; circle: string; font: string; label: string; connector: string }> = {
  sm: {
    root: "px-[calc(4px*var(--v3-ui-scale,1))] pt-[calc(4px*var(--v3-ui-scale,1))] pb-[calc(20px*var(--v3-ui-scale,1))]",
    circle: "w-[calc(24px*var(--v3-ui-scale,1))] h-[calc(24px*var(--v3-ui-scale,1))]",
    font: "text-[calc(8.8px*var(--v3-ui-scale,1))]",
    label: "text-[calc(8px*var(--v3-ui-scale,1))]",
    connector: "min-w-[calc(40px*var(--v3-ui-scale,1))] px-[calc(6px*var(--v3-ui-scale,1))]",
  },
  md: {
    root: "px-[calc(4px*var(--v3-ui-scale,1))] pt-[calc(4px*var(--v3-ui-scale,1))] pb-[calc(20px*var(--v3-ui-scale,1))]",
    circle: "w-[calc(32px*var(--v3-ui-scale,1))] h-[calc(32px*var(--v3-ui-scale,1))]",
    font: "text-[calc(10.4px*var(--v3-ui-scale,1))]",
    label: "text-[calc(9.6px*var(--v3-ui-scale,1))]",
    connector: "min-w-[calc(64px*var(--v3-ui-scale,1))] px-[calc(8px*var(--v3-ui-scale,1))]",
  },
  lg: {
    root: "px-[calc(4px*var(--v3-ui-scale,1))] pt-[calc(4px*var(--v3-ui-scale,1))] pb-[calc(20px*var(--v3-ui-scale,1))]",
    circle: "w-[calc(40px*var(--v3-ui-scale,1))] h-[calc(40px*var(--v3-ui-scale,1))]",
    font: "text-[calc(12px*var(--v3-ui-scale,1))]",
    label: "text-[calc(11.2px*var(--v3-ui-scale,1))]",
    connector: "min-w-[calc(80px*var(--v3-ui-scale,1))] px-[calc(10px*var(--v3-ui-scale,1))]",
  },
  fluid: {
    root: "px-[calc(4px*var(--v3-ui-scale,1))] pt-[calc(4px*var(--v3-ui-scale,1))] pb-[calc(18px*var(--v3-ui-scale,1))]",
    circle: "w-[calc(32px*var(--v3-ui-scale,1))] h-[calc(32px*var(--v3-ui-scale,1))]",
    font: "text-[calc(10.4px*var(--v3-ui-scale,1))]",
    label: "text-[calc(9.6px*var(--v3-ui-scale,1))]",
    connector: "min-w-[calc(64px*var(--v3-ui-scale,1))] px-[calc(8px*var(--v3-ui-scale,1))]",
  },
};

function resolveState(step: StepperStep, index: number, activeStep?: number): StepState {
  if (activeStep !== undefined) {
    if (index < activeStep) return "done";
    if (index === activeStep) return "active";
    return "pending";
  }
  return step.done ? "done" : "pending";
}

const STATE_CIRCLE: Record<StepState, string> = {
  done:    "bg-v3-primary text-white",
  active:  "bg-v3-primary text-white ring-2 ring-v3-primary/30 ring-offset-1",
  pending: "bg-v3-dim-white text-v3-text-muted",
};

interface RenderedStepperStep {
  step: StepperStep;
  originalIndex: number;
}

function getLastDoneIndex(steps: StepperStep[], activeStep?: number): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (resolveState(steps[index], index, activeStep) === "done") {
      return index;
    }
  }

  return -1;
}

function getCollapsedSteps(steps: StepperStep[], activeStep?: number): RenderedStepperStep[] {
  if (steps.length <= 2) {
    return steps.map((step, originalIndex) => ({ step, originalIndex }));
  }

  const lastDoneIndex = getLastDoneIndex(steps, activeStep);
  let startIndex: number;

  if (lastDoneIndex < 0) {
    startIndex = 0;
  } else if (lastDoneIndex >= steps.length - 1) {
    startIndex = Math.max(0, steps.length - 2);
  } else {
    startIndex = lastDoneIndex;
  }

  return steps
    .slice(startIndex, startIndex + 2)
    .map((step, offset) => ({ step, originalIndex: startIndex + offset }));
}

export function Stepper({
  steps,
  activeStep,
  size = "md",
  showCheckOnDone = false,
  className,
  connectorClassName,
  collapseOnHeaderOverflow = false,
  forceCollapsed = false,
}: StepperProps) {
  const tokens = SIZE_MAP[size];
  const rootRef = React.useRef<HTMLDivElement>(null);
  const measurementRef = React.useRef<HTMLDivElement>(null);
  const [isHeaderOverflowing, setIsHeaderOverflowing] = React.useState(false);
  const isCollapsed = forceCollapsed || isHeaderOverflowing;
  const renderedSteps = isCollapsed
    ? getCollapsedSteps(steps, activeStep)
    : steps.map((step, originalIndex) => ({ step, originalIndex }));

  const renderStepItems = (items: RenderedStepperStep[], exposeDataComponents: boolean) => (
    items.map(({ step, originalIndex }, visibleIndex) => {
      const state = resolveState(step, originalIndex, activeStep);
      const nextItem = items[visibleIndex + 1];
      const nextState = nextItem
        ? resolveState(nextItem.step, nextItem.originalIndex, activeStep)
        : null;

      let indicator: React.ReactNode;
      if (step.icon) {
        indicator = step.icon;
      } else if (showCheckOnDone && state === "done") {
        indicator = (
          <Check
            className={cn(
              size === "sm" && "h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(12px*var(--v3-ui-scale,1))]",
              size === "md" && "h-[calc(14px*var(--v3-ui-scale,1))] w-[calc(14px*var(--v3-ui-scale,1))]",
              size === "lg" && "h-[calc(20px*var(--v3-ui-scale,1))] w-[calc(20px*var(--v3-ui-scale,1))]",
              size === "fluid" && "h-[calc(16px*var(--v3-ui-scale,1))] w-[calc(16px*var(--v3-ui-scale,1))]",
            )}
          />
        );
      } else {
        indicator = originalIndex + 1;
      }

      return (
        <React.Fragment key={`${originalIndex}-${step.label}`}>
          <div data-component={exposeDataComponents ? "stepper-step" : undefined} className="relative flex flex-col items-center">
            <div
              data-component={exposeDataComponents ? "stepper-circle" : undefined}
              className={cn(
                "rounded-full flex items-center justify-center font-bold",
                tokens.circle,
                tokens.font,
                STATE_CIRCLE[state],
              )}
            >
              {indicator}
            </div>
            <span
              data-component={exposeDataComponents ? "stepper-label" : undefined}
              className={cn(
                "absolute top-full mt-[calc(4px*var(--v3-ui-scale,1))] whitespace-nowrap",
                tokens.label,
                state === "done" ? "text-v3-primary" : "text-v3-text-muted",
              )}
            >
              {step.label}
            </span>
          </div>

          {visibleIndex < items.length - 1 && (
            <div
              data-component={exposeDataComponents ? "stepper-connector" : undefined}
              className={cn(
                "flex flex-1 items-center select-none",
                tokens.connector,
                connectorClassName,
              )}
            >
              <div
                className={cn(
                  "h-0.5 w-full rounded-full",
                  nextState === "done" || nextState === "active" ? "bg-v3-primary" : "bg-v3-border",
                )}
              />
            </div>
          )}
        </React.Fragment>
      );
    })
  );

  React.useLayoutEffect(() => {
    if (forceCollapsed || !collapseOnHeaderOverflow) {
      setIsHeaderOverflowing(false);
      return;
    }

    const root = rootRef.current;
    const measurement = measurementRef.current;
    const header = root?.closest<HTMLElement>('[data-component="detail-panel-header"]');
    const headerRow = header?.firstElementChild instanceof HTMLElement ? header.firstElementChild : null;
    const titleGroup = headerRow?.firstElementChild instanceof HTMLElement ? headerRow.firstElementChild : null;
    const trailingGroup = headerRow?.lastElementChild instanceof HTMLElement ? headerRow.lastElementChild : null;

    if (!root || !measurement || !header || !headerRow || !titleGroup || !trailingGroup) {
      setIsHeaderOverflowing(false);
      return;
    }

    const measure = () => {
      const rowStyle = window.getComputedStyle(headerRow);
      const rowGap = Number.parseFloat(rowStyle.columnGap || rowStyle.gap || "0") || 0;
      const rowWidth = headerRow.getBoundingClientRect().width;
      const currentStepperWidth = root.getBoundingClientRect().width;
      const fullStepperWidth = measurement.getBoundingClientRect().width;
      const currentTrailingWidth = trailingGroup.getBoundingClientRect().width;
      const fullTrailingWidth = Math.max(0, currentTrailingWidth - currentStepperWidth) + fullStepperWidth;
      const subtitle = titleGroup.querySelector<HTMLElement>('[data-component="detail-panel-subtitle"]');
      const requiredTitleWidth = Math.max(titleGroup.scrollWidth, subtitle?.scrollWidth ?? 0);
      const requiredWidth = requiredTitleWidth + rowGap + fullTrailingWidth;

      const nextIsOverflowing = requiredWidth > rowWidth + 1;
      setIsHeaderOverflowing((current) => (
        current === nextIsOverflowing ? current : nextIsOverflowing
      ));
    };

    measure();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(headerRow);
    resizeObserver?.observe(titleGroup);
    resizeObserver?.observe(trailingGroup);
    resizeObserver?.observe(measurement);
    window.addEventListener("resize", measure);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeStep, collapseOnHeaderOverflow, connectorClassName, forceCollapsed, size, steps, showCheckOnDone]);

  return (
    <div
      ref={rootRef}
      data-component="stepper"
      data-collapsed={isCollapsed ? "true" : "false"}
      className={cn("relative flex items-center", tokens.root, className)}
    >
      {renderStepItems(renderedSteps, true)}
      {collapseOnHeaderOverflow ? (
        <div
          ref={measurementRef}
          aria-hidden="true"
          className={cn(
            "pointer-events-none invisible fixed -left-[9999px] top-0 flex items-center",
            tokens.root,
            className,
          )}
        >
          {renderStepItems(steps.map((step, originalIndex) => ({ step, originalIndex })), false)}
        </div>
      ) : null}
    </div>
  );
}
