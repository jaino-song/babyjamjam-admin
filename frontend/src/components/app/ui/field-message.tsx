import type { ReactNode } from "react";

import { FormHelperText } from "@/components/app/ui/form-section";
import { cn } from "@/lib/utils";

/**
 * Classes for components that render the slot through `TitleTextInputMolecule`'s
 * `labelRowClassName` / `labelTrailingClassName`: the slot is one label line
 * tall at the right end of the label row and never changes the layout.
 */
export const FIELD_MESSAGE_LABEL_ROW_CLASS_NAME = "min-w-0";
export const FIELD_MESSAGE_LABEL_SLOT_CLASS_NAME =
    "ml-auto h-[1lh] min-w-0 shrink justify-end text-right text-[calc(12px*var(--glint-ui-scale,1))] leading-[1.3]";

export interface FieldMessageTextProps {
    /** "ok" is a positive status (e.g. an available phone number). */
    tone: "hint" | "error" | "ok";
    id?: string;
    children: ReactNode;
    className?: string;
    "data-component"?: string;
}

/**
 * The single-line message shown in a field's label row (`FormField`'s
 * `labelAccessory`). The slot is one label line tall, so text that does not
 * fit is cut with an ellipsis instead of changing the layout.
 */
export function FieldMessageText({
    tone,
    id,
    children,
    className,
    "data-component": dataComponent,
}: FieldMessageTextProps) {
    return (
        <FormHelperText
            id={id}
            data-component={dataComponent}
            data-slot={tone === "error" ? "field-error-message" : "field-message"}
            tone={tone === "error" ? "error" : "default"}
            className={cn("m-0 truncate text-right", tone === "ok" && "text-v3-green", className)}
            aria-live="polite"
        >
            {children}
        </FormHelperText>
    );
}
