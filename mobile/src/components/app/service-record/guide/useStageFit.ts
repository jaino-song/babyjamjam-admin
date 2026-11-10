"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * Publishes `--fit` (≤ 1) on the stage frame: its measured height over the design height. The frame's
 * inner `.stage-fit` layer scales by it, so the whole illustration shrinks with the frame instead of
 * being clipped by it. A frame that is tall enough, or not measurable (jsdom), keeps `--fit: 1`.
 */
export function useStageFit(frameRef: RefObject<HTMLElement | null>, designHeight: number): void {
    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame) return;
        const apply = () => {
            const height = frame.clientHeight;
            if (!height) return;
            frame.style.setProperty("--fit", String(Math.min(1, height / designHeight)));
        };
        apply();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(apply);
        observer.observe(frame);
        return () => observer.disconnect();
    }, [frameRef, designHeight]);
}
