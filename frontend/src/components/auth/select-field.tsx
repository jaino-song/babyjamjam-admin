
import * as React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AUTH_FIELD_CONTROL_CLASS_NAME } from "@/components/auth/field-styles";
import {
  FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
  FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME,
  FieldMessageText,
} from "@/components/app/ui/field-message";

interface SelectFieldProps {
  label: string;
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: { value: string; label: string }[];
  /** A problem with the field. It shows in the label-row slot, never below the select. */
  error?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Informational hint for the slot; it shows only while the field has no error. */
  labelTrailing?: React.ReactNode;
  "data-component"?: string;
}

export function SelectField({
  label,
  value,
  onValueChange,
  placeholder,
  options,
  error,
  disabled,
  id,
  className,
  labelTrailing,
  "data-component": dataComponent,
}: SelectFieldProps) {
  const fieldId = id || label.toLowerCase().replace(/\s+/g, "-");
  const errorId = `${fieldId}-error`;
  const trailingContent = error ? (
    // Callers pass copy already normalized through the problem contract.
    <FieldMessageText id={errorId} tone="error" data-component="desktop_auth_form-field_message">
      {error}
    </FieldMessageText>
  ) : labelTrailing;

  return (
    <div className="flex flex-col gap-2" data-component={dataComponent}>
      <div
        data-component="desktop_auth_form-field_label-row"
        className={cn("flex items-center justify-between gap-2", FIELD_MESSAGE_LABEL_ROW_CLASS_NAME)}
      >
        <Label htmlFor={fieldId} className="shrink-0 whitespace-nowrap">{label}</Label>
        {trailingContent ? (
          <div
            data-component="desktop_auth_form-field_label-row_trailing"
            className={cn("flex items-center", FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME)}
          >
            {trailingContent}
          </div>
        ) : null}
      </div>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={fieldId}
          className={cn(
            "w-full shadow-none",
            AUTH_FIELD_CONTROL_CLASS_NAME,
            error && "border-destructive focus-visible:ring-destructive",
            className,
          )}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={!!error}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
