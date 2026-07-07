"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button, type ButtonProps } from "@/components/ui/button"
import {
  APP_DIALOG_CLOSE_ICON_CLASS_NAME,
  APP_DIALOG_CONTENT_CLASS_NAME,
  APP_DIALOG_DESCRIPTION_CLASS_NAME,
  APP_DIALOG_FLOATING_CLOSE_BUTTON_CLASS_NAME,
  APP_DIALOG_PADDED_CONTENT_CLASS_NAME,
  APP_DIALOG_TITLE_CLASS_NAME,
} from "@/components/ui/app-surface"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean
  }
>(function DialogContent(
  {
    className,
    children,
    showCloseButton = false,
    ...props
  },
  ref
) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="dialog-content"
        className={cn(
          APP_DIALOG_CONTENT_CLASS_NAME,
          APP_DIALOG_PADDED_CONTENT_CLASS_NAME,
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className={APP_DIALOG_FLOATING_CLOSE_BUTTON_CLASS_NAME}
          >
            <XIcon className={APP_DIALOG_CLOSE_ICON_CLASS_NAME} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 px-0 pt-0 pb-3 text-left sm:text-left", className)}
      {...props}
    />
  )
}

function normalizeFooterAction(
  child: React.ReactNode
): React.ReactNode {
  if (!React.isValidElement<ButtonProps>(child) || child.type !== Button) {
    return child
  }

  const variant =
    child.props.variant == null
      ? "positive"
      : child.props.variant === "outline"
        ? "neutral"
        : child.props.variant

  return React.cloneElement(child, {
    className: cn("min-w-[88px]", child.props.className),
    size: child.props.size ?? "sm",
    variant,
  })
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  const normalizedChildren = React.Children.map(children, normalizeFooterAction)

  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 px-0 pb-0 pt-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {normalizedChildren}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="neutral" size="sm" className="min-w-[88px]">
            Close
          </Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(APP_DIALOG_TITLE_CLASS_NAME, className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(APP_DIALOG_DESCRIPTION_CLASS_NAME, className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
