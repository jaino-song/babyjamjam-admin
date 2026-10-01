"use client";

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  /** Plain or multi-paragraph explanation of what the card shows. */
  text: string;
  /** Accessible label for screen readers (defaults to "도움말"). */
  ariaLabel?: string;
  /** Override Tailwind classes on the trigger. */
  className?: string;
  /** Tooltip placement; defaults to "top". */
  side?: "top" | "right" | "bottom" | "left";
  /** Optional data-component anchor for E2E selectors. */
  dataComponent?: string;
}

/**
 * Hover-only info icon that surfaces a short explanation of the card it's
 * placed next to. Self-contains a TooltipProvider so it can be dropped into
 * any RSC tree without needing a top-level provider.
 */
export function InfoTooltip({
  text,
  ariaLabel = "도움말",
  className,
  side = "top",
  dataComponent,
}: InfoTooltipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            data-component={dataComponent}
            className={cn(
              "inline-flex items-center justify-center rounded-full text-v3-text-muted hover:text-v3-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary/40 transition-colors",
              className
            )}
          >
            <Info className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          align="start"
          className="max-w-[280px] whitespace-pre-line bg-v3-text/95 text-white border-transparent text-[0.75rem] leading-snug font-medium"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
