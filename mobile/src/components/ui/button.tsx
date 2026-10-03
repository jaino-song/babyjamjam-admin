import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 btn-press",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        kakao:
          "bg-kakao text-kakao-foreground border border-border shadow-sm hover:bg-kakao/90",
        google:
          "bg-google text-google-foreground border border-border shadow-sm hover:bg-muted",
        v3: "rounded-full bg-[hsl(214,100%,34%)] text-white shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] hover:-translate-y-[2px] hover:shadow-[0_12px_48px_hsla(214,50%,20%,0.12)] transition-all duration-300",
        "v3-soft":
          "rounded-full bg-[hsl(214,80%,95%)] text-[hsl(214,100%,34%)] hover:bg-[hsl(214,70%,90%)] transition-all duration-300",
        "v3-outline":
          "rounded-full border-2 border-[hsl(214,100%,34%)] bg-transparent text-[hsl(214,100%,34%)] hover:bg-[hsl(214,80%,95%)] transition-all duration-300",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3 text-xs",
        md: "h-[46px] px-6",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10 p-0",
      },
      width: {
        sm: "w-1/4",
        md: "w-1/2",
        lg: "w-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, width, asChild = false, ...props }, ref) => {
    const resolvedVariant = variant ?? "default";
    const resolvedSize = size ?? "default";

    if (asChild) {
      return (
        <Slot
          data-size={resolvedSize}
          data-slot="button"
          data-variant={resolvedVariant}
          data-width={width}
          className={cn(buttonVariants({ variant, size, width, className }))}
          // React 19 type compatibility: Radix Slot ref types conflict with React's ref types
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={ref as any}
          {...(props as Record<string, unknown>)}
        />
      );
    }
    return (
      <button
        data-size={resolvedSize}
        data-slot="button"
        data-variant={resolvedVariant}
        data-width={width}
        className={cn(buttonVariants({ variant, size, width, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
