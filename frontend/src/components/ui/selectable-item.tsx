import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Shared frame for selectable cards and chips. Consumers own layout and ARIA
 * semantics (button, checkbox, radio, option); this recipe only owns the frame.
 */
export const selectableItemVariants = cva("border-2 transition-colors", {
  variants: {
    isSelected: {
      false:
        "border-v3-selectable-border bg-white hover:border-v3-selectable-border hover:bg-white",
      true:
        "border-v3-primary bg-v3-primary-light hover:border-v3-primary hover:bg-v3-primary-light",
    },
    isInteractive: {
      false: "",
      true:
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2",
    },
  },
  defaultVariants: {
    isSelected: false,
    isInteractive: false,
  },
});

export interface SelectableItemFrameProps extends React.HTMLAttributes<HTMLElement> {
  isSelected: boolean;
  isInteractive?: boolean;
  asChild?: boolean;
  "data-component"?: string;
  "data-slot"?: string;
  "data-source-component"?: string;
}

/** Owns selection visuals without assigning interaction or ARIA semantics. */
export const SelectableItemFrame = React.forwardRef<HTMLElement, SelectableItemFrameProps>(
  ({ isSelected, isInteractive = false, asChild = false, className, style, children, ...props }, ref) => {
    // The global border reset is in @layer base, so Tailwind utilities win.
    // Inline borderColor stays as a harmless explicit override for selection frames.
    const borderColor = isSelected
      ? "hsl(var(--v3-primary))"
      : "hsl(var(--v3-selectable-border))";
    const frameProps = {
      "data-slot": "selectable-item-frame",
      "data-source-component": "SelectableItemFrame",
      ...props,
      className: cn(selectableItemVariants({ isSelected, isInteractive }), className),
      style: { ...style, borderColor },
    };

    if (asChild) {
      const child = React.Children.only(children) as React.ReactElement<{
        className?: string;
        style?: React.CSSProperties;
      }>;
      return (
        <Slot {...frameProps} className={undefined} ref={ref}>
          {React.cloneElement(child, {
            className: cn(frameProps.className, child.props.className),
            // Slot merges child styles last. Preserve those styles while keeping
            // the selection border policy on this frame's single DOM element.
            style: { ...child.props.style, borderColor },
          })}
        </Slot>
      );
    }

    return (
      <div {...frameProps} ref={ref as React.ForwardedRef<HTMLDivElement>}>
        {children}
      </div>
    );
  },
);
SelectableItemFrame.displayName = "SelectableItemFrame";
