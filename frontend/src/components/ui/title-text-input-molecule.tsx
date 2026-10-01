"use client";

import * as React from "react";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  FIELD_MESSAGE_LABEL_ROW_CLASS_NAME,
  FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME,
  FieldMessageText,
} from "@/components/app/ui/field-message";

export interface TitleTextInputMoleculeProps
  extends Omit<React.ComponentProps<typeof Input>, "id"> {
  id?: string;
  label: React.ReactNode;
  onValueChange?: (value: string) => void;
  required?: boolean;
  /**
   * The field's message. It renders in the label-row slot (right of the label,
   * one line, cut with an ellipsis) and replaces `labelTrailing` while shown;
   * nothing ever renders below the input.
   */
  helperText?: React.ReactNode;
  /** "error" (default) for a problem; "hint" for static guidance. */
  helperTone?: "error" | "hint";
  helperTextClassName?: string;
  helperTextId?: string;
  containerClassName?: string;
  inputClassName?: string;
  labelRowClassName?: string;
  labelClassName?: string;
  labelTrailing?: React.ReactNode;
  /** Merged into the trailing slot's classes, e.g. to let a long message wrap instead of staying on one line. */
  labelTrailingClassName?: string;
  dataComponent?: string;
  inputDataComponent?: string;
  labelRowDataComponent?: string;
  labelTrailingDataComponent?: string;
}

export const TitleTextInputMolecule = React.forwardRef<
  HTMLInputElement,
  TitleTextInputMoleculeProps
>(
  (
    {
      id,
      label,
      value,
      onChange,
      onValueChange,
      required = false,
      error = false,
      helperText,
      helperTone = "error",
      helperTextClassName,
      helperTextId,
      containerClassName,
      inputClassName,
      labelRowClassName,
      labelClassName,
      labelTrailing,
      labelTrailingClassName,
      variant = "v3",
      className,
      dataComponent = "desktop_v3_title-text-input-molecule",
      inputDataComponent,
      labelRowDataComponent,
      labelTrailingDataComponent,
      ...inputProps
    },
    ref
  ) => {
    const generatedId = useId();
    const fieldId = id ?? `title-text-input-${generatedId.replace(/:/g, "")}`;
    const helperElementId = helperText ? helperTextId ?? `${fieldId}-helper-text` : undefined;
    const describedBy = Array.from(
      new Set([inputProps["aria-describedby"], helperElementId].filter(Boolean))
    ).join(" ") || undefined;

    return (
      <div
        className={cn("grid gap-[calc(7px*var(--glint-ui-scale,1))]", containerClassName)}
        data-component={dataComponent}
      >
        <div
          data-component={labelRowDataComponent}
          className={cn(
            "flex items-center justify-between gap-2",
            helperText ? FIELD_MESSAGE_LABEL_ROW_CLASS_NAME : undefined,
            labelRowClassName,
          )}
        >
          <Label
            htmlFor={fieldId}
            className={cn(
              "shrink-0 whitespace-nowrap text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-text-muted",
              labelClassName,
            )}
          >
            {label}
            {required && <span className="ml-1 text-destructive">*</span>}
          </Label>
          {labelTrailing || helperText ? (
            <div
              data-component={labelTrailingDataComponent}
              className={cn(
                "flex min-h-[0.6875rem] shrink-0 items-center",
                helperText ? FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME : undefined,
                labelTrailingClassName,
              )}
            >
              {helperText ? (
                <FieldMessageText
                  id={helperElementId}
                  tone={helperTone}
                  className={helperTextClassName}
                >
                  {helperText}
                </FieldMessageText>
              ) : (
                labelTrailing
              )}
            </div>
          ) : null}
        </div>
        <Input
          {...inputProps}
          ref={ref}
          id={fieldId}
          value={value}
          variant={variant}
          required={required}
          error={error}
          data-component={inputDataComponent}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange?.(event);
            onValueChange?.(event.target.value);
          }}
          className={cn(className, inputClassName)}
        />
      </div>
    );
  }
);

TitleTextInputMolecule.displayName = "TitleTextInputMolecule";
