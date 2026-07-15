import { cn } from "@/lib/utils";

interface InlineFieldErrorProps {
  id?: string;
  message?: string;
  className?: string;
  reserveSpace?: boolean;
}

export function InlineFieldError({
  id,
  message,
  className,
  reserveSpace = false,
}: InlineFieldErrorProps) {
  if (!message && !reserveSpace) {
    return null;
  }

  return (
    <span
      id={message ? id : undefined}
      aria-hidden={!message}
      className={cn(
        "inline-flex min-h-[0.6875rem] items-center justify-end text-right text-[0.68rem] font-semibold leading-none text-destructive",
        message ? "animate-fade-in" : "invisible",
        className
      )}
    >
      {message ?? "\u00A0"}
    </span>
  );
}
