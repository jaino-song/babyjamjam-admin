interface TestimonialCardProps {
  quote: string;
  author: string;
  rating?: number;
  date?: string;
  serviceBadge?: string;
  serviceBadgeColor?: "primary" | "secondary" | "accent";
  dataComponent?: string;
  staggerIndex?: number;
}

const badgeColors: Record<string, React.CSSProperties> = {
  primary: {
    background: "var(--color-primary-100)",
    color: "var(--color-primary-700)",
  },
  secondary: {
    background: "var(--color-secondary-100)",
    color: "var(--color-secondary-700)",
  },
  accent: {
    background: "var(--color-accent-100)",
    color: "var(--color-accent-700)",
  },
};

export function TestimonialCard({
  quote,
  author,
  rating = 5,
  date,
  serviceBadge,
  serviceBadgeColor = "primary",
  dataComponent,
  staggerIndex = 0,
}: TestimonialCardProps) {
  const initial = author.charAt(0);

  return (
    <div
      data-component={dataComponent ?? "testimonial"}
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-neutral-200)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-6)",
        animation: "fadeInUp var(--duration-normal) var(--ease-out)",
        animationFillMode: "both",
        animationDelay: `${staggerIndex * 50}ms`,
        transition: "all var(--duration-normal) var(--ease-default)",
      }}
    >
      <div
        data-component={dataComponent ? `${dataComponent}-stars` : "testimonial-stars"}
        style={{
          color: "var(--color-accent-500)",
          fontSize: "var(--text-lg)",
          marginBottom: "var(--space-3)",
          letterSpacing: "2px",
        }}
        aria-label={`별점 ${rating}점`}
      >
        {Array.from({ length: rating }, () => "\u2733").join("")}
        {Array.from({ length: 5 - rating }, () => "\u2734").join("")}
      </div>
      {serviceBadge && (
        <span
          style={{
            display: "inline-flex",
            padding: "2px 8px",
            borderRadius: "var(--radius-full)",
            fontSize: "var(--text-xs)",
            fontWeight: "var(--font-medium)" as string,
            marginBottom: "var(--space-3)",
            ...badgeColors[serviceBadgeColor],
          }}
        >
          {serviceBadge}
        </span>
      )}
      <p
        data-component={dataComponent ? `${dataComponent}-quote` : "testimonial-quote"}
        style={{
          fontSize: "var(--text-sm)",
          color: "var(--color-neutral-700)",
          lineHeight: "var(--leading-relaxed)",
          marginBottom: "var(--space-4)",
        }}
      >
        {quote}
      </p>
      <div
        data-component={dataComponent ? `${dataComponent}-author` : "testimonial-author"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "var(--radius-full)",
            background: "var(--color-primary-100)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-primary-600)",
            fontWeight: "var(--font-semibold)" as string,
            fontSize: "var(--text-sm)",
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ display: "flex", flexDirection: "column" as const }}>
          <span
            style={{
              fontSize: "var(--text-sm)",
              fontWeight: "var(--font-semibold)" as string,
              color: "var(--color-neutral-800)",
            }}
          >
            {author}
          </span>
          {date && (
            <span
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-neutral-400)",
              }}
            >
              {date}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
