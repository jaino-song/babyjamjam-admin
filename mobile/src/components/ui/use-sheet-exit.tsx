"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/**
 * Lets a sheet that its parent unmounts on close play its closing animation first.
 * `close(after)` sets `open` to false; Radix keeps the content mounted while the closed
 * animation runs, and `after` runs when the content unmounts. Render `exitWatcher` inside
 * `SheetContent`. Without a CSS animation (jsdom) it runs at once; under reduced motion, after the
 * near-zero animation ends. If the owner unmounts before the exit finishes, `after` is dropped.
 */
export function useSheetExit(): { open: boolean; close: (after: () => void) => void; exitWatcher: ReactNode } {
    const [open, setOpen] = useState(true);
    const pending = useRef<(() => void) | null>(null);
    const close = useCallback((after: () => void) => {
        if (pending.current) return; // already closing: ignore repeated requests
        pending.current = after;
        setOpen(false);
    }, []);
    // React runs deletion cleanups parent-first: when the owner itself is removed (e.g. the page
    // navigates away mid-exit), clear the pending callback before the watcher's cleanup reads it.
    useEffect(() => () => { pending.current = null; }, []);
    const exitWatcher = <SheetExitWatcher pending={pending} />;
    return { open, close, exitWatcher };
}

function SheetExitWatcher({ pending }: { pending: RefObject<(() => void) | null> }) {
    useEffect(() => () => {
        // Runs only for a requested close; a StrictMode remount or a parent unmount without close() does nothing.
        const after = pending.current;
        if (after) { pending.current = null; after(); }
    }, [pending]);
    return null;
}
