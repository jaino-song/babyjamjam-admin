interface MiniBarsProps {
  "data-component"?: string;
  values: number[];
  labels?: string[];
  highlightLastIndex?: boolean;
  height?: number;
  className?: string;
}

/**
 * Small daily trend. Long series keep every bar and space out date labels.
 */
export function MiniBars({
  "data-component": dataComponent,
  values,
  labels,
  highlightLastIndex = true,
  height = 56,
  className,
}: MiniBarsProps) {
  const max = Math.max(1, ...values);
  const lastIndex = values.length - 1;
  const isLongSeries = values.length > 7;
  const labelIndexes = new Set(
    isLongSeries
      ? Array.from({ length: 6 }, (_, index) => Math.round((index * lastIndex) / 5))
      : values.map((_, index) => index),
  );
  const sub = (part: string) => dataComponent ? `${dataComponent}_${part}` : undefined;
  const columns = { gridTemplateColumns: `repeat(${Math.max(1, values.length)}, minmax(0, 1fr))` };

  return (
    <div data-component={dataComponent} data-source-component="MiniBars" className={`min-w-0 ${className ?? ""}`}>
      <div data-component={sub("plot")} data-slot="mini-bars-plot" className="grid items-end gap-1.5" style={{ ...columns, height }}>
        {values.map((v, i) => {
          const isLast = highlightLastIndex && i === lastIndex;
          const pct = (v / max) * 100;
          return (
            <div
              key={i}
              data-component={sub(`bar-${i}`)}
              data-slot="mini-bars-bar"
              className={`min-w-0 rounded-t-md ${
                isLast ? "bg-v3-primary" : "bg-blue-300/60"
              }`}
              style={{ height: `${Math.max(pct, 4)}%` }}
              aria-label={`${labels?.[i] ?? i + 1}: ${v}`}
              title={`${labels?.[i] ?? i + 1}: ${v}`}
            />
          );
        })}
      </div>
      {labels && labels.length > 0 && labels.length === values.length ? (
        <div data-component={sub("axis")} data-slot="mini-bars-axis" className="mt-1.5 grid gap-1.5 text-[0.6rem] tabular-nums text-v3-text-muted" style={columns}>
          {labels.map((label, index) => labelIndexes.has(index) ? (
            <span
              key={index}
              data-component={sub(`label-${index}`)}
              data-slot="mini-bars-label"
              className={`whitespace-nowrap ${index === 0 ? "justify-self-start" : index === lastIndex ? "justify-self-end" : "justify-self-center"}`}
              style={{ gridColumn: index + 1 }}
              title={label}
            >
              {isLongSeries ? label.replace(/^\d{4}[.-](\d{2})[.-](\d{2})$/, "$1.$2") : label}
            </span>
          ) : null)}
        </div>
      ) : null}
    </div>
  );
}
