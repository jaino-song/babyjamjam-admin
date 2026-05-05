import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const inputVariants = cva(
  "flex w-full bg-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-10 rounded-md border border-input px-3 py-2 text-sm transition-colors focus-visible:border-primary",
        v3:
          "rounded-2xl border-[1.5px] border-v3-border bg-white px-4 py-3 text-[0.85rem] font-[Pretendard] text-v3-dark shadow-none outline-none transition-colors focus-visible:border-v3-primary",
        "v3-pill":
          "rounded-pill border-[1.5px] border-v3-border bg-white px-4 py-3 text-[0.85rem] font-[Pretendard] text-v3-dark shadow-none outline-none transition-colors focus-visible:border-v3-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {
  error?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          inputVariants({ variant, className }),
          error && "border-destructive focus-visible:ring-destructive"
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input, inputVariants }
