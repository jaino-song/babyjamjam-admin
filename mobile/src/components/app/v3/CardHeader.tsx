"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CardHeaderProps {
  title?: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}

export function CardHeader({ title, subtitle, icon: Icon, actions, align = "left", className }: CardHeaderProps) {
  return (
    <div
      data-component="card-header"
      className={cn(
        "flex flex-col gap-4 animate-v3-slide-up",
        align === "left" && "md:flex-row md:items-center md:justify-between",
        align === "center" && "items-center text-center",
        className
      )}
    >
      <div data-component="card-header-title" className="flex flex-col gap-1">
        <h1 className={cn(
          "text-[1.75rem] font-bold text-v3-dark flex items-center gap-2",
          align === "center" && "justify-center"
        )}>
          {Icon && <Icon className="w-6 h-6 text-v3-primary" />}
          {title}
        </h1>
        {subtitle && (
          <p className="text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div data-component="card-header-actions" className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
