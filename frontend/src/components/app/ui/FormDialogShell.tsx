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
import {
  APP_DIALOG_BODY_CLASS_NAME,
  APP_DIALOG_CLOSE_ICON_CLASS_NAME,
  APP_DIALOG_EYEBROW_CLASS_NAME,
  APP_DIALOG_FLUSH_CONTENT_CLASS_NAME,
  APP_DIALOG_FOOTER_CLASS_NAME,
  APP_DIALOG_HEADER_CLASS_NAME,
  APP_DIALOG_HEADER_ROW_CLASS_NAME,
  APP_DIALOG_INLINE_CLOSE_BUTTON_CLASS_NAME,
  APP_DIALOG_TITLE_CLASS_NAME,
  APP_FORM_DIALOG_CONTENT_CLASS_NAME,
} from "@/components/ui/app-surface";

const SOURCE_COMPONENT = "FormDialogShell";

interface FormDialogShellProps {
  "data-component"?: string;
  dataComponent?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "form" | "compact";
  contentClassName?: string;
  footerClassName?: string;
  mobileSheet?: boolean;
}

export function FormDialogShell({
  "data-component": canonicalDataComponent,
  dataComponent: legacyDataComponent,
  title,
  description,
  eyebrow,
  children,
  footer,
  size = "form",
  contentClassName,
  footerClassName,
  mobileSheet = false,
}: FormDialogShellProps) {
  const canonicalDataComponentBase = canonicalDataComponent || undefined;
  const dataComponent = canonicalDataComponentBase ?? legacyDataComponent;
  const sub = (suffix: string) => {
    if (canonicalDataComponentBase) return `${canonicalDataComponentBase}_${suffix}`;
    return legacyDataComponent ? `${legacyDataComponent}-${suffix}` : undefined;
  };

  return (
    <DialogContent
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      showCloseButton={false}
      className={cn(
        APP_DIALOG_FLUSH_CONTENT_CLASS_NAME,
        APP_FORM_DIALOG_CONTENT_CLASS_NAME,
        size === "compact" && "h-auto w-[min(480px,calc(100vw-1.5rem))] max-w-[480px]",
        mobileSheet && "max-sm:bottom-0 max-sm:top-auto max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:max-h-[94dvh] max-sm:bg-white",
      )}
    >
      <DialogHeader className={cn(APP_DIALOG_HEADER_CLASS_NAME, mobileSheet && "max-sm:border-0 max-sm:px-[22px] max-sm:pb-2 max-sm:pt-3")}>
        {mobileSheet ? <div data-slot="sheet-handle" aria-hidden="true" className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-v3-border sm:hidden" /> : null}
        <div className={APP_DIALOG_HEADER_ROW_CLASS_NAME}>
          <div className="min-w-0">
            {eyebrow ? (
              <span className={APP_DIALOG_EYEBROW_CLASS_NAME}>
                {eyebrow}
              </span>
            ) : null}
            <DialogTitle className={cn(APP_DIALOG_TITLE_CLASS_NAME, mobileSheet && "max-sm:text-xl")}>
              {title}
            </DialogTitle>
          </div>

          <DialogClose asChild>
            <button
              type="button"
              className={cn(APP_DIALOG_INLINE_CLOSE_BUTTON_CLASS_NAME, mobileSheet && "max-sm:h-11 max-sm:w-11")}
            >
              <X className={APP_DIALOG_CLOSE_ICON_CLASS_NAME} />
              <span className="sr-only">{mobileSheet ? "닫기" : "Close"}</span>
            </button>
          </DialogClose>
        </div>
        {description ? <DialogDescription className="sr-only">{description}</DialogDescription> : null}
      </DialogHeader>

      <div
        data-component={sub("content")}
        className={cn(APP_DIALOG_BODY_CLASS_NAME, contentClassName)}
      >
        {children}
      </div>

      {footer ? (
        <DialogFooter
          data-component={sub("actions")}
          className={cn(APP_DIALOG_FOOTER_CLASS_NAME, footerClassName)}
        >
          {footer}
        </DialogFooter>
      ) : null}
    </DialogContent>
  );
}
