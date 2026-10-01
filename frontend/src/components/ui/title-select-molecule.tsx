"use client";

import * as React from "react";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
  FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME,
  FieldMessageText,
} from "@/components/app/ui/field-message";

export interface TitleSelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface TitleSelectMoleculeProps {
  id?: string;
  label: React.ReactNode;
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: TitleSelectOption[];
  disabled?: boolean;
  required?: boolean;
  /**
   * The field's message. It renders in the label-row slot (right of the label,
   * one line, cut with an ellipsis); nothing ever renders below the control.
   */
  helperText?: React.ReactNode;
  /** "error" (default) for a problem; "hint" for static guidance. */
  helperTone?: "error" | "hint";
  helperTextClassName?: string;
  helperTextId?: string;
  containerClassName?: string;
  triggerClassName?: string;
  labelClassName?: string;
  labelRowClassName?: string;
  contentClassName?: string;
  itemClassName?: string;
  dataComponent?: string;
  triggerDataComponent?: string;
  contentDataComponent?: string;
  optionDataComponent?: string;
}

export function TitleSelectMolecule({
  id,
  label,
  value,
  onValueChange,
  placeholder,
  options,
  disabled = false,
  required = false,
  helperText,
  helperTone = "error",
  helperTextClassName,
  helperTextId,
  containerClassName,
  triggerClassName,
  labelClassName,
  labelRowClassName,
  contentClassName,
  itemClassName,
  dataComponent = "desktop_v3_title-select-molecule",
  triggerDataComponent,
  contentDataComponent,
  optionDataComponent,
}: TitleSelectMoleculeProps) {
  const generatedId = useId();
  const fieldId = id ?? `title-select-${generatedId.replace(/:/g, "")}`;
  const helperElementId = helperText ? helperTextId ?? `${fieldId}-helper-text` : undefined;

  return (
    <div
      className={cn("flex flex-col gap-2", containerClassName)}
      data-component={dataComponent}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2",
          FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
          labelRowClassName,
        )}
      >
        <Label htmlFor={fieldId} className={cn("shrink-0 whitespace-nowrap", labelClassName)}>
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {helperText ? (
          <div className={cn("flex items-center", FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME)}>
            <FieldMessageText id={helperElementId} tone={helperTone} className={helperTextClassName}>
              {helperText}
            </FieldMessageText>
          </div>
        ) : null}
      </div>
      <Select
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger
          id={fieldId}
          className={cn("w-full", triggerClassName)}
          data-component={triggerDataComponent}
          aria-describedby={helperElementId}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          className={contentClassName}
          data-component={contentDataComponent}
        >
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={itemClassName}
              data-component={optionDataComponent}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
