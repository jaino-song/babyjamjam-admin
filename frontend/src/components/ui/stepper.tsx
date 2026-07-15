"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepperProps {
  activeStep: number;
  children: React.ReactNode;
  className?: string;
}

interface StepProps {
  index?: number;
  active?: boolean;
  completed?: boolean;
  children: React.ReactNode;
  className?: string;
}

interface StepLabelProps {
  children: React.ReactNode;
  className?: string;
}

function Stepper({ activeStep, children, className }: StepperProps) {
  const steps = React.Children.toArray(children);

  return (
    <div className={cn("flex items-center w-full", className)}>
      {steps.map((step, index) => {
        const isActive = index === activeStep;
        const isCompleted = index < activeStep;
        const isLast = index === steps.length - 1;

        return (
          <React.Fragment key={index}>
            {React.isValidElement(step) &&
              React.cloneElement(step as React.ReactElement<StepProps>, {
                index,
                active: isActive,
                completed: isCompleted,
              })}
            {!isLast && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-2",
                  isCompleted ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Step({ active, completed, children, className }: StepProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-full border-2 text-sm font-medium transition-colors",
          completed
            ? "bg-primary border-primary text-primary-foreground"
            : active
            ? "border-primary text-primary bg-primary/10"
            : "border-muted-foreground/30 text-muted-foreground"
        )}
      >
        {completed ? (
          <Check className="w-4 h-4" />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function StepLabel({ children, className }: StepLabelProps) {
  return (
    <span className={cn("text-sm text-center", className)}>
      {children}
    </span>
  );
}

export { Stepper, Step, StepLabel };
