import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "ReadOnlySignature";

export interface ReadOnlySignatureProps {
  "data-component": string;
  /** The saved signature (an image URL / data URI), or `null` when none is stored. */
  value: string | null;
  /** The single message in the label row (when it was signed, or why nothing shows). */
  message: string;
  /** Id of the message element; the image describes itself by it. */
  messageId: string;
  /** Visible label text. */
  label?: string;
  /** Layout-only (never visual). */
  className?: string;
}

// Border colours carry `!` because globals.css has an unlayered
// `* { border-color }` reset that would otherwise beat layered utilities.
const BOX_CLASS =
  "h-[calc(150px*var(--glint-ui-scale,1))] overflow-hidden rounded-[12px] border-[1.5px] border-v3-border!";

/** A saved signature shown read-only: label row with one message, then the image box. */
export function ReadOnlySignature({
  "data-component": dataComponent,
  value,
  message,
  messageId,
  label = "산모 서명",
  className,
}: ReadOnlySignatureProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      data-slot="signature"
      className={className}
    >
      <div
        data-component={`${dataComponent}_label-row`}
        data-slot="lab-row"
        className="mb-[calc(6px*var(--glint-ui-scale,1))] flex min-w-0 items-center gap-[calc(8px*var(--glint-ui-scale,1))]"
      >
        <span
          data-component={`${dataComponent}_label`}
          data-slot="lab"
          className="shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-snug text-v3-text"
        >
          {label}
        </span>
        <span
          id={messageId}
          data-component={`${dataComponent}_message`}
          data-slot="lab-msg"
          data-tone="hint"
          aria-live="polite"
          title={message}
          className="ml-auto h-[1lh] min-w-0 truncate text-right text-[calc(12px*var(--glint-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted"
        >
          {message}
        </span>
      </div>
      {value ? (
        <div
          data-component={`${dataComponent}_image-wrap`}
          data-slot="signature-image-wrap"
          className={cn(BOX_CLASS, "bg-white")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a stored signature data URI; next/image cannot optimise it */}
          <img
            data-component={`${dataComponent}_image`}
            data-slot="signature-image"
            src={value}
            alt="산모 서명"
            aria-describedby={messageId}
            className="block size-full object-contain"
          />
        </div>
      ) : (
        <div
          data-component={`${dataComponent}_empty`}
          data-slot="signature-empty"
          aria-hidden="true"
          className={cn(BOX_CLASS, "bg-v3-dim-white")}
        />
      )}
    </div>
  );
}
