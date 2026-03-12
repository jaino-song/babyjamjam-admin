import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border-2 border-transparent text-sm font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 btn-press",
  {
    variants: {
      variant: {
        default:
          "border-0 bg-[hsl(214,100%,34%)] text-white shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] hover:-translate-y-[2px] hover:bg-[hsl(214,100%,30%)] hover:shadow-[0_12px_48px_hsla(214,50%,20%,0.12)]",
        positive:
          "border-0 bg-[hsl(214,100%,34%)] text-white shadow-[0_4px_24px_hsla(214,50%,20%,0.06)] hover:-translate-y-[2px] hover:bg-[hsl(214,100%,30%)] hover:shadow-[0_12px_48px_hsla(214,50%,20%,0.12)]",
        destructive:
          "bg-v3-burgundy text-white shadow-[0_4px_24px_hsla(348,40%,24%,0.08)] hover:-translate-y-[2px] hover:bg-[hsl(348,58%,34%)] hover:shadow-[0_12px_48px_hsla(348,40%,24%,0.16)]",
        negative:
          "bg-v3-burgundy text-white shadow-[0_4px_24px_hsla(348,40%,24%,0.08)] hover:-translate-y-[2px] hover:bg-[hsl(348,58%,34%)] hover:shadow-[0_12px_48px_hsla(348,40%,24%,0.16)]",
        outline:
          "border-v3-border bg-white text-v3-text-muted shadow-none hover:bg-v3-dim-white hover:text-v3-dark",
        neutral:
          "border-v3-border bg-white text-v3-text-muted shadow-none hover:bg-v3-dim-white hover:text-v3-dark",
        secondary:
          "bg-[hsl(214,80%,95%)] text-[hsl(214,100%,34%)] shadow-none hover:bg-[hsl(214,70%,90%)]",
        subtle:
          "bg-[hsl(214,80%,95%)] text-[hsl(214,100%,34%)] shadow-none hover:bg-[hsl(214,70%,90%)]",
        "positive-outline":
          "border-[hsl(214,100%,34%)] bg-white text-[hsl(214,100%,34%)] shadow-none hover:bg-[hsl(214,80%,95%)]",
        "negative-outline":
          "border-v3-primary/30 bg-white text-v3-burgundy shadow-none hover:bg-v3-burgundy-light hover:text-v3-burgundy",
        ghost: "bg-transparent shadow-none hover:bg-accent hover:text-accent-foreground",
        link: "bg-transparent shadow-none text-primary underline-offset-4 hover:underline",
        kakao:
          "bg-kakao text-kakao-foreground border border-border shadow-sm hover:bg-kakao/90",
        google:
          "bg-google text-google-foreground border border-border shadow-sm hover:bg-muted",
      },
      size: {
        default: "h-10 px-4",
        md: "h-11 px-6",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "positive",
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
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const resolvedVariant = variant ?? "positive";
    const resolvedSize = size ?? "default";

    if (asChild) {
      return (
        <Slot
          data-size={resolvedSize}
          data-slot="button"
          data-variant={resolvedVariant}
          className={cn(buttonVariants({ variant, size, className }))}
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
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
