"use client";

import { Button } from "@/components/ui";

interface ConsultationCtaButtonProps {
  dataComponent?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "outline" | "ghost";
  fullWidth?: boolean;
  children?: React.ReactNode;
}

export function ConsultationCtaButton({
  dataComponent,
  size = "lg",
  variant = "primary",
  fullWidth,
  children = "무료 상담 신청",
}: ConsultationCtaButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      onClick={() => window.dispatchEvent(new CustomEvent("open-consultation"))}
      dataComponent={dataComponent}
    >
      {children}
    </Button>
  );
}
