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
        "relative w-full rounded-[28px] border-0 bg-white p-6 text-foreground shadow-v3 sm:p-7",
        "flex flex-col gap-6 overflow-hidden",
        animated && "animate-scale-in",
        className
      )}
    />
  );
}
