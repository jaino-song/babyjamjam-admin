"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SlidingDetailPanelBaseProps {
    "data-component"?: string;
    open: boolean;
    onBack: () => void;
    backLabel: string;
    list: ReactNode;
    detail: ReactNode;
    interactionPaused?: boolean;
}

type SlidingDetailPanelProps = SlidingDetailPanelBaseProps & (
    | { motion?: "parallax"; headerActions?: never; headerSummary?: never }
    | { motion: "page"; headerActions?: ReactNode; headerSummary?: ReactNode }
);

/** Desktop drill-down with default mobile SlidingCard parallax or full-page motion. */
export function SlidingDetailPanel({
    "data-component": dataComponent, open, onBack, backLabel, list, detail,
    motion = "parallax", headerActions, headerSummary, interactionPaused = false,
}: SlidingDetailPanelProps) {
    const backRef = useRef<HTMLButtonElement>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const wasOpenRef = useRef(false);
    const hasHeaderSlots = motion === "page";

    useEffect(() => {
        if (open && !wasOpenRef.current) {
            backRef.current?.focus({ preventScroll: true });
        } else if (!open && wasOpenRef.current && returnFocusRef.current?.isConnected) {
            returnFocusRef.current.focus({ preventScroll: true });
        }
        wasOpenRef.current = open;
    }, [open]);

    const backButton = (
        <Button ref={backRef} variant="ghost" size="sm" onClick={onBack}
            className="h-7 border-0 bg-transparent px-0 text-v3-primary shadow-none hover:bg-transparent hover:text-v3-primary"
            data-component={dataComponent ? `${dataComponent}_detail-pane_header${hasHeaderSlots ? "_row" : ""}_back` : undefined}>
            <ChevronLeft aria-hidden="true" />{backLabel}
        </Button>
    );

    return (
        <div data-component={dataComponent || undefined} data-slot="sliding-detail-panel" data-source-component="SlidingDetailPanel"
            data-open={open} data-motion={motion === "page" ? "page" : undefined} className="sliding-detail-panel"
            onKeyDown={(event) => {
                if (event.key === "Escape" && open && !event.defaultPrevented && !interactionPaused) {
                    event.preventDefault();
                    onBack();
                }
            }}>
            <div data-component={dataComponent ? `${dataComponent}_list-pane` : undefined} data-slot="sliding-detail-list"
                className="sliding-detail-list" aria-hidden={open} inert={open || undefined}
                onFocusCapture={(event) => { returnFocusRef.current = event.target as HTMLElement; }}>
                {list}
                {motion !== "page" ? <div data-slot="sliding-detail-dim" className="sliding-detail-dim" aria-hidden="true" /> : null}
            </div>
            <div data-component={dataComponent ? `${dataComponent}_detail-pane` : undefined} data-slot="sliding-detail-content"
                className="sliding-detail-content" aria-hidden={!open} inert={!open || undefined}>
                <div data-component={dataComponent ? `${dataComponent}_detail-pane_header` : undefined} data-slot="sliding-detail-header" data-layout={hasHeaderSlots ? "stack" : undefined} className="sliding-detail-header">
                    {hasHeaderSlots ? <>
                        <div data-component={dataComponent ? `${dataComponent}_detail-pane_header_row` : undefined}
                            data-slot="sliding-detail-header-row" className="sliding-detail-header-row">
                            {backButton}
                            {headerActions != null ? <div data-component={dataComponent ? `${dataComponent}_detail-pane_header_row_actions` : undefined}
                                data-slot="sliding-detail-header-actions" className="sliding-detail-header-actions">{headerActions}</div> : null}
                        </div>
                        {headerSummary != null ? <div data-component={dataComponent ? `${dataComponent}_detail-pane_header_summary` : undefined}
                            data-slot="sliding-detail-header-summary" className="sliding-detail-header-summary">{headerSummary}</div> : null}
                    </> : backButton}
                </div>
                <div data-component={dataComponent ? `${dataComponent}_detail-pane_body` : undefined} data-slot="sliding-detail-body" className="sliding-detail-body">
                    {detail}
                </div>
            </div>
        </div>
    );
}
