import * as React from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps extends Omit<InputProps, "error"> {
  label: string;
  error?: string;
  labelClassName?: string;
  errorClassName?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, id, className, labelClassName, errorClassName, ...props }, ref) => {
    const fieldId = id || label.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId} className={labelClassName}>{label}</Label>
        <Input
          ref={ref}
          id={fieldId}
          error={!!error}
          className={cn(className)}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          aria-invalid={!!error}
          {...props}
        />
        {error && (
          <p
            id={`${fieldId}-error`}
            className={cn("text-sm text-destructive animate-fade-in", errorClassName)}
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);
FormField.displayName = "FormField";
