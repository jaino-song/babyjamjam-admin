/**
 * Pins `Date` (and only `Date`) to a fixed instant for a spec. Timers, the pg driver and the
 * query engine stay real, so it is safe for real-database specs whose fixtures are dated around
 * a fixed day and compare stored dates with "today" (Asia/Seoul).
 */
const REAL_EVERYTHING_BUT_DATE = [
    "hrtime",
    "nextTick",
    "performance",
    "queueMicrotask",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "requestIdleCallback",
    "cancelIdleCallback",
    "setImmediate",
    "clearImmediate",
    "setInterval",
    "clearInterval",
    "setTimeout",
    "clearTimeout",
] as const;

export function pinToday(instantIso: string): void {
    jest.useFakeTimers({ now: new Date(instantIso), doNotFake: [...REAL_EVERYTHING_BUT_DATE] });
}

export function unpinToday(): void {
    jest.useRealTimers();
}
