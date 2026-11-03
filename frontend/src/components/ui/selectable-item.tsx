import { cva } from "class-variance-authority";

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
