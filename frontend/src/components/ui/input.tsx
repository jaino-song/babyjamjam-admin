import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const V3_INPUT_CONTROL_CLASS_NAME =
  "h-[38px] rounded-[13px] border-[1.35px] border-v3-border bg-white px-3.5 py-2 text-[0.8rem] font-[Pretendard] text-v3-dark shadow-none transition-all duration-200 focus-visible:border-v3-primary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-v3-primary/10 focus-visible:ring-offset-0 focus-visible:shadow-none";

const inputVariants = cva(
  "flex w-full bg-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-10 rounded-md border border-input px-3 py-2 text-sm transition-colors focus-visible:border-primary",
        v3: V3_INPUT_CONTROL_CLASS_NAME,
        "v3-pill":
          "h-[38px] rounded-pill border-[1.35px] border-v3-border bg-white px-3.5 py-2 text-[0.8rem] font-[Pretendard] text-v3-dark shadow-none transition-all duration-200 focus-visible:border-v3-primary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-v3-primary/10 focus-visible:ring-offset-0 focus-visible:shadow-none",
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

export { Input, inputVariants, V3_INPUT_CONTROL_CLASS_NAME }
