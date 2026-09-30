import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { SlotMessage, SlotTone } from "@/lib/validations/field-message";

import styles from "./FieldLabelRow.module.css";

const TONE_CLASS: Record<SlotTone, string | undefined> = {
  muted: undefined,
  ok: styles.tone_ok,
  err: styles.tone_err,
  pending: styles.tone_pending,
};

/** Id the field's input points at with aria-describedby. */
export const fieldMessageId = (fieldId: string): string => `${fieldId}-message`;

interface FieldLabelRowProps {
  "data-component": string;
  htmlFor: string;
  label: ReactNode;
  required?: boolean;
  message: SlotMessage | null;
  /** Defaults to `${htmlFor}-message`. */
  messageId?: string;
}

/**
 * A field's label plus its single message slot at the top right. The row is one
 * label line tall, so a message never moves the input below it; one that does
 * not fit is cut with an ellipsis. The slot element is always rendered (empty
 * when there is nothing to say) so the input can describe itself by it.
 */
export function FieldLabelRow({
  "data-component": dataComponent,
  htmlFor,
  label,
  required = false,
  message,
  messageId,
}: FieldLabelRowProps) {
  return (
    <div className={styles.row} data-component={`${dataComponent}_label-row`}>
      <label className={styles.label} htmlFor={htmlFor} data-component={`${dataComponent}_label`}>
        {label}
        {required ? <span className={styles.required}>*</span> : null}
      </label>
      <span
        id={messageId ?? fieldMessageId(htmlFor)}
        className={cn(styles.message, TONE_CLASS[message?.tone ?? "muted"])}
        aria-live="polite"
        data-component={`${dataComponent}_helper`}
      >
        {message?.text}
      </span>
    </div>
  );
}
