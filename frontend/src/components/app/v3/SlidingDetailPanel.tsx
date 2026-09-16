"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SlidingDetailPanelProps {
    "data-component": string;
    open: boolean;
    onBack: () => void;
    backLabel: string;
    list: ReactNode;
    detail: ReactNode;
}

/** Desktop counterpart of mobile SlidingCard: identical parallax, duration and easing. */
export function SlidingDetailPanel({
    "data-component": dataComponent, open, onBack, backLabel, list, detail,
}: SlidingDetailPanelProps) {
    const backRef = useRef<HTMLButtonElement>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const wasOpenRef = useRef(false);

    useEffect(() => {
        if (open && !wasOpenRef.current) {
            backRef.current?.focus({ preventScroll: true });
        } else if (!open && wasOpenRef.current && returnFocusRef.current?.isConnected) {
            returnFocusRef.current.focus({ preventScroll: true });
        }
        wasOpenRef.current = open;
    }, [open]);

    return (
        <div data-component={dataComponent} data-slot="sliding-detail-panel" data-source-component="SlidingDetailPanel"
            data-open={open} className="sliding-detail-panel"
            onKeyDown={(event) => {
                if (event.key === "Escape" && open && !event.defaultPrevented) {
                    event.preventDefault();
                    onBack();
                }
            }}>
            <div data-component={`${dataComponent}_list-pane`} data-slot="sliding-detail-list"
                className="sliding-detail-list" aria-hidden={open} inert={open || undefined}
                onFocusCapture={(event) => { returnFocusRef.current = event.target as HTMLElement; }}>
                {list}
                <div data-slot="sliding-detail-dim" className="sliding-detail-dim" aria-hidden="true" />
            </div>
            <div data-component={`${dataComponent}_detail-pane`} data-slot="sliding-detail-content"
                className="sliding-detail-content" aria-hidden={!open} inert={!open || undefined}>
                <div data-component={`${dataComponent}_detail-pane_header`} data-slot="sliding-detail-header" className="sliding-detail-header">
                    <Button ref={backRef} variant="ghost" size="sm" onClick={onBack}
                        className="h-7 border-0 bg-transparent px-0 text-v3-primary shadow-none"
                        data-component={`${dataComponent}_detail-pane_header_back`}>
                        <ChevronLeft aria-hidden="true" />{backLabel}
                    </Button>
                </div>
                <div data-component={`${dataComponent}_detail-pane_body`} data-slot="sliding-detail-body" className="sliding-detail-body">
                    {detail}
                </div>
            </div>
        </div>
    );
}
