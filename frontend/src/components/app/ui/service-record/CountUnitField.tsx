import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "CountUnitField";
const ROW_SOURCE_COMPONENT = "CountUnitFieldRow";

export interface CountUnitFieldProps {
  "data-component": string;
  id: string;
  /** Visible, muted caption at the left of the box. */
  label: ReactNode;
  /** Visible, muted unit at the right of the box. */
  unit?: ReactNode;
  /** The input's accessible name (it overrides the visible caption). */
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  inputMode?: "numeric" | "decimal";
  /** `text` (default) keeps maxLength working; `number` filters non-numeric keys like a native number input. */
  type?: "text" | "number";
  /** Native `min` / `step`; only meaningful with `type="number"`. */
  min?: number;
  step?: number;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  maxLength?: number;
  /** Layout-only (never visual). */
  className?: string;
}

/**
 * One horizontal "label · number · unit" box, 38px tall, that never stacks at
 * any width. It is `type="text"` + `inputMode` by default (no spinners, `maxLength`
 * works); `type="number"` gives the native number input (spinners hidden).
 * The whole box is a `<label>`, so clicking the caption focuses the input.
 */
export function CountUnitField({
  "data-component": dataComponent,
  id,
  label,
  unit,
  ariaLabel,
  value,
  onChange,
  onBlur,
  onFocus,
  inputMode = "numeric",
  type = "text",
  min,
  step,
  placeholder,
  invalid = false,
  describedBy,
  disabled = false,
  maxLength,
  className,
}: CountUnitFieldProps) {
  return (
    <label
      htmlFor={id}
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className={cn(
        "flex h-[calc(38px*var(--glint-ui-scale,1))] min-w-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))] rounded-[13px] border-[1.35px] bg-white px-[calc(12px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] text-v3-text transition-colors",
        "focus-within:border-v3-primary!",
        invalid ? "border-v3-burgundy!" : "border-input!",
        disabled && "bg-v3-dim-white",
        className,
      )}
    >
      <span
        data-component={`${dataComponent}_label`}
        className="shrink-0 whitespace-nowrap text-v3-text-muted"
      >
        {label}
      </span>
      <input
        id={id}
        type={type}
        min={type === "number" ? min : undefined}
        step={type === "number" ? step : undefined}
        inputMode={inputMode}
        data-component={`${dataComponent}_input`}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        onFocus={onFocus}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-right text-[calc(14px*var(--glint-ui-scale,1))] font-semibold text-v3-dark outline-none placeholder:font-normal placeholder:text-v3-text-muted placeholder:opacity-60 disabled:cursor-not-allowed disabled:text-v3-text-muted",
          type === "number" &&
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
      {unit ? (
        <span
          data-component={`${dataComponent}_unit`}
          className="shrink-0 whitespace-nowrap text-v3-text-muted"
        >
          {unit}
        </span>
      ) : null}
    </label>
  );
}

export interface CountUnitFieldRowProps {
  "data-component": string;
  children: ReactNode;
  /** Layout-only (never visual). */
  className?: string;
}

/** A row of `CountUnitField`s: gap 8px, every child takes an equal share. */
export function CountUnitFieldRow({
  "data-component": dataComponent,
  children,
  className,
}: CountUnitFieldRowProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component={ROW_SOURCE_COMPONENT}
      className={cn("flex gap-[calc(8px*var(--glint-ui-scale,1))] [&>*]:min-w-0 [&>*]:flex-1", className)}
    >
      {children}
    </div>
  );
}
