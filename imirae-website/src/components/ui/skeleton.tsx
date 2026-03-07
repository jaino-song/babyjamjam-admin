interface SkeletonProps {
  variant?: "text" | "circular" | "rectangular";
  width?: string;
  height?: string;
  dataComponent?: string;
}

export function Skeleton({
  variant = "text",
  width = "100%",
  height = "1em",
  dataComponent,
}: SkeletonProps) {
  const borderRadius =
    variant === "circular" ? "var(--radius-full)" : "var(--radius-md)";

  return (
    <div
      data-component={dataComponent ?? "skeleton"}
      style={{
        width,
        height,
        borderRadius,
        background: "var(--color-neutral-200)",
        animation: "skeletonPulse 1.5s ease-in-out infinite",
      }}
      aria-hidden="true"
    />
  );
}
