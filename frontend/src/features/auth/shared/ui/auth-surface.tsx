import * as React from "react";

import { AuthPanel } from "@/components/auth/auth-panel";
import { MobileAuthCardContainer } from "@/features/auth/shared/mobile/mobile-auth-card-container";
import { cn } from "@/lib/utils";

export type AuthSurfaceVariant = "desktop" | "mobile";

interface AuthSurfaceProps {
  variant: AuthSurfaceVariant;
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  disableAnimation?: boolean;
  mobileWrapperClassName?: string;
  "data-component"?: string;
  dataComponents?: {
    container?: string;
    card?: string;
    header?: string;
    headerActions?: string;
    title?: string;
    subtitle?: string;
    content?: string;
  };
}

export function AuthSurface({
  variant,
  children,
  title,
  subtitle,
  className,
  contentClassName,
  disableAnimation = false,
  mobileWrapperClassName,
  "data-component": dataComponent,
  dataComponents,
}: AuthSurfaceProps) {
  if (variant === "mobile") {
    return (
      <div className={cn("flex h-full items-center justify-center", mobileWrapperClassName)}>
        <MobileAuthCardContainer
          data-component={dataComponent}
          dataComponents={dataComponents}
          title={typeof title === "string" ? title : undefined}
          subtitle={typeof subtitle === "string" ? subtitle : undefined}
          className={cn("max-w-[400px] border bg-card text-card-foreground shadow-lg", className)}
          contentClassName={contentClassName}
          disableAnimation={disableAnimation}
        >
          {children}
        </MobileAuthCardContainer>
      </div>
    );
  }

  return (
    <AuthPanel
      data-component={dataComponent}
      dataComponents={dataComponents}
      title={title}
      subtitle={subtitle}
      className={className}
      contentClassName={contentClassName}
      disableAnimation={disableAnimation}
    >
      {children}
    </AuthPanel>
  );
}
