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
 * entries) are never a departure and are always allowed. The one exception is the
 * helper traversal itself: Back from G onto E. That is a departure (one step back
 * from the editor) and is held; Back or Forward onto E from any other entry (e.g.
 * #a <-> #b entries around E) is hash-only and passes.
 *
 * Hash entries pushed while armed ([E, G, H1, ...]): while armed, `history.pushState`
 * is wrapped so same-page pushes (Next's router, `<Link href="#x">`) are recorded with
 * their state and URL and tagged `role: "above"`. When the guard is released with such
 * entries above G, the guard entry cannot be deleted, so the history is rebuilt without
 * it: go back to E, push the recorded entries again (same URL, same state, Next's keys
 * intact), then step back to the entry the user was on. Every entry involved shares
 * the editor's pathname and search, so the user is never taken to another page. Entries
 * the guard could not see (plain `<a href="#x">` fragment navigations never call
 * `pushState`) make the position unverifiable; the rebuild is then skipped and G stays
 * as one extra same-URL entry (documented limitation, nothing navigates).
 *
 * Entries are recognised by a tag stored next to Next's own keys in `history.state`
 * (`{ ...state, [KEY]: { id, role } }`); Next's `__NA` / `__PRIVATE_NEXTJS_INTERNALS_TREE`
 * are copied untouched, so Next keeps treating our entries as its own. Next preserves
 * custom history state on traversals and restores, but a `router.refresh()` replaces the
 * current entry's state without it, which would drop that entry's tag.
 */

const GUARD_STATE_KEY = "__serviceRecordLeaveGuard";

type EntryRole = "editor" | "guard" | "above";
/** `depth` (role "above" only): 1 = the first entry pushed above G. */
interface EntryTag { id: string; role: EntryRole; depth?: number }
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
    /** True while the user rests on G (the origin that makes Back-onto-E a departure). */
    onGuard: boolean;
    /** Position within [G, ...above]: 0 = G, n = above[n - 1], -1 = not verifiably one of ours. */
    pos: number;
    /** Same-page entries pushed above G, in order (state is stored without our tag). */
    above: Array<{ url: string; state: unknown }>;
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
    const { id, role, depth } = tag as Partial<EntryTag>;
    if (typeof id !== "string") return null;
    if (role === "editor" || role === "guard") return { id, role };
    return role === "above" && typeof depth === "number" ? { id, role, depth } : null;
}

function stripTag(state: unknown): unknown {
    if (typeof state !== "object" || state === null) return state;
    const { [GUARD_STATE_KEY]: _tag, ...rest } = state as Record<string, unknown>;
    void _tag;
    return rest;
}

function currentUrl(): string {
    const { pathname, search, hash } = window.location;
    return `${pathname}${search}${hash}`;
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

    let tracking = false;
    let internalWrite = false;
    let restoreHistoryWrappers: (() => void) | null = null;

    // Our own pushes/replaces must not be recorded as "above" entries.
    const ownWrite = (write: () => void) => {
        internalWrite = true;
        try {
            write();
        } finally {
            internalWrite = false;
        }
    };

    const pushGuardEntry = (a: Armed) => {
        ownWrite(() => window.history.pushState(withTag(a.editorState, { id: a.id, role: "guard" }), "", a.href));
        a.onGuard = true;
        a.pos = 0;
        a.above = [];
    };

    const isSamePage = (url: string | URL | null | undefined, a: Armed): boolean => {
        if (url === undefined || url === null) return true;
        try {
            const target = new URL(String(url), window.location.href);
            return target.origin === window.location.origin && target.pathname === a.pathname && target.search === a.search;
        } catch {
            return false;
        }
    };

    /**
     * Wrap `pushState` / `replaceState` while armed so entries pushed above G are recorded
     * (see header) and a router's `replaceState` cannot strip our tag from the current entry.
     */
    const installHistoryWrappers = () => {
        if (restoreHistoryWrappers) return;
        const history = window.history;
        const originalPush = history.pushState;
        const originalReplace = history.replaceState;

        const wrappedPush = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
            const a = armed;
            if (!tracking || internalWrite || !a || !isSamePage(url, a)) return originalPush.call(this, data, unused, url);
            if (a.pos < 0) return originalPush.call(this, data, unused, url);
            const depth = a.pos + 1;
            const result = originalPush.call(this, withTag(data, { id: a.id, role: "above", depth }), unused, url);
            a.above = [...a.above.slice(0, a.pos), { url: currentUrl(), state: stripTag(window.history.state) }];
            a.pos = depth;
            a.onGuard = false;
            return result;
        };
        const wrappedReplace = function (this: History, data: unknown, unused: string, url?: string | URL | null) {
            const a = armed;
            const current = readTag(window.history.state);
            if (!tracking || internalWrite || !a || current?.id !== a.id) return originalReplace.call(this, data, unused, url);
            // Keep our tag on the entry even when a router replaces its state without it.
            const next = readTag(data) === null ? withTag(data, current) : data;
            const result = originalReplace.call(this, next, unused, url);
            if (current.role === "above" && a.above[(current.depth ?? 0) - 1]) {
                a.above[(current.depth ?? 0) - 1] = { url: currentUrl(), state: stripTag(window.history.state) };
            } else if (current.role === "editor") {
                a.editorState = window.history.state;
            }
            return result;
        };
        history.pushState = wrappedPush as typeof history.pushState;
        history.replaceState = wrappedReplace as typeof history.replaceState;
        restoreHistoryWrappers = () => {
            // Only unwind what is still ours; if the router re-patched on top, ours goes inert.
            if (history.pushState === wrappedPush) history.pushState = originalPush;
            if (history.replaceState === wrappedReplace) history.replaceState = originalReplace;
            restoreHistoryWrappers = null;
        };
    };

    const waitForPopState = (then: () => void) => {
        let done = false;
        const finish = (run: boolean) => {
            if (done) return;
            done = true;
            window.removeEventListener("popstate", onPop);
            clearTimeout(timer);
            if (run) then();
        };
        const onPop = () => finish(true);
        const timer = setTimeout(() => finish(false), 1000);
        window.addEventListener("popstate", onPop);
    };

    /**
     * Release: drop G from the effective history without leaving the editor page.
     * (The guard entry cannot be deleted, only traversed past or pushed over.)
     */
    const dispose = (a: Armed) => {
        const tag = readTag(window.history.state);
        if (!tag || tag.id !== a.id) return;
        if (tag.role === "guard" && a.above.length === 0) {
            window.history.back();
            return;
        }
        const verified =
            a.pos >= 0 && ((tag.role === "guard" && a.pos === 0) || (tag.role === "above" && tag.depth === a.pos));
        if (!verified) return; // position unknown: leave G in place rather than guess
        const entries = a.above;
        const stepsBack = entries.length - a.pos;
        waitForPopState(() => {
            const landed = readTag(window.history.state);
            if (landed?.id !== a.id || landed.role !== "editor") return;
            for (const entry of entries) window.history.pushState(entry.state, "", entry.url);
            if (stepsBack > 0) window.history.go(-stepsBack);
        });
        window.history.go(-(a.pos + 1));
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
        const ours = tag?.id === a.id ? tag : null;
        const cameFromGuard = a.onGuard;
        a.onGuard = ours?.role === "guard";
        a.pos = ours?.role === "guard" ? 0 : ours?.role === "above" ? (ours.depth ?? -1) : -1;

        if (ours) {
            if (ours.role === "guard") {
                // Back at the resting position (e.g. Forward from E, or Back out of a
                // hash-only entry): nothing was held, so drop a stale Back prompt.
                if (pending?.kind === "back") {
                    pending = null;
                    onPromptChange(false);
                }
                return;
            }
            if (ours.role === "above") return; // hash-only entry pushed after arming
            // Landed on E. From G that is the single-step Back (the URL did not change);
            // from anywhere else (Back/Forward between hash-only entries) it is not a departure.
            if (!cameFromGuard) return;
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
        ownWrite(() => window.history.pushState(withTag(a.editorState, { id: a.id, role: "editor" }), "", a.href));
        a.onGuard = false;
        a.pos = -1;
        pending = { kind: "back" };
        onPromptChange(true);
    };

    const handleNavigate = (event: NavigateEventLike) => {
        const a = armed;
        if (bypass || !a || event.navigationType !== "traverse") return;
        // Cross-document traversals unload the page (`beforeunload` covers them), and
        // a traversal the browser will not let us cancel is left to the popstate fallback.
        if (!event.cancelable || !event.destination.sameDocument) return;
        // Back from G onto E is the departure we hold. Reaching E from any other entry
        // (Forward from #a, Back out of a hash entry above G) is a hash-only traversal.
        const current = readTag(window.history.state);
        const fromGuard = current?.id === a.id && current.role === "guard";
        const headingToEditorEntry = a.editorKey !== null && event.destination.key === a.editorKey && fromGuard;
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
        tracking = true;
        installHistoryWrappers();
    };

    const removeListeners = () => {
        if (!listening) return;
        listening = false;
        window.removeEventListener("beforeunload", handleBeforeUnload);
        document.removeEventListener("click", handleClick, true);
        window.removeEventListener("popstate", handlePopState, true);
        getNavigation()?.removeEventListener("navigate", handleNavigate);
        tracking = false;
        restoreHistoryWrappers?.();
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
                ownWrite(() => window.history.replaceState(withTag(window.history.state, { id, role: "editor" }), ""));
                armed = {
                    id,
                    href: `${pathname}${search}${hash}`,
                    pathname,
                    search,
                    editorState: window.history.state,
                    editorKey: getNavigation()?.currentEntry?.key ?? null,
                    onGuard: false,
                    pos: -1,
                    above: [],
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
            // Dropping the guard without leaving: take the guard entry back out of the
            // effective history (see `dispose`), never mid-StrictMode-remount.
            releaseTimer = setTimeout(() => {
                releaseTimer = null;
                armed = null;
                dispose(a);
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
