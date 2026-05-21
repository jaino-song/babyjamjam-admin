interface SparklineProps {
  values: number[];
  color?: string;
  height?: number;
  className?: string;
}

/**
 * Pure-SVG sparkline (no client JS needed). Renders the values as a smooth area
 * + line. Auto-scales to the max value. Empty input renders a flat baseline.
 */
export function Sparkline({
  values,
  color = "#004aad",
  height = 40,
  className,
}: SparklineProps) {
  const width = 240;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const yFor = (v: number) => height - 6 - (v / max) * (height - 12);

  const points = values.map((v, i) => `${(i * step).toFixed(1)},${yFor(v).toFixed(1)}`);
  const line = points.length ? `M${points.join(" L")}` : "";
  const area = points.length
    ? `M0,${height} L${points.join(" L")} L${width},${height} Z`
    : "";
  const lastX = (values.length - 1) * step;
  const lastY = values.length ? yFor(values[values.length - 1]) : height;
  const gradId = `spark-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${gradId})`} />}
      {line && <path d={line} stroke={color} strokeWidth={1.5} fill="none" />}
      {values.length > 0 && (
        <circle cx={lastX} cy={lastY} r={3} fill={color} />
      )}
    </svg>
  );
}
