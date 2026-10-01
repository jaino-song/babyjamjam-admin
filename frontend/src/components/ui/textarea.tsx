import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, ...props }, ref) => {
        return (
            <textarea
                className={cn(
                    "flex min-h-[80px] w-full rounded-[13px] border-[1.35px] border-input bg-white px-3.5 py-2 text-[0.8rem] font-[Pretendard] text-v3-dark shadow-none transition-all duration-200",
                    "placeholder:text-muted-foreground",
                    "focus-visible:border-v3-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-v3-primary/10 focus-visible:ring-offset-0 focus-visible:shadow-none",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                ref={ref}
                {...props}
            />
        );
    }
);
Textarea.displayName = "Textarea";

export { Textarea };
