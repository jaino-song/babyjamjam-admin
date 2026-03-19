import * as React from "react";
import { cn } from "@/lib/utils";

export interface SurfaceFrameProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  "data-component"?: string;
  dataComponents?: {
    container?: string;
    glow?: string;
    inner?: string;
  };
}

export function SurfaceFrame({
  children,
  className,
  innerClassName,
  "data-component": dataComponent,
  dataComponents,
}: SurfaceFrameProps) {
  const componentName = dataComponent ?? "surface-frame";
  const componentSlots = {
    container: dataComponents?.container ?? `${componentName}-container`,
    glow: dataComponents?.glow ?? `${componentName}-glow`,
    inner: dataComponents?.inner ?? `${componentName}-inner`,
  };

  return (
    <div
      data-component={componentSlots.container}
      className={cn(
        "relative flex !h-auto min-h-full w-full items-start justify-center py-4 md:py-8 lg:items-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        data-component={componentSlots.glow}
        className="pointer-events-none absolute inset-x-0 top-2 mx-auto h-40 w-full max-w-[640px] rounded-full bg-[radial-gradient(circle_at_top,_rgba(18,54,106,0.16),_transparent_72%)] blur-3xl"
      />

      <div
        data-component={componentSlots.inner}
        className={cn("relative flex h-full w-[85%] max-w-[460px] flex-col", innerClassName)}
      >
        {children}
      </div>
    </div>
  );
}
