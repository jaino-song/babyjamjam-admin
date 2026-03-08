interface StatDisplayProps {
  label: string;
  value: string;
  suffix?: string;
  description?: string;
  dataComponent?: string;
  light?: boolean;
  staggerIndex?: number;
}

export function StatDisplay({
  label,
  value,
  suffix,
  description,
  dataComponent,
  light = false,
  staggerIndex = 0,
}: StatDisplayProps) {
  return (
    <div
      data-component={dataComponent ?? "stat"}
      style={{
        textAlign: "center",
        animation: "fadeInUp var(--duration-normal) var(--ease-out)",
        animationFillMode: "both",
        animationDelay: `${staggerIndex * 50}ms`,
      }}
    >
      <div
        style={{
          fontSize: "var(--text-5xl)",
          fontWeight: "var(--font-bold)" as string,
          lineHeight: 1,
          marginBottom: "var(--space-2)",
          color: light ? "inherit" : "var(--color-primary-500)",
        }}
      >
        {value}
        {suffix}
      </div>
      <div
        style={{
          fontSize: "var(--text-base)",
          color: light ? "inherit" : "var(--color-neutral-600)",
          opacity: light ? 0.9 : 1,
        }}
      >
        {label}
      </div>
      {description && (
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-neutral-500)",
            marginTop: "var(--space-1)",
          }}
        >
          {description}
        </div>
      )}
    </div>
  );
}
