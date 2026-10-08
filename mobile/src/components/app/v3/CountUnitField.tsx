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
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabled?: boolean;
  maxLength?: number;
  /** Layout-only (never visual). */
  className?: string;
}

/**
 * One horizontal "label · number · unit" box, 48px tall, that never stacks at
 * any width. It is `type="text"` + `inputMode` (no spinners, `maxLength` works).
 * The whole box is a `<label>`, so tapping the caption focuses the input.
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
        "flex h-12 min-w-0 items-center gap-2 rounded-[12px] border-[1.5px] bg-white px-3 text-sm text-v3-text transition-colors",
        "focus-within:border-v3-primary",
        invalid ? "border-v3-burgundy" : "border-v3-border",
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
        type="text"
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
        className="h-full min-w-0 flex-1 bg-transparent text-right text-[17px] font-semibold text-v3-dark outline-none placeholder:font-normal placeholder:text-v3-text-muted placeholder:opacity-60 disabled:cursor-not-allowed disabled:text-v3-text-muted"
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
      className={cn("flex gap-2 [&>*]:min-w-0 [&>*]:flex-1", className)}
    >
      {children}
    </div>
  );
}
