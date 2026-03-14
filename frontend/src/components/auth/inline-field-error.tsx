import { cn } from "@/lib/utils";

interface InlineFieldErrorProps {
  id?: string;
  message?: string;
  className?: string;
}

export function InlineFieldError({
  id,
  message,
  className,
}: InlineFieldErrorProps) {
  const isVisible = Boolean(message);

  return (
    <span
      id={id}
      className={cn(
        "inline-flex min-w-[124px] items-center justify-end text-right text-[0.68rem] font-semibold leading-none transition-opacity duration-200",
        isVisible ? "text-destructive opacity-100" : "opacity-0",
        className
      )}
      aria-hidden={!isVisible}
    >
      {message ?? "\u00A0"}
    </span>
  );
}
