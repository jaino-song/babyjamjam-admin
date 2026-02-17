import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        // Semantic variants with opacity backgrounds
        success:
          "bg-success/15 text-success border-success/30 [a&]:hover:bg-success/25",
        warning:
          "bg-warning/15 text-warning border-warning/30 [a&]:hover:bg-warning/25",
        info:
          "bg-info/15 text-info border-info/30 [a&]:hover:bg-info/25",
        v3: "bg-[hsl(220,20%,97%)] text-gray-700 px-3 py-1 hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm border-transparent",
        "v3-active":
          "bg-[hsl(137,34%,31%)] text-white px-3 py-1 hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm border-transparent",
        "v3-pending":
          "bg-[hsl(34,100%,55%)] text-white px-3 py-1 hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm border-transparent",
        "v3-expired":
          "bg-[hsl(355,36%,45%)] text-white px-3 py-1 hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm border-transparent",
        "v3-info":
          "bg-[hsl(214,100%,34%)] text-white px-3 py-1 hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
