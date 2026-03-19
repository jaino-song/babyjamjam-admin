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
          "bg-[hsl(220,20%,97%)] text-v3-text-muted border-border [a&]:hover:bg-[hsl(220,20%,94%)]",
        destructive:
          "bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        // Semantic variants with opacity backgrounds
        success:
          "bg-[hsl(137,60%,94%)] text-v3-green border-[hsl(137,34%,84%)] [a&]:hover:bg-[hsl(137,60%,91%)]",
        warning:
          "bg-[hsl(47,100%,92%)] text-[hsl(38,92%,35%)] border-[hsla(38,92%,35%,0.18)] [a&]:hover:bg-[hsl(47,100%,89%)]",
        info:
          "bg-[hsl(214,80%,95%)] text-v3-primary border-[hsl(214,70%,85%)] [a&]:hover:bg-[hsl(214,80%,92%)]",
        v3: "bg-[hsl(220,20%,97%)] text-gray-700 px-3 py-1 border-[hsl(220,20%,90%)] hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm",
        "v3-active":
          "bg-[hsl(137,60%,94%)] text-v3-green px-3 py-1 border-[hsl(137,34%,84%)] hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm",
        "v3-pending":
          "bg-[hsl(47,100%,92%)] text-[hsl(38,92%,35%)] px-3 py-1 border-[hsla(38,92%,35%,0.18)] hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm",
        "v3-expired":
          "bg-[hsl(355,40%,94%)] text-[hsl(355,36%,45%)] px-3 py-1 border-[hsla(355,36%,45%,0.20)] hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm",
        "v3-info":
          "bg-[hsl(214,80%,95%)] text-v3-primary px-3 py-1 border-[hsl(214,70%,85%)] hover:opacity-90 hover:scale-[1.02] transition-all duration-200 ease-in-out shadow-sm",
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
