import * as React from "react";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import { cn } from "@/lib/utils";
import { InlineFieldError } from "@/components/auth/inline-field-error";
import { AUTH_FIELD_CONTROL_CLASS_NAME } from "@/components/auth/field-styles";
import {
  FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
  FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME,
  FieldMessageText,
} from "@/components/app/ui/field-message";

interface FormFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "error"> {
  label: string;
  error?: string;
  hideErrorMessage?: boolean;
  labelTrailing?: React.ReactNode;
  errorDisplay?: "below" | "inline";
  /**
   * Opt-in single message slot at the right end of the label row: one label
   * line tall, cut with an ellipsis when it does not fit. Passing the prop
   * (even as `null`) switches the field to this mode: `error` and
   * `errorDisplay` are ignored and nothing renders below the input.
   */
  message?: { tone: "hint" | "error" | "ok"; text: string } | null;
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
    const usesMessageSlot = message !== undefined;
    const hasMessageError = message?.tone === "error";
    const shouldShowInlineError = errorDisplay === "inline";
    const inlineError =
      shouldShowInlineError ? (
        <InlineFieldError
          id={errorId}
          // Callers pass copy already normalized through the problem
          // contract; no legacy string adapter re-processing here.
          message={error ?? undefined}
          reserveSpace
        />
      ) : undefined;
    const trailingContent = usesMessageSlot
      ? message
        ? (
            <FieldMessageText id={errorId} tone={message.tone} data-component="desktop_auth_form-field_message">
              {message.text}
            </FieldMessageText>
          )
        : labelTrailing
      : shouldShowInlineError
        ? labelTrailing ? (
            <div className="flex items-center gap-2">
              {labelTrailing}
              {inlineError}
            </div>
          ) : inlineError
        : labelTrailing;
    const hasError = usesMessageSlot ? hasMessageError : !!error;

    return (
      <TitleTextInputMolecule
        {...props}
        ref={ref}
        id={fieldId}
        label={label}
        value={value}
        onChange={onChange}
        error={hasError}
        helperText={!usesMessageSlot && error && !hideErrorMessage && !shouldShowInlineError ? error : undefined}
        helperTextClassName="text-sm animate-fade-in"
        helperTextId={errorId}
        containerClassName="gap-2"
        inputClassName={cn(AUTH_FIELD_CONTROL_CLASS_NAME, className)}
        labelRowClassName={usesMessageSlot ? FIELD_MESSAGE_LABEL_ROW_CLASS_NAME : undefined}
        labelTrailing={trailingContent}
        labelTrailingClassName={usesMessageSlot ? FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME : undefined}
        dataComponent="desktop_auth_form-field"
        inputDataComponent={dataComponent}
        labelRowDataComponent="desktop_auth_form-field_label-row"
        labelTrailingDataComponent={shouldShowInlineError || trailingContent ? "desktop_auth_form-field_label-row_trailing" : undefined}
        aria-describedby={usesMessageSlot ? (message ? errorId : undefined) : error ? errorId : undefined}
        aria-invalid={hasError}
      />
    );
  }
);
FormField.displayName = "FormField";
