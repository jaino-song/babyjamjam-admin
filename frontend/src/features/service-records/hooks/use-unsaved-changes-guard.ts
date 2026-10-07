import { useCallback, useEffect, useRef, useState } from "react";

const GUARD_STATE_KEY = "__serviceRecordLeaveGuard";

type PendingNavigation = { kind: "link"; anchor: HTMLAnchorElement } | { kind: "back" };

export interface UnsavedChangesGuard {
    /** True while the "leave this page?" confirmation should be shown. */
    leavePromptOpen: boolean;
    /** 머무르기: drop the intercepted navigation and stay on the page. */
    stay: () => void;
    /** 나가기: run `onLeave`, then carry on with the intercepted navigation. */
    leave: () => void;
}

function sameDocumentTarget(url: URL): boolean {
    return url.pathname === window.location.pathname && url.search === window.location.search;
}

function interceptableAnchor(event: MouseEvent): HTMLAnchorElement | null {
    if (event.defaultPrevented || event.button !== 0) return null;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest<HTMLAnchorElement>("a[href]") ?? null;
    if (!anchor) return null;
    if (anchor.target && anchor.target !== "_self") return null;
    if (anchor.hasAttribute("download")) return null;
    let url: URL;
    try {
        url = new URL(anchor.href, window.location.href);
    } catch {
        return null;
    }
    // Other origins unload the document, so `beforeunload` already covers them.
    if (url.origin !== window.location.origin) return null;
    // Same page (including hash-only links) does not leave anything behind.
    if (sameDocumentTarget(url)) return null;
    return anchor;
}

/**
 * Warn before unsaved edits are lost.
 *
 * - Tab close / reload / typed URL: native `beforeunload` prompt (its text is
 *   fixed by the browser).
 * - In-app navigation: Next's `<Link onNavigate>` only sees links rendered with
 *   that prop and cannot see back/forward, so same-origin `<a href>` clicks are
 *   intercepted in the capture phase and browser back is held with a guard
 *   history entry. The caller renders its own confirmation from `leavePromptOpen`.
 */
export function useUnsavedChangesGuard({
    active,
    onLeave,
}: {
    active: boolean;
    onLeave: () => void;
}): UnsavedChangesGuard {
    const [promptOpen, setPromptOpen] = useState(false);
    const pendingNavigation = useRef<PendingNavigation | null>(null);
    const bypass = useRef(false);
    const ignoreNextPop = useRef(false);
    const onLeaveRef = useRef(onLeave);
    useEffect(() => { onLeaveRef.current = onLeave; });

    useEffect(() => {
        if (!active) return undefined;
        bypass.current = false;
        ignoreNextPop.current = false;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (bypass.current) return;
            event.preventDefault();
            event.returnValue = "";
        };
        const handleClick = (event: MouseEvent) => {
            if (bypass.current) return;
            const anchor = interceptableAnchor(event);
            if (!anchor) return;
            event.preventDefault();
            event.stopPropagation();
            pendingNavigation.current = { kind: "link", anchor };
            setPromptOpen(true);
        };
        const pushGuardEntry = () => {
            window.history.pushState({ ...(window.history.state ?? {}), [GUARD_STATE_KEY]: true }, "", window.location.href);
        };
        const handlePopState = () => {
            if (bypass.current) return;
            if (ignoreNextPop.current) {
                ignoreNextPop.current = false;
                return;
            }
            pushGuardEntry();
            pendingNavigation.current = { kind: "back" };
            setPromptOpen(true);
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        document.addEventListener("click", handleClick, true);
        window.addEventListener("popstate", handlePopState);
        pushGuardEntry();

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            document.removeEventListener("click", handleClick, true);
            window.removeEventListener("popstate", handlePopState);
            pendingNavigation.current = null;
            setPromptOpen(false);
            // Dropping the guard without leaving: take the extra entry back out.
            if (!bypass.current && window.history.state?.[GUARD_STATE_KEY]) {
                ignoreNextPop.current = true;
                window.history.back();
            }
        };
    }, [active]);

    const stay = useCallback(() => {
        pendingNavigation.current = null;
        setPromptOpen(false);
    }, []);

    const leave = useCallback(() => {
        const navigation = pendingNavigation.current;
        pendingNavigation.current = null;
        bypass.current = true;
        setPromptOpen(false);
        onLeaveRef.current();
        if (navigation?.kind === "link") navigation.anchor.click();
        else if (navigation?.kind === "back") window.history.go(-2);
    }, []);

    return { leavePromptOpen: active && promptOpen, stay, leave };
}
