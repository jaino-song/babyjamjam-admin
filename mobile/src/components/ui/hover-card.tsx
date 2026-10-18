"use client"

import * as React from "react"
import Link from "next/link"
import { HoverCard as HoverCardPrimitive } from "radix-ui"
import { Info, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

type HoverCardTone = "warning" | "info"

interface HoverCardAction {
  label: React.ReactNode
  href: string
}

interface HoverCardProps {
  /** Short headline, e.g. why a control is disabled. */
  title: React.ReactNode
  /** One or two sentences; may contain `<b>` spans for names. */
  description: React.ReactNode
  /** Optional link shown under the description ("… →"). */
  action?: HoverCardAction
  /** `warning` = a blocked action, `info` = general guidance. */
  tone?: HoverCardTone
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  /** Hover-in delay (ms). */
  openDelay?: number
  /** Hover-out delay (ms). */
  closeDelay?: number
  /** Caller-owned base; the card root uses it as is. */
  "data-component": string
  className?: string
  /** Classes for the focusable wrapper around the trigger (e.g. its radius). */
  triggerClassName?: string
  /** The trigger. Usually a disabled button: the card hangs off a wrapper, not the button. */
  children: React.ReactNode
}

const TONE_ICON: Record<HoverCardTone, React.ComponentType<{ className?: string }>> = {
  warning: TriangleAlert,
  info: Info,
}

const TONE_ICON_CLASS: Record<HoverCardTone, string> = {
  warning: "bg-status-warning text-status-warning-fg",
  info: "bg-v3-primary-light text-v3-primary",
}

// A touch tap fires focus-driven open requests from Radix right after the
// pointer-up that already toggled the card; ignore them for this long.
const TOUCH_SETTLE_MS = 700

function HoverCard({
  title,
  description,
  action,
  tone = "warning",
  side = "bottom",
  align = "end",
  openDelay = 200,
  closeDelay = 100,
  "data-component": dataComponent,
  className,
  triggerClassName,
  children,
}: HoverCardProps) {
  const [open, setOpen] = React.useState(false)
  const contentId = React.useId()
  const triggerRef = React.useRef<HTMLSpanElement>(null)
  const openAtTouchStartRef = React.useRef(false)
  const lastTouchToggleAtRef = React.useRef(0)
  const ToneIcon = TONE_ICON[tone]

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (next && Date.now() - lastTouchToggleAtRef.current < TOUCH_SETTLE_MS) return
    setOpen(next)
  }, [])

  // Radix ignores touch pointers entirely, so a tap on the trigger toggles the
  // card here; an outside tap closes it through Radix's dismiss handling.
  const handlePointerDown = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "touch") openAtTouchStartRef.current = open
  }
  const handlePointerUp = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType !== "touch") return
    lastTouchToggleAtRef.current = Date.now()
    setOpen(!openAtTouchStartRef.current)
  }

  return (
    <HoverCardPrimitive.Root
      open={open}
      onOpenChange={handleOpenChange}
      openDelay={openDelay}
      closeDelay={closeDelay}
    >
      <HoverCardPrimitive.Trigger asChild>
        <span
          ref={triggerRef}
          data-slot="hover-card-trigger"
          tabIndex={0}
          aria-describedby={open ? contentId : undefined}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          className={cn(
            "inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            triggerClassName
          )}
        >
          {children}
        </span>
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          id={contentId}
          data-slot="hover-card-content"
          data-component={dataComponent}
          data-tone={tone}
          side={side}
          align={align}
          sideOffset={8}
          alignOffset={-8}
          collisionPadding={12}
          onPointerDownOutside={(event) => {
            if (triggerRef.current?.contains(event.target as Node)) event.preventDefault()
          }}
          className={cn(
            "z-50 w-[264px] max-w-[calc(100vw-1.5rem)] rounded-[14px] border border-v3-border bg-popover px-3.5 py-3 text-left shadow-v3-hover outline-hidden max-sm:w-[240px] dark:border-border",
            className
          )}
        >
          <div className="flex items-center gap-[7px]">
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-[7px]",
                TONE_ICON_CLASS[tone]
              )}
            >
              <ToneIcon className="size-3" />
            </span>
            <span
              data-slot="title"
              className="text-[13px] font-bold text-v3-text dark:text-popover-foreground"
            >
              {title}
            </span>
          </div>
          <p
            data-slot="description"
            className="mt-1.5 ml-[27px] text-[12.5px] leading-[1.55] text-v3-text-muted dark:text-muted-foreground [&_b]:font-semibold [&_b]:text-v3-text dark:[&_b]:text-popover-foreground"
          >
            {description}
          </p>
          {action ? (
            <Link
              data-slot="action"
              href={action.href}
              className="mt-[9px] ml-[27px] inline-block text-[12.5px] font-semibold text-v3-primary hover:underline"
            >
              {action.label}
            </Link>
          ) : null}
          <HoverCardPrimitive.Arrow
            width={14}
            height={7}
            className="fill-popover stroke-v3-border dark:stroke-border [&_polygon]:[vector-effect:non-scaling-stroke]"
          />
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  )
}

export { HoverCard }
export type { HoverCardAction, HoverCardProps, HoverCardTone }
