/**
 * Known-defect marker for state-integrity tests.
 *
 * Rationale: the test written with `knownDefect` states the CORRECT invariant —
 * the behavior the system is supposed to have. While the known defect exists, the
 * test fails, and wrapping it in `it.failing` (Jest 30, jest-circus) keeps the
 * suite green: `it.failing` inverts the expectation, so an expected failure counts
 * as passing. When a later unit fixes the defect, the test starts passing and
 * `it.failing` turns RED (it now expected a failure that no longer happens), which
 * forces the fixing unit to flip `knownDefect(...)` to a plain `invariant(...)` —
 * the same test body, now asserted to hold.
 *
 * Both wrappers prefix the test name with the defect id (`SI-<AREA>-<NN>`, e.g.
 * `SI-CLIENT-01`) so a failing run names the tracked defect directly and the id
 * can be grepped across specs, TODOs and reports.
 *
 * Use `invariant` for the same id-prefixed style on checks that already hold today.
 */

/** Ids look like `SI-CLIENT-01`: `SI-`, an uppercase area, a dash, a two-digit number. */
const INTEGRITY_ID_PATTERN = /^SI-[A-Z]+-[0-9]{2}$/;

/** Same shape jest accepts for a test body: an async (or done-callback) function. */
export type IntegrityTestBody = jest.ProvidesCallback;

function qualified(id: string, title: string): string {
    if (!INTEGRITY_ID_PATTERN.test(id)) {
        throw new Error(`integrity test id must match SI-<AREA>-<NN> (e.g. SI-CLIENT-01), got "${id}"`);
    }
    return `${id} ${title}`;
}

/**
 * Declares the CORRECT invariant as a test that is expected to fail until the
 * tracked defect is fixed. Green while the defect exists, red after a fix lands
 * (the fix unit must then flip this call to `invariant`).
 */
export function knownDefect(id: string, title: string, body: IntegrityTestBody): void {
    it.failing(qualified(id, title), body);
}

/** Declares an invariant that holds today, with the same id-prefixed name convention. */
export function invariant(id: string, title: string, body: IntegrityTestBody): void {
    it(qualified(id, title), body);
}
