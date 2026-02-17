export interface StepperStep {
  label: string;
  done: boolean;
}

interface StepperProps {
  steps: StepperStep[];
  className?: string;
}

export function Stepper({ steps, className }: StepperProps) {
  return (
    <div className={`flex items-center gap-0 ${className ?? ""}`}>
      {steps.map((step, idx) => (
        <div key={step.label} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[0.65rem] font-bold ${
                step.done
                  ? "bg-v3-primary text-white"
                  : "bg-v3-dim-white text-v3-text-muted"
              }`}
            >
              {idx + 1}
            </div>
            <span className="text-[0.6rem] text-v3-text-muted mt-1 whitespace-nowrap">
              {step.label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`w-8 h-0.5 mx-1 mt-[-12px] ${
                steps[idx + 1].done ? "bg-v3-primary" : "bg-v3-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
