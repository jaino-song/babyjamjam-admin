import type { ReactElement } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  label: string;
  "data-component": string;
  size?: "sm" | "default" | "lg";
  inline?: boolean;
  /** Layout classes only. */
  className?: string;
}

export function LoadingState({
  label,
  "data-component": dataComponent,
  size = "default",
  inline = false,
  className,
}: LoadingStateProps): ReactElement {
  const Component = inline ? "span" : "div";

  return (
    <Component
      role="status"
      aria-label={label}
      data-component={dataComponent}
      data-slot="loading-state"
      data-source-component="LoadingState"
      className={cn(inline ? "inline-flex items-center" : "flex items-center justify-center py-12", className)}
    >
      <Spinner size={size} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Component>
  );
}
