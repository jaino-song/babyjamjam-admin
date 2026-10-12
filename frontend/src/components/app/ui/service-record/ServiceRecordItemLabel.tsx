import type { ReactNode } from "react";
import type { SlotMessage } from "@babyjamjam/service-record-ui";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "ServiceRecordItemLabel";

export interface ServiceRecordItemLabelProps {
  "data-component": string;
  /** Id placed on the title element; option groups / textareas point at it. */
  labelId: string;
  label: ReactNode;
  required?: boolean;
  /**
   * When given, the title is a `<label htmlFor>` (textarea / count items).
   * Otherwise it is a plain `<span>` so option names never include it.
   */
  htmlFor?: string;
  /** Id of the always-rendered message slot (inputs describe themselves by it). */
  messageId: string;
  message: SlotMessage | null;
  /** Layout-only (never visual). */
  className?: string;
}

// Same tone colours as the admin `FieldMessageText`.
const MESSAGE_TONE_CLASS: Record<SlotMessage["tone"], string> = {
  hint: "text-v3-text-muted",
  error: "text-v3-burgundy",
};

const TITLE_CLASS =
  "shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-snug text-v3-text";

/**
 * One item's title row plus its single message slot at the right. The slot is
 * one line tall and always rendered (empty when there is nothing to say), so a
 * message never moves the control below it; a long one is cut with an ellipsis.
 *
 * The message is its own element rather than `FieldMessageText`, because that
 * component fixes `data-slot` to `field-message` and sets no `data-tone`.
 */
export function ServiceRecordItemLabel({
  "data-component": dataComponent,
  labelId,
  label,
  required = false,
  htmlFor,
  messageId,
  message,
  className,
}: ServiceRecordItemLabelProps) {
  const content = (
    <>
      {label}
      {required ? (
        <span aria-hidden="true" className="ml-0.5 text-v3-burgundy">
          *
        </span>
      ) : null}
    </>
  );

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className={cn("mb-[calc(6px*var(--glint-ui-scale,1))] flex min-w-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]", className)}
    >
      {htmlFor ? (
        <label
          id={labelId}
          htmlFor={htmlFor}
          data-component={`${dataComponent}_title`}
          className={TITLE_CLASS}
        >
          {content}
        </label>
      ) : (
        <span id={labelId} data-component={`${dataComponent}_title`} className={TITLE_CLASS}>
          {content}
        </span>
      )}
      <span
        id={messageId}
        data-component={`${dataComponent}_message`}
        data-slot="lab-msg"
        data-tone={message?.tone}
        aria-live="polite"
        title={message?.text}
        className={cn(
          "ml-auto h-[1lh] min-w-0 truncate text-right text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3]",
          MESSAGE_TONE_CLASS[message?.tone ?? "hint"],
        )}
      >
        {message?.text}
      </span>
    </div>
  );
}
