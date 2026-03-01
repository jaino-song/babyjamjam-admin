import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CardContainerProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
  contentClassName?: string;
  disableAnimation?: boolean;
  "data-component"?: string;
  dataComponents?: {
    container?: string;
    card?: string;
    header?: string;
    title?: string;
    subtitle?: string;
    content?: string;
  };
}

export function CardContainer({
  children,
  title,
  subtitle,
  className,
  contentClassName,
  disableAnimation = false,
  "data-component": dataComponent,
  dataComponents,
}: CardContainerProps) {
  const hasHeader = Boolean(title || subtitle);
  const componentName = dataComponent ?? "card-container";
  const componentSlots = {
    container: dataComponents?.container ?? `${componentName}-container`,
    card: dataComponents?.card ?? `${componentName}-card`,
    header: dataComponents?.header ?? `${componentName}-header`,
    title: dataComponents?.title ?? `${componentName}-title`,
    subtitle: dataComponents?.subtitle ?? `${componentName}-subtitle`,
    content: dataComponents?.content ?? `${componentName}-content`,
  };

  return (
    <div
      data-component={componentSlots.container}
      className="flex min-h-screen items-center justify-center"
    >
      <Card
        data-component={componentSlots.card}
        className={cn(
          "w-full max-w-[440px] rounded-2xl border-none bg-white text-foreground shadow-v3 p-6",
          "flex flex-col overflow-hidden",
          !disableAnimation && "animate-scale-in",
          className
        )}
      >
        {hasHeader && (
          <div
            data-component={componentSlots.header}
            className="text-center"
          >
            {title && (
              <h2 data-component={componentSlots.title} className="text-lg md:text-xl font-extrabold text-v3-dark mb-1">
                {title}
              </h2>
            )}
            {subtitle && (
              <p data-component={componentSlots.subtitle} className="text-xs md:text-[0.8rem] text-v3-text-muted mb-4 md:mb-7">
                {subtitle}
              </p>
            )}
          </div>
        )}

        <div
          data-component={componentSlots.content}
          className={cn(contentClassName)}
        >
          {children}
        </div>
      </Card>
    </div>
  );
}
