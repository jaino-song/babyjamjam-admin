import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "error"> {
  label: string;
  error?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, id, className, ...props }, ref) => {
    const fieldId = id || label.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="space-y-2">
        <Label htmlFor={fieldId}>{label}</Label>
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
            className="text-sm text-destructive animate-fade-in"
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);
FormField.displayName = "FormField";
