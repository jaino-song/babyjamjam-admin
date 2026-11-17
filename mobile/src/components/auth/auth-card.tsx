import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface AuthCardProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
  contentClassName?: string;
  disableAnimation?: boolean;
  variant?: "default" | "v3";
  spacing?: "default" | "legal";
  /** Canonical data-component value for the surface that renders this card. */
  "data-component": string;
  "data-slot"?: string;
}

export function AuthCard({
  children,
  title,
  description,
  className,
  contentClassName,
  disableAnimation = false,
  variant = "default",
  spacing = "default",
  "data-component": dataComponent,
  "data-slot": dataSlot,
}: AuthCardProps) {
  const isV3 = variant === "v3";

  return (
    <div data-component={dataComponent} data-slot={dataSlot} data-source-component="AuthCard" className="auth-screen w-full">
      <Card
        className={cn(
          "w-full border-0 bg-transparent shadow-none",
          !disableAnimation && "animate-scale-in",
          className
        )}
      >
        {(title || description) && (
          <CardHeader className={cn("flex flex-col gap-1 px-0 text-center", isV3 && "pt-8 px-0 pb-2")}>
            {title && (
              <CardTitle className={cn("text-2xl font-bold", isV3 && "text-xl font-extrabold text-v3-dark")}>{title}</CardTitle>
            )}
            {description && (
              <CardDescription className={cn("text-base", isV3 && "text-[0.85rem] text-v3-text-muted")}>{description}</CardDescription>
            )}
          </CardHeader>
        )}
        <CardContent
          data-slot="auth-card-content"
          className={cn(
            "p-0",
            isV3 && "pb-8 pt-4",
            spacing === "legal" && "gap-[25px]! [&>.list-title]:h-auto! [&>.list-title]:min-h-0! [&>.list-title]:py-0! [&>p:last-child]:pt-[30px]",
            contentClassName
          )}
        >
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
