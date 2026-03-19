"use client";

import * as React from "react";
import { X } from "lucide-react";

import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FormDialogShellProps {
  dataComponent: string;
  title: React.ReactNode;
  description: React.ReactNode;
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dialogClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
}

export function FormDialogShell({
  dataComponent,
  title,
  description,
  eyebrow,
  children,
  footer,
  dialogClassName,
  contentClassName,
  footerClassName,
}: FormDialogShellProps) {
  return (
    <DialogContent
      data-component={dataComponent}
      showCloseButton={false}
      className={cn(
        "rounded-[28px] border-none bg-v3-dim-white p-0 shadow-[0_20px_60px_hsla(214,50%,20%,0.15)] overflow-hidden gap-0",
        dialogClassName,
      )}
    >
      <DialogHeader className="border-b border-v3-border bg-white p-6 text-left">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? (
              <span className="mb-3 inline-flex items-center rounded-full bg-white/80 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-v3-primary shadow-sm">
                {eyebrow}
              </span>
            ) : null}
            <DialogTitle className="text-[1.35rem] font-bold tracking-[-0.02em] text-v3-dark">
              {title}
            </DialogTitle>
            <p className="mt-2 text-[0.82rem] leading-6 text-v3-text-muted">{description}</p>
          </div>

          <DialogClose asChild>
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/80 text-v3-text-muted shadow-sm transition-colors hover:bg-white hover:text-v3-dark"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">{description}</DialogDescription>
      </DialogHeader>

      <div
        data-component={`${dataComponent}-content`}
        className={cn("space-y-5 overflow-y-auto px-6 py-6", contentClassName)}
      >
        {children}
      </div>

      {footer ? (
        <DialogFooter
          data-component={`${dataComponent}-actions`}
          className={cn("border-t border-v3-border bg-white px-6 py-5 sm:justify-end", footerClassName)}
        >
          {footer}
        </DialogFooter>
      ) : null}
    </DialogContent>
  );
}
