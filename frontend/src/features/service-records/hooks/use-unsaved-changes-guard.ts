import { useCallback, useEffect, useRef, useState } from "react";

import { createLeaveGuardController } from "./leave-guard-controller";

export interface UnsavedChangesGuard {
    /** True while the "leave this page?" confirmation should be shown. */
    leavePromptOpen: boolean;
    /** 머무르기: drop the intercepted navigation and stay on the page. */
    stay: () => void;
    /** 나가기: run `onLeave`, then carry on with the intercepted navigation. */
    leave: () => void;
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
 *
 * The history handling lives in `leave-guard-controller.ts` (see its header for
 * how single- and multi-step Back are held and released).
 */
export function useUnsavedChangesGuard({
    active,
    onLeave,
}: {
    active: boolean;
    onLeave: () => void;
}): UnsavedChangesGuard {
    const [promptOpen, setPromptOpen] = useState(false);
    const [controller] = useState(() => createLeaveGuardController({ onPromptChange: setPromptOpen }));
    const onLeaveRef = useRef(onLeave);
    useEffect(() => { onLeaveRef.current = onLeave; });

    useEffect(() => {
        if (!active) return undefined;
        controller.arm();
        return () => controller.release();
    }, [active, controller]);

    const stay = useCallback(() => controller.stay(), [controller]);
    const leave = useCallback(() => controller.leave(() => onLeaveRef.current()), [controller]);

    return { leavePromptOpen: active && promptOpen, stay, leave };
}
