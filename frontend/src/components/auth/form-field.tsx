import * as React from "react";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import { cn } from "@/lib/utils";
import { InlineFieldError } from "@/components/auth/inline-field-error";
import { AUTH_FIELD_CONTROL_CLASS_NAME } from "@/components/auth/field-styles";

interface FormFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "error"> {
  label: string;
  error?: string;
  hideErrorMessage?: boolean;
  labelTrailing?: React.ReactNode;
  errorDisplay?: "below" | "inline";
  "data-component"?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  (
    {
      label,
      error,
      hideErrorMessage = false,
      labelTrailing,
      errorDisplay = "below",
      id,
      className,
      value,
      onChange,
      "data-component": dataComponent,
      ...props
    },
    ref
  ) => {
    const fieldId = id || label.toLowerCase().replace(/\s+/g, "-");
    const errorId = `${fieldId}-error`;
    const shouldShowInlineError = errorDisplay === "inline";
    const trailingContent = labelTrailing ?? (
      shouldShowInlineError ? (
        <InlineFieldError id={errorId} message={error} />
      ) : undefined
    );

    return (
      <TitleTextInputMolecule
        {...props}
        ref={ref}
        id={fieldId}
        label={label}
        value={value}
        onChange={onChange}
        error={!!error}
        helperText={error && !hideErrorMessage && !shouldShowInlineError ? error : undefined}
        helperTextClassName="mt-2 text-sm animate-fade-in"
        helperTextId={errorId}
        containerClassName="gap-0"
        inputClassName={cn(AUTH_FIELD_CONTROL_CLASS_NAME, className)}
        labelTrailing={trailingContent}
        dataComponent="form-field"
        inputDataComponent={dataComponent}
        labelRowDataComponent="form-field-label-row"
        labelTrailingDataComponent={trailingContent ? "form-field-label-trailing" : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={!!error}
      />
    );
  }
);
FormField.displayName = "FormField";
