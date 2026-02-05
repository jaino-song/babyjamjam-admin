"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

export interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  badge?: React.ReactNode;
  showSeparator?: boolean;
}

function FormSection({
  title,
  badge,
  showSeparator = false,
  className,
  children,
  ...props
}: FormSectionProps) {
  return (
    <>
      {showSeparator && <Separator className="my-4" />}
      <div className={cn("space-y-3", className)} {...props}>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-primary">{title}</h4>
          {badge}
        </div>
        {children}
      </div>
    </>
  );
}

export { FormSection };
