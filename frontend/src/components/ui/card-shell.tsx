import * as React from "react";
import { Card } from "@/components/ui/card";
import { APP_SURFACE_CARD_CLASS_NAME } from "@/components/ui/app-surface";
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
        APP_SURFACE_CARD_CLASS_NAME,
        "flex flex-col gap-6 overflow-hidden",
        animated && "animate-scale-in",
        className
      )}
    />
  );
}
