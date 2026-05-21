interface MiniBarsProps {
  values: number[];
  labels?: string[];
  highlightLastIndex?: boolean;
  height?: number;
  className?: string;
}

/**
 * Simple bar chart for showing 7-day trends. The last bar is highlighted by
 * default. Labels under each bar.
 */
export function MiniBars({
  values,
  labels,
  highlightLastIndex = true,
  height = 56,
  className,
}: MiniBarsProps) {
  const max = Math.max(1, ...values);
  const lastIndex = values.length - 1;

  return (
    <div className={className}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {values.map((v, i) => {
          const isLast = highlightLastIndex && i === lastIndex;
          const pct = (v / max) * 100;
          return (
            <div
              key={i}
              className={`flex-1 rounded-t-md ${
                isLast ? "bg-v3-primary" : "bg-blue-300/60"
              }`}
              style={{ height: `${Math.max(pct, 4)}%` }}
              aria-label={`${labels?.[i] ?? i + 1}: ${v}`}
            />
          );
        })}
      </div>
      {labels && labels.length === values.length ? (
        <div className="mt-1.5 flex justify-between text-[0.6rem] tabular-nums text-v3-text-muted">
          {labels.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
