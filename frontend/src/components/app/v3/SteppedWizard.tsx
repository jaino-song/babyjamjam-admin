"use client";

import React from "react";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";

export interface WizardStep {
  label: string;
  content: React.ReactNode;
  summary?: React.ReactNode;
}

export interface SteppedWizardProps {
  title: string;
  subtitle?: string;
  steps: WizardStep[];
  currentStep: number;
  onStepChange: (step: number) => void;
  onComplete: () => void;
  onBack?: () => void;
  backLabel?: string;
  nextLabel?: string;
  prevLabel?: string;
  completeLabel?: string;
  isSubmitting?: boolean;
  isNextDisabled?: boolean;
  className?: string;
}

function DesktopStepIndicator({
  steps,
  currentStep,
}: {
  steps: WizardStep[];
  currentStep: number;
}) {
  return (
    <div className="hidden md:flex items-center justify-center gap-0 px-12 pb-7">
      {steps.map((step, idx) => {
        const isCompleted = idx < currentStep;
        const isCurrent = idx === currentStep;

        return (
          <React.Fragment key={idx}>
            <div
              className={cn(
                "flex items-center gap-2",
                isCurrent && "text-v3-primary",
                isCompleted && "text-v3-dark"
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300",
                  isCompleted &&
                    "bg-v3-primary text-white shadow-[0_2px_8px_hsla(214,100%,34%,0.2)]",
                  isCurrent &&
                    "bg-v3-primary text-white shadow-[0_2px_12px_hsla(214,100%,34%,0.3)] scale-110",
                  !isCompleted &&
                    !isCurrent &&
                    "bg-v3-dim-white text-v3-text-muted border-2 border-v3-border"
                )}
              >
                {isCompleted ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-semibold",
                  isCurrent && "text-v3-primary font-bold",
                  isCompleted && "text-v3-dark",
                  !isCompleted && !isCurrent && "text-v3-text-muted"
                )}
              >
                {step.label}
              </span>
            </div>

            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "w-12 h-0.5 mx-2 rounded-full",
                  idx < currentStep ? "bg-v3-primary" : "bg-v3-border"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function MobileStepIndicator({
  steps,
  currentStep,
}: {
  steps: WizardStep[];
  currentStep: number;
}) {
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className="md:hidden px-6 pb-5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-bold text-v3-primary">
          {steps[currentStep]?.label}
        </span>
        <span className="text-[0.7rem] font-semibold text-v3-text-muted">
          {currentStep + 1} / {steps.length} 단계
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-v3-border overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-v3-primary to-blue-500 transition-all duration-400"
          style={{
            width: `${progress}%`,
            transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        />
      </div>
    </div>
  );
}

function CompletedStepSummary({
  step,
  stepIndex,
  onEdit,
}: {
  step: WizardStep;
  stepIndex: number;
  onEdit: () => void;
}) {
  if (!step.summary) return null;

  return (
    <>
      <div className="hidden md:block bg-v3-green-light rounded-[18px] p-4 mb-6">
        <div className="text-[0.7rem] uppercase tracking-[0.1em] text-v3-green font-semibold mb-3">
          ✓ {stepIndex + 1}단계 완료 — {step.label}
        </div>
        {step.summary}
      </div>

      <div className="md:hidden mb-5">
        <button
          type="button"
          onClick={onEdit}
          className="w-full bg-v3-green-light rounded-2xl p-3.5 flex items-center justify-between border-[1.5px] border-transparent hover:border-[hsl(137,40%,80%)] active:border-[hsl(137,40%,80%)] transition-all"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-v3-green flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
            </div>
            <div className="text-left">
              <div className="text-[0.8rem] font-bold text-v3-dark">
                {stepIndex + 1}단계: {step.label}
              </div>
            </div>
          </div>
          <span className="text-[0.7rem] font-semibold text-v3-primary px-3 py-1.5 rounded-[10px] bg-v3-primary-light shrink-0">
            수정
          </span>
        </button>
      </div>
    </>
  );
}

export function SteppedWizard({
  title,
  subtitle,
  steps,
  currentStep,
  onStepChange,
  onComplete,
  onBack,
  backLabel,
  nextLabel = "다음",
  prevLabel = "이전",
  completeLabel = "완료",
  isSubmitting = false,
  isNextDisabled = false,
  className,
}: SteppedWizardProps) {
  const isMobile = useIsMobile();
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  const isNextButtonDisabled = isSubmitting || isNextDisabled;
  const currentStepData = steps[currentStep];

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      onStepChange(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstStep) {
      onStepChange(currentStep - 1);
    }
  };

  return (
    <div className={cn("flex flex-col", className)}>
      {onBack && backLabel && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[0.85rem] md:text-[0.85rem] text-[0.8rem] font-semibold text-v3-text-muted hover:text-v3-primary transition-colors mb-4 md:mb-6 self-start"
        >
          <ChevronLeft className="w-5 h-5 md:w-5 md:h-5 w-[18px] h-[18px]" />
          {backLabel}
        </button>
      )}

      <div
        data-component="stepped-wizard"
        className={cn(
          "bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden",
          isMobile && "flex-1 min-h-[calc(100vh-80px-16px-48px)]"
        )}
      >
        <div className="pt-6 md:pt-8 px-6 md:px-8 text-center">
          <h2 className="text-lg md:text-xl font-extrabold text-v3-dark mb-1">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs md:text-[0.8rem] text-v3-text-muted mb-4 md:mb-7">
              {subtitle}
            </p>
          )}
        </div>

        <DesktopStepIndicator steps={steps} currentStep={currentStep} />
        <MobileStepIndicator steps={steps} currentStep={currentStep} />

        <div className="flex-1 overflow-y-auto px-6 md:px-8 pb-6 md:pb-8">
          {steps.map(
            (step, idx) =>
              idx < currentStep && (
                <CompletedStepSummary
                  key={idx}
                  step={step}
                  stepIndex={idx}
                  onEdit={() => onStepChange(idx)}
                />
              )
          )}

          {currentStepData && (
            <div>
              <div className="text-[0.7rem] uppercase tracking-[0.1em] text-v3-text-muted font-semibold mb-4 md:mb-5">
                {currentStep + 1}단계 — {currentStepData.label}
              </div>
              {currentStepData.content}
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex items-center justify-between border-t border-v3-border",
            "px-6 md:px-8 py-4 md:py-5",
            isMobile &&
              "sticky bottom-0 bg-white rounded-b-[28px] shadow-[0_-4px_20px_hsla(214,50%,20%,0.06)]"
          )}
        >
          <button
            type="button"
            onClick={handlePrev}
            disabled={isFirstStep}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 md:px-5 py-2.5 md:py-2.5 rounded-[14px] border-[1.5px] border-v3-border",
              "bg-white text-[0.8rem] md:text-[0.85rem] font-semibold text-v3-text-muted transition-all",
              "hover:border-v3-text-muted",
              isFirstStep && "opacity-0 pointer-events-none"
            )}
          >
            <ChevronLeft className="w-4 h-4" />
            {prevLabel}
          </button>

          <span className="hidden md:block text-xs text-v3-text-muted font-semibold">
            {currentStep + 1} / {steps.length} 단계
          </span>

          <button
            type="button"
            onClick={handleNext}
            disabled={isNextButtonDisabled}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-[14px] border-none",
              "bg-v3-primary text-[0.8rem] md:text-[0.85rem] font-bold text-white transition-all",
              "shadow-[0_2px_8px_hsla(214,100%,34%,0.2)]",
              "hover:bg-v3-primary-hover hover:-translate-y-px",
              "disabled:opacity-60 disabled:pointer-events-none",
              isMobile
                ? "flex-1 ml-2 px-6 py-3"
                : "px-7 py-2.5"
            )}
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                {isLastStep ? completeLabel : nextLabel}
                {!isLastStep && (
                  <ChevronRight className="w-4 h-4" />
                )}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
