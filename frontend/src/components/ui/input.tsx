import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const inputVariants = cva(
  "flex w-full bg-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-10 rounded-md border border-input px-3 py-2 text-sm transition-colors focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.1)]",
        v3:
          "border border-[hsl(220,20%,90%)] px-4 py-3 text-sm rounded-[14px] transition-all duration-200 ease-in-out focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.1)] focus-visible:scale-[1.02]",
        "v3-pill":
          "border border-[hsl(220,20%,90%)] px-4 py-3 text-sm rounded-pill transition-all duration-200 ease-in-out focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.1)] focus-visible:scale-[1.02]",
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
