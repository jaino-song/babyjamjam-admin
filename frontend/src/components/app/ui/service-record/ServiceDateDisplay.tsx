import type { ReactNode } from "react";

const SOURCE_COMPONENT = "ServiceDateDisplay";

export interface ServiceDateDisplayProps {
  "data-component": string;
  /** Leading text of the chip, e.g. `3회차`. */
  label: ReactNode;
  /** The current (possibly revised) service date. */
  revised: ReactNode;
  /** The original planned date; shown muted as the `원본 …` line when given. */
  original?: ReactNode;
  /** Right-end slot for the screen's own button (e.g. `제공일 수정`). */
  action?: ReactNode;
  /** Slot below the chip row (e.g. the `같은 회차의 추가 기록` block). */
  children?: ReactNode;
  /** Layout-only (never visual). */
  className?: string;
}

/**
 * The session/date chip of the admin editor: label, the revised date and an
 * optional muted original date, with a right-end action slot and a slot below.
 * Presentational only; it renders no button of its own.
 */
export function ServiceDateDisplay({
  "data-component": dataComponent,
  label,
  revised,
  original,
  action,
  children,
  className,
}: ServiceDateDisplayProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className={className}
    >
      <div
        data-component={`${dataComponent}_row`}
        data-slot="date-row"
        className="flex items-baseline justify-between gap-[calc(8px*var(--glint-ui-scale,1))]"
      >
        <div
          data-component={`${dataComponent}_chip`}
          data-slot="datechip"
          className="inline-block min-w-0 rounded-full bg-v3-primary-light px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-bold text-v3-primary"
        >
          <span data-component={`${dataComponent}_chip_label`}>{label}</span>
          {" · "}
          <span
            data-component={`${dataComponent}_chip_date`}
            data-slot="date-display"
            className="inline-flex flex-wrap items-baseline gap-x-1 gap-y-px align-baseline"
          >
            <span
              data-component={`${dataComponent}_chip_date_revised`}
              data-slot="revised-date"
              className="whitespace-nowrap"
            >
              {revised}
            </span>
            {original ? (
              <span
                data-component={`${dataComponent}_chip_date_original`}
                data-slot="original-date"
                className="inline-block whitespace-nowrap font-medium text-v3-text-muted"
              >
                원본 {original}
              </span>
            ) : null}
          </span>
        </div>
        {action ? (
          <div data-component={`${dataComponent}_action`} className="shrink-0">
            {action}
          </div>
        ) : null}
      </div>
      {children ? <div data-component={`${dataComponent}_extra`}>{children}</div> : null}
    </div>
  );
}
