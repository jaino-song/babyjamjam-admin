"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * Height (px) the stage content is drawn for: the 396px mini screen plus a little air, which is also what
 * the four intro cards need. The stage frame is `min(430px, 52svh)` tall, so on short phones it is smaller.
 */
export const STAGE_DESIGN_HEIGHT_PX = 412;

/**
 * Publishes `--fit` (≤ 1) on the stage frame: its measured height over the design height. The frame's
 * inner `.stage-fit` layer scales by it, so the whole illustration shrinks with the frame instead of
 * being clipped by it. A frame that is tall enough, or not measurable (jsdom), keeps `--fit: 1`.
 */
export function useStageFit(frameRef: RefObject<HTMLElement | null>): void {
    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        const apply = () => {
            const height = frame.clientHeight;
            if (!height) return;
            frame.style.setProperty("--fit", String(Math.min(1, height / STAGE_DESIGN_HEIGHT_PX)));
        };
        apply();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(apply);
        observer.observe(frame);
        return () => observer.disconnect();
    }, [frameRef]);
}
