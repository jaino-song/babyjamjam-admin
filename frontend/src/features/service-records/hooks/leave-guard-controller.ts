/**
 * Framework-free core of the unsaved-changes leave guard.
 *
 * History model while armed (`E` = the editor's own entry, `G` = the guard entry):
 *
 *     ... , P, E, G        <- the user rests on G
 *
 * Why two strategies: Next's app router listens for `popstate` on `window` from the
 * moment the app boots, so its listener always runs before ours (window listeners run
 * in registration order, capture or not), and React flushes the resulting route change
 * synchronously inside that same event. A guard that only reacts to `popstate` is
 * therefore too late whenever Back lands on another URL: the editor is already gone.
 *
 * 1. Navigation API (Chromium; any browser that has `window.navigation`): the `navigate`
 *    event fires *before* the traversal and is cancelable, so we veto it. Nothing moves,
 *    Next never hears about it, the editor URL/entry and its state stay exactly as they
 *    were, and 머무르기 needs no history work at all. 나가기 calls
 *    `navigation.traverseTo(key)` on the entry the user was heading to, so single- and
 *    multi-entry Back both land exactly where they were going.
 * 2. `popstate` fallback (no Navigation API, or a traversal the browser will not let us
 *    cancel):
 *    - Back from G lands on E (same URL, so Next re-renders the same page): modal;
 *      머무르기 pushes a fresh G, 나가기 goes back once more and lands exactly on P.
 *    - A multi-entry Back lands on another entry D. Where Next owns the router this is
 *      already too late (see above); where it does not, we push E' (copy of E: same URL
 *      and `history.state`) on top of D so the page never leaves the editor URL, 머무르기
 *      pushes G on top of E', and 나가기 goes back one entry from E', which is D itself.
 *      The entries between D and E, and any forward entries, are dropped, as with any
 *      new navigation made from D.
 *
 * Same-document traversals whose pathname + search equal the editor's (hash-only
 * entries) are never a departure and are always allowed.
 *
 * Entries are recognised by a tag stored next to Next's own keys in `history.state`
 * (`{ ...state, [KEY]: { id, role } }`); Next's `__NA` / `__PRIVATE_NEXTJS_INTERNALS_TREE`
 * are copied untouched, so Next keeps treating our entries as its own. Next preserves
 * custom history state on traversals and restores, but a `router.refresh()` replaces the
 * current entry's state without it, which would drop that entry's tag.
 */

const GUARD_STATE_KEY = "__serviceRecordLeaveGuard";

type EntryRole = "editor" | "guard";
interface EntryTag { id: string; role: EntryRole }
/**
 * `vetoed` is set when the Navigation API stopped the traversal before it happened;
 * `destinationKey` is then the entry it was heading to (null = the single step back
 * from the editor entry, i.e. the entry before E).
 */
type PendingNavigation =
    | { kind: "link"; anchor: HTMLAnchorElement }
    | { kind: "back"; vetoed?: { destinationKey: string | null } };

// The Navigation API is not in TypeScript's DOM lib yet; only what we use.
interface NavigationEntryLike { key: string; index: number }
interface NavigateEventLike extends Event {
    navigationType: string;
    cancelable: boolean;
    destination: { key: string; url: string; sameDocument: boolean };
}
interface NavigationLike {
    currentEntry: NavigationEntryLike | null;
    entries: () => NavigationEntryLike[];
    traverseTo: (key: string) => { committed: Promise<unknown>; finished: Promise<unknown> };
    addEventListener: (type: "navigate", listener: (event: NavigateEventLike) => void) => void;
    removeEventListener: (type: "navigate", listener: (event: NavigateEventLike) => void) => void;
}

function getNavigation(): NavigationLike | null {
    const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
    return navigation && typeof navigation.traverseTo === "function" ? navigation : null;
}

interface Armed {
    id: string;
    /** Editor URL (path + search + hash) restored whenever a traversal is held back. */
    href: string;
    pathname: string;
    search: string;
    /** `history.state` of the editor entry; copied onto every entry we push. */
    editorState: unknown;
    /** Navigation API key of the editor entry (only when the API exists). */
    editorKey: string | null;
}

export interface LeaveGuardController {
    /** Start guarding: tag the current entry, push the guard entry, listen. */
    arm: () => void;
    /** Stop guarding. The guard entry is taken back out on the next tick (see `arm`). */
    release: () => void;
    /** 머무르기: keep the page and re-arm the guard. */
    stay: () => void;
    /** 나가기: run `onLeave`, then carry on with the held navigation. */
    leave: (onLeave: () => void) => void;
}

let nextId = 0;

function readTag(state: unknown): EntryTag | null {
    if (typeof state !== "object" || state === null) return null;
    const tag = (state as Record<string, unknown>)[GUARD_STATE_KEY];
    if (typeof tag !== "object" || tag === null) return null;
    const { id, role } = tag as Partial<EntryTag>;
    return typeof id === "string" && (role === "editor" || role === "guard") ? { id, role } : null;
}

function withTag(state: unknown, tag: EntryTag): Record<string, unknown> {
    const base = typeof state === "object" && state !== null ? state : {};
    return { ...base, [GUARD_STATE_KEY]: tag };
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
    if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
    return anchor;
}

export function createLeaveGuardController({
    onPromptChange,
}: {
    onPromptChange: (open: boolean) => void;
}): LeaveGuardController {
    let armed: Armed | null = null;
    let listening = false;
    let bypass = false;
    let pending: PendingNavigation | null = null;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;

    const pushGuardEntry = (a: Armed) => {
        window.history.pushState(withTag(a.editorState, { id: a.id, role: "guard" }), "", a.href);
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
        if (bypass) return;
        event.preventDefault();
        event.returnValue = "";
    };

    const handleClick = (event: MouseEvent) => {
        if (bypass) return;
        const anchor = interceptableAnchor(event);
        if (!anchor) return;
        event.preventDefault();
        event.stopPropagation();
        pending = { kind: "link", anchor };
        onPromptChange(true);
    };

    const handlePopState = (event: PopStateEvent) => {
        const a = armed;
        if (bypass || !a) return;
        const tag = readTag(window.history.state);

        if (tag?.id === a.id) {
            if (tag.role === "guard") {
                // Back at the resting position (e.g. Forward from E, or Back out of a
                // hash-only entry): nothing was held, so drop a stale Back prompt.
                if (pending?.kind === "back") {
                    pending = null;
                    onPromptChange(false);
                }
                return;
            }
            // Single-step Back onto the editor entry. The URL did not change.
            a.editorState = window.history.state;
            pending = { kind: "back" };
            onPromptChange(true);
            return;
        }

        // Hash-only traversal inside the editor document: not a departure.
        if (window.location.pathname === a.pathname && window.location.search === a.search) return;

        // Multi-entry traversal to some other entry D. Keep Next's router from
        // rendering D, put the editor URL/entry back on top of D, then ask.
        event.stopImmediatePropagation();
        window.history.pushState(withTag(a.editorState, { id: a.id, role: "editor" }), "", a.href);
        pending = { kind: "back" };
        onPromptChange(true);
    };

    const handleNavigate = (event: NavigateEventLike) => {
        const a = armed;
        if (bypass || !a || event.navigationType !== "traverse") return;
        // Cross-document traversals unload the page (`beforeunload` covers them), and
        // a traversal the browser will not let us cancel is left to the popstate fallback.
        if (!event.cancelable || !event.destination.sameDocument) return;
        const headingToEditorEntry = a.editorKey !== null && event.destination.key === a.editorKey;
        if (!headingToEditorEntry) {
            let url: URL;
            try {
                url = new URL(event.destination.url);
            } catch {
                return;
            }
            // Hash-only entries of the editor document are not a departure.
            if (url.pathname === a.pathname && url.search === a.search) return;
        }
        event.preventDefault();
        pending = { kind: "back", vetoed: { destinationKey: headingToEditorEntry ? null : event.destination.key } };
        onPromptChange(true);
    };

    const addListeners = () => {
        if (listening) return;
        listening = true;
        window.addEventListener("beforeunload", handleBeforeUnload);
        document.addEventListener("click", handleClick, true);
        window.addEventListener("popstate", handlePopState, true);
        getNavigation()?.addEventListener("navigate", handleNavigate);
    };

    const removeListeners = () => {
        if (!listening) return;
        listening = false;
        window.removeEventListener("beforeunload", handleBeforeUnload);
        document.removeEventListener("click", handleClick, true);
        window.removeEventListener("popstate", handlePopState, true);
        getNavigation()?.removeEventListener("navigate", handleNavigate);
    };

    return {
        arm() {
            bypass = false;
            if (releaseTimer !== null) {
                // `release` ran a moment ago (React StrictMode's synthetic unmount, or a
                // quick active -> inactive -> active flip): the entries are still in place.
                clearTimeout(releaseTimer);
                releaseTimer = null;
            } else if (armed === null) {
                const id = `${Date.now().toString(36)}-${(nextId += 1)}`;
                const { pathname, search, hash } = window.location;
                window.history.replaceState(withTag(window.history.state, { id, role: "editor" }), "");
                armed = {
                    id,
                    href: `${pathname}${search}${hash}`,
                    pathname,
                    search,
                    editorState: window.history.state,
                    editorKey: getNavigation()?.currentEntry?.key ?? null,
                };
                pushGuardEntry(armed);
            }
            addListeners();
        },

        release() {
            removeListeners();
            pending = null;
            onPromptChange(false);
            const a = armed;
            if (!a) return;
            if (bypass) {
                // 나가기 is already navigating away; do not fight it.
                armed = null;
                return;
            }
            // Dropping the guard without leaving: take the guard entry back out, but
            // only if we are still resting on it, and never mid-StrictMode-remount.
            releaseTimer = setTimeout(() => {
                releaseTimer = null;
                armed = null;
                const tag = readTag(window.history.state);
                if (tag?.id === a.id && tag.role === "guard") window.history.back();
            }, 0);
        },

        stay() {
            // A vetoed traversal never moved anything, so there is nothing to put back.
            const heldBack = pending?.kind === "back" && !pending.vetoed;
            pending = null;
            onPromptChange(false);
            const a = armed;
            if (!heldBack || !a) return;
            const tag = readTag(window.history.state);
            if (tag?.id === a.id && tag.role === "editor") {
                a.editorState = window.history.state;
                pushGuardEntry(a);
            }
        },

        leave(onLeave) {
            const navigation = pending;
            pending = null;
            const a = armed;
            const tag = readTag(window.history.state);
            const onGuardEntry = a !== null && tag?.id === a.id && tag.role === "guard";
            bypass = true;
            onPromptChange(false);
            onLeave();
            if (navigation?.kind === "link") navigation.anchor.click();
            else if (navigation?.kind === "back" && navigation.vetoed) traverseVetoed(a, navigation.vetoed.destinationKey);
            else if (navigation?.kind === "back") window.history.go(onGuardEntry ? -2 : -1);
        },
    };
}

/** Carry out a traversal that `handleNavigate` vetoed, now that the guard is bypassed. */
function traverseVetoed(a: Armed | null, destinationKey: string | null) {
    const navigation = getNavigation();
    try {
        let key = destinationKey;
        if (key === null && navigation && a?.editorKey) {
            // Single-step Back: the entry before the editor entry.
            const entries = navigation.entries();
            const editor = entries.find((entry) => entry.key === a.editorKey);
            key = editor && editor.index > 0 ? (entries[editor.index - 1]?.key ?? null) : null;
        }
        if (navigation && key !== null) {
            const traversal = navigation.traverseTo(key);
            traversal.committed.catch(() => undefined);
            traversal.finished.catch(() => undefined);
            return;
        }
    } catch {
        // The entry is gone (e.g. history was trimmed): fall through to a plain Back.
    }
    window.history.back();
}
