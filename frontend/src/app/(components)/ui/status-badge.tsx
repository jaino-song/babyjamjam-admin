"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        // Service/Contract Status
        waiting: "bg-warning/10 text-warning border border-warning/20",
        in_progress: "bg-info/10 text-info border border-info/20",
        completed: "bg-success/10 text-success border border-success/20",
        cancelled: "bg-muted text-muted-foreground border border-border",
        replacement_requested: "bg-destructive/10 text-destructive border border-destructive/20",

        // Document Status
        doc_created: "bg-muted text-muted-foreground border border-border",
        doc_requested: "bg-info/10 text-info border border-info/20",
        doc_opened: "bg-warning/10 text-warning border border-warning/20",
        doc_completed: "bg-success/10 text-success border border-success/20",
        doc_rejected: "bg-destructive/10 text-destructive border border-destructive/20",
        doc_revoked: "bg-destructive/10 text-destructive border border-destructive/20",
        doc_deleted: "bg-muted text-muted-foreground border border-border",

        // Generic
        default: "bg-secondary text-secondary-foreground border border-border",
        primary: "bg-primary/10 text-primary border border-primary/20",
        outline: "border border-border bg-transparent text-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-xs",
        default: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  children: React.ReactNode;
}

function StatusBadge({
  className,
  variant,
  size,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      className={cn(statusBadgeVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </span>
  );
}

export { StatusBadge, statusBadgeVariants };
