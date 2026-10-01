"use client";

import * as React from "react";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
  FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME,
  FieldMessageText,
} from "@/components/app/ui/field-message";

export interface TitleTextareaMoleculeProps
  extends Omit<TextareaProps, "id"> {
  id?: string;
  label: React.ReactNode;
  onValueChange?: (value: string) => void;
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
  textareaClassName?: string;
  labelRowClassName?: string;
  labelClassName?: string;
  dataComponent?: string;
  textareaDataComponent?: string;
}

export const TitleTextareaMolecule = React.forwardRef<
  HTMLTextAreaElement,
  TitleTextareaMoleculeProps
>(
  (
    {
      id,
      label,
      value,
      onChange,
      onValueChange,
      required = false,
      helperText,
      helperTone = "error",
      helperTextClassName,
      helperTextId,
      containerClassName,
      textareaClassName,
      labelRowClassName,
      labelClassName,
      className,
      dataComponent = "desktop_v3_title-textarea-molecule",
      textareaDataComponent,
      ...textareaProps
    },
    ref
  ) => {
    const generatedId = useId();
    const fieldId = id ?? `title-textarea-${generatedId.replace(/:/g, "")}`;
    const helperElementId = helperText ? helperTextId ?? `${fieldId}-helper-text` : undefined;
    const describedBy = Array.from(
      new Set([textareaProps["aria-describedby"], helperElementId].filter(Boolean))
    ).join(" ") || undefined;

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
        <Textarea
          {...textareaProps}
          ref={ref}
          id={fieldId}
          value={value}
          required={required}
          data-component={textareaDataComponent}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange?.(event);
            onValueChange?.(event.target.value);
          }}
          className={cn(className, textareaClassName)}
        />
      </div>
    );
  }
);

TitleTextareaMolecule.displayName = "TitleTextareaMolecule";
