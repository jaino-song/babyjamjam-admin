"use client";

import React from "react";

import { AppContentCard } from "@/components/ui/app-surface";

interface InfoCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  "data-component"?: string;
}

export function InfoCard({
  title,
  children,
  className,
  contentClassName,
  "data-component": dataComponent = "info-card",
}: InfoCardProps) {
  return (
    <AppContentCard
      data-component={dataComponent}
      variant="muted"
      title={title}
      titleVariant="eyebrow"
      titleElement="h3"
      titleDataComponent="info-card-title"
      contentClassName={contentClassName ?? "block"}
      className={className}
    >
      {children}
    </AppContentCard>
  );
}
