import * as React from "react";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import { cn } from "@/lib/utils";
import { AUTH_FIELD_CONTROL_CLASS_NAME } from "@/components/auth/field-styles";
import {
  FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
  FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME,
  FieldMessageText,
} from "@/components/app/ui/field-message";

interface FormFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "error"> {
  label: string;
  /** A problem with the field. It shows in the label-row slot, never below the input. */
  error?: string;
  /** Informational hint for the slot; it shows only while the field has no message of its own. */
  labelTrailing?: React.ReactNode;
  /**
   * The field's one message for the label-row slot: one label line tall, cut
   * with an ellipsis when it does not fit. When given (even as `null`) it takes
   * the place of `error`.
   */
  message?: { tone: "hint" | "error" | "ok"; text: string } | null;
  "data-component"?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  (
    {
      label,
      error,
      labelTrailing,
      message,
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
    // Callers pass copy already normalized through the problem contract; no
    // legacy string adapter re-processing here.
    const resolved = message !== undefined ? message : error ? { tone: "error" as const, text: error } : null;
    const hasError = resolved?.tone === "error";
    const trailingContent = resolved
      ? (
          <FieldMessageText id={errorId} tone={resolved.tone} data-component="desktop_auth_form-field_message">
            {resolved.text}
          </FieldMessageText>
        )
      : labelTrailing;

    return (
      <TitleTextInputMolecule
        {...props}
        ref={ref}
        id={fieldId}
        label={label}
        value={value}
        onChange={onChange}
        error={hasError}
        containerClassName="gap-2"
        inputClassName={cn(AUTH_FIELD_CONTROL_CLASS_NAME, className)}
        labelRowClassName={FIELD_MESSAGE_LABEL_ROW_CLASS_NAME}
        labelTrailing={trailingContent}
        labelTrailingClassName={FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME}
        dataComponent="desktop_auth_form-field"
        inputDataComponent={dataComponent}
        labelRowDataComponent="desktop_auth_form-field_label-row"
        labelTrailingDataComponent={trailingContent ? "desktop_auth_form-field_label-row_trailing" : undefined}
        aria-describedby={resolved ? errorId : undefined}
        aria-invalid={hasError}
      />
    );
  }
);
FormField.displayName = "FormField";
