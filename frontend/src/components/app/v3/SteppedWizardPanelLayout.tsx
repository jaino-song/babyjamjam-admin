"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface SteppedWizardPanelContentProps {
  children: React.ReactNode;
  feedback?: React.ReactNode;
  dataComponent?: string;
  stepContentDataComponent?: string;
  flattenStepContent?: boolean;
  className?: string;
  stepContentClassName?: string;
}

interface SteppedWizardPanelFooterProps {
  children: React.ReactNode;
  dataComponent?: string;
  className?: string;
}

export const STEPPED_WIZARD_PANEL_CONTENT_CLASS_NAME = "px-[20%] py-6 h-full min-h-0 flex flex-col gap-6";
export const STEPPED_WIZARD_PANEL_STEP_CONTENT_CLASS_NAME = "flex flex-1 min-h-0 flex-col p-1";
export const STEPPED_WIZARD_PANEL_FOOTER_CLASS_NAME =
  "shrink-0 bg-white px-[20%] pt-4 pb-4 border-t border-v3-border flex items-center justify-between gap-2";

export const SteppedWizardPanelContent = React.forwardRef<
  HTMLDivElement,
  SteppedWizardPanelContentProps
>(function SteppedWizardPanelContent(
  {
    children,
    feedback,
    dataComponent = "stepped-wizard-panel-content",
    stepContentDataComponent = "stepped-wizard-step-content",
    flattenStepContent = false,
    className,
    stepContentClassName,
  },
  ref,
) {
  if (flattenStepContent) {
    return (
      <div
        ref={ref}
        data-component={dataComponent}
        className={cn(
          STEPPED_WIZARD_PANEL_CONTENT_CLASS_NAME,
          "flex-1",
          className,
          stepContentClassName,
        )}
      >
        {children}
        {feedback}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-component={dataComponent}
      className={cn(STEPPED_WIZARD_PANEL_CONTENT_CLASS_NAME, className)}
    >
      <div
        data-component={stepContentDataComponent}
        className={cn(STEPPED_WIZARD_PANEL_STEP_CONTENT_CLASS_NAME, stepContentClassName)}
      >
        {children}
      </div>
      {feedback}
    </div>
  );
});

export function SteppedWizardPanelFooter({
  children,
  dataComponent = "stepped-wizard-actions",
  className,
}: SteppedWizardPanelFooterProps) {
  return (
    <div
      data-component={dataComponent}
      className={cn(STEPPED_WIZARD_PANEL_FOOTER_CLASS_NAME, className)}
    >
      {children}
    </div>
  );
}
