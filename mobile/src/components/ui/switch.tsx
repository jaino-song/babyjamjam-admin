"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  thumbDataComponent,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  thumbDataComponent?: string
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[calc(23.4px*var(--v3-ui-scale,1))] w-[calc(41.4px*var(--v3-ui-scale,1))] shrink-0 items-center rounded-full border-0 p-[calc(2.7px*var(--v3-ui-scale,1))] outline-none transition-colors data-[state=checked]:bg-v3-primary data-[state=unchecked]:bg-v3-border focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-v3-primary/10 disabled:cursor-not-allowed disabled:opacity-55",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        data-component={thumbDataComponent}
        className="pointer-events-none block h-[calc(18px*var(--v3-ui-scale,1))] w-[calc(18px*var(--v3-ui-scale,1))] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] ring-0 transition-transform data-[state=checked]:translate-x-full data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
