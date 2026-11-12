"use client";

import type { ReactNode, Ref } from "react";
import { ChevronLeft } from "lucide-react";

import { PanelTitleGroup } from "@/components/app/v3/PanelTitleGroup";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaneHeaderBaseProps {
  "data-component"?: string;
  ref?: Ref<HTMLDivElement>;
  actions?: ReactNode;
  inset?: "default" | "compact";
  className?: string;
}
export type PaneHeaderProps = PaneHeaderBaseProps & (
  | { variant: "title"; title: ReactNode; backLabel?: never; onBack?: never; backRef?: never }
  | { variant: "back"; backLabel: string; onBack: () => void; backRef?: Ref<HTMLButtonElement>; title?: never }
);

/** Aligned title and back rows for adjacent list/detail panes. */
export function PaneHeader({ "data-component": base, ref, actions, inset = "default", className, variant, title, backLabel, onBack, backRef }: PaneHeaderProps): React.ReactElement {
  const sub = (part: string) => base ? `${base}_${part}` : undefined;
  return <div ref={ref} data-component={base} data-slot="pane-header" data-source-component="PaneHeader" data-variant={variant}
    className={cn("flex min-h-[calc(56px*var(--glint-ui-scale,1))] shrink-0 items-center justify-between gap-3 py-[calc(12px*var(--glint-ui-scale,1))]", inset === "compact" ? "px-5" : "px-6", className)}>
    {variant === "title"
      ? <PanelTitleGroup data-component={sub("title-group")} title={title} titleClassName="text-xl" />
      : <Button ref={backRef} type="button" variant="ghost" size="sm" onClick={onBack} data-component={sub("back")} data-slot="pane-header-back"
          className="h-7 border-0 bg-transparent px-0 text-v3-primary shadow-none hover:bg-transparent hover:text-v3-primary">
          <ChevronLeft aria-hidden="true" />{backLabel}
        </Button>}
    {actions != null ? <div data-component={sub("actions")} data-slot="pane-header-actions" className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>;
}
