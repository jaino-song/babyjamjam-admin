"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
  variant?: "default" | "v3"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      data-variant={variant}
      className={cn(
        "peer inline-flex shrink-0 items-center border border-transparent transition-all outline-none focus-visible:ring-[3px] focus-visible:border-ring focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "default" && "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80 group/switch rounded-full shadow-xs data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        variant === "v3" && "w-[44px] h-[24px] rounded-2xl duration-300 ease-in-out data-[state=unchecked]:bg-[hsl(220,20%,90%)] data-[state=checked]:bg-[hsl(214,100%,34%)]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full ring-0 transition-transform",
          variant === "default" && "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0",
          variant === "v3" && "size-[20px] bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] duration-300 ease-in-out data-[state=unchecked]:translate-x-[2px] data-[state=checked]:translate-x-[22px]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
