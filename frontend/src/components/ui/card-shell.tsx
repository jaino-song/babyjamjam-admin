import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface CardShellProps
  extends React.ComponentPropsWithoutRef<typeof Card> {
  animated?: boolean;
}

export function CardShell({
  className,
  animated = true,
  ...props
}: CardShellProps) {
  return (
    <Card
      {...props}
      className={cn(
        "relative w-full rounded-[28px] border border-white/70 bg-white/95 p-6 text-foreground shadow-[0_24px_80px_-32px_rgba(18,54,106,0.35)] backdrop-blur-sm sm:p-7",
        "flex flex-col gap-6 overflow-hidden",
        "before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-v3-primary/35 before:to-transparent",
        animated && "animate-scale-in",
        className
      )}
    />
  );
}
