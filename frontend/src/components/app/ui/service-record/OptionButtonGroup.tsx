import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "OptionButtonGroup";

export interface OptionButtonGroupOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface OptionButtonGroupProps {
  "data-component": string;
  /** `multi` = checkbox-look squares in a `group`; `single` = round marks in a `radiogroup`. */
  mode: "multi" | "single";
  /** Id of the visible item title (see `ServiceRecordItemLabel`). */
  labelledBy: string;
  options: OptionButtonGroupOption[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
  /** Put on every option button, because focus lands on a button, not the group. */
  describedBy?: string;
  /** Visual error border only; no `aria-invalid` is set on the group. */
  invalid?: boolean;
  /** Id of the first option button, so a screen can focus it on a validation error. */
  firstOptionId?: string;
  /** Layout-only (never visual). */
  className?: string;
}

// Border colours carry `!` because globals.css has an unlayered
// `* { border-color }` reset that would otherwise beat layered utilities.
const OPTION_BASE =
  "inline-flex min-h-[calc(36px*var(--glint-ui-scale,1))] items-center gap-[calc(7px*var(--glint-ui-scale,1))] rounded-[12px] border-[1.5px] px-[calc(11px*var(--glint-ui-scale,1))] text-left text-[calc(12.5px*var(--glint-ui-scale,1))] transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-1 " +
  "disabled:cursor-not-allowed disabled:opacity-45";

/**
 * Checkbox-look option buttons. Both modes use `<button aria-pressed>`; single
 * mode only changes the group role and the indicator shape (no `role="radio"`,
 * no roving tabindex). The indicator is `aria-hidden`, so an option's accessible
 * name is its plain label text.
 */
export function OptionButtonGroup({
  "data-component": dataComponent,
  mode,
  labelledBy,
  options,
  selected,
  onToggle,
  disabled = false,
  describedBy,
  invalid = false,
  firstOptionId,
  className,
}: OptionButtonGroupProps) {
  const single = mode === "single";

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      role={single ? "radiogroup" : "group"}
      aria-labelledby={labelledBy}
      className={cn("flex flex-wrap gap-[calc(6px*var(--glint-ui-scale,1))]", className)}
    >
      {options.map((option, index) => {
        const isSelected = selected.includes(option.value);
        // Each option is its own named part: `${base}_option-<0-based index>`.
        const optionBase = `${dataComponent}_option-${index}`;
        return (
          <button
            key={option.value}
            id={index === 0 ? firstOptionId : undefined}
            type="button"
            data-component={optionBase}
            aria-pressed={isSelected}
            aria-describedby={describedBy}
            disabled={disabled || option.disabled}
            onClick={() => onToggle(option.value)}
            className={cn(
              OPTION_BASE,
              isSelected
                ? "border-v3-primary! bg-v3-primary-light font-semibold text-v3-primary"
                : cn("bg-white text-v3-text", invalid ? "border-v3-burgundy!" : "border-v3-border!"),
            )}
          >
            <span
              aria-hidden="true"
              data-component={`${optionBase}_indicator`}
              className={cn(
                "grid size-[calc(15px*var(--glint-ui-scale,1))] shrink-0 place-items-center border-2 text-[calc(10px*var(--glint-ui-scale,1))] leading-none",
                single ? "rounded-full" : "rounded-[5px]",
                isSelected
                  ? "border-v3-primary! bg-v3-primary text-white"
                  : "border-v3-text-muted/60! text-transparent",
              )}
            >
              {isSelected ? (single ? "●" : "✓") : null}
            </span>
            <span data-component={`${optionBase}_label`}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
