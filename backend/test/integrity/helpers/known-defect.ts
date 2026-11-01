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
 * `knownDefect` accepts an optional `expectedFailure` matcher (`RegExp` or
 * substring): plain `it.failing` turns ANY error green — setup and infra
 * failures included — so specs should always pass a matcher naming the defect's
 * own symptom; a failure for any other reason then turns the test RED instead
 * of silently passing (see {@link wrapExpectedFailure}).
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
 *
 * The optional `expectedFailure` argument (a `RegExp` or a substring) closes the
 * false-pass hole of `it.failing`: plain `it.failing` turns ANY thrown error
 * green, including an infra/setup error that has nothing to do with the defect.
 * With `expectedFailure`, the body runs inside a guard
 * ({@link wrapExpectedFailure}): a failure whose message matches is rethrown
 * (so `it.failing` keeps the suite green), while a failure for a DIFFERENT
 * reason — or a body that passes — returns normally, which `it.failing` counts
 * as a pass and therefore reports RED. Phase-2 specs should always pass it.
 */
export function knownDefect(id: string, title: string, body: IntegrityTestBody, expectedFailure?: ExpectedFailurePattern): void {
    it.failing(qualified(id, title), expectedFailure === undefined ? body : wrapExpectedFailure(id, title, body, expectedFailure));
}

/** A failure-message matcher: a `RegExp` tested against the message, or a substring. */
export type ExpectedFailurePattern = RegExp | string;

/**
 * Matches `message` against a RegExp matcher. `lastIndex` is reset first: a
 * `g`/`y`-flagged pattern keeps `lastIndex` across `.test()` calls, so a
 * pattern constant shared between tests (or between retries of one test)
 * would silently mismatch every failure after the first. Resetting is
 * harmless for flag-free patterns.
 */
function testRegExpFailure(pattern: RegExp, message: string): boolean {
    pattern.lastIndex = 0;
    return pattern.test(message);
}

/**
 * The `expectedFailure` guard of {@link knownDefect}. Returns a jest test body
 * (`it.failing` semantics: a thrown error counts as the expected failure and
 * stays green, a normal return counts as an unexpected pass and turns RED):
 *
 * - body throws with a message matching `expectedFailure` → rethrow (green);
 * - body throws with a DIFFERENT message → log the mismatch via `console.error`
 *   and return normally, so `it.failing` reports RED (a wrong-reason failure
 *   must not stay green);
 * - body passes → return normally, `it.failing` reports RED (the defect looks
 *   fixed — flip the `knownDefect` call to `invariant`).
 */
export function wrapExpectedFailure(
    id: string,
    title: string,
    body: IntegrityTestBody,
    expectedFailure: ExpectedFailurePattern,
): () => Promise<void> {
    const testName = qualified(id, title);
    return async (): Promise<void> => {
        let thrown: unknown;
        try {
            // Bodies in these specs are async functions; `done`-callback bodies
            // cannot be intercepted this way and are not supported here.
            await (body as () => unknown)();
        } catch (error) {
            thrown = error;
        }
        if (thrown === undefined) {
            return;
        }
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        const matches =
            typeof expectedFailure === "string" ? message.includes(expectedFailure) : testRegExpFailure(expectedFailure, message);
        if (matches) {
            throw thrown;
        }
        console.error(
            `[knownDefect] ${testName}: expected failure ${expectedFailure} but the test failed for a different reason: ${message}. ` +
                "Returning normally so it.failing reports RED — tighten expectedFailure or fix the test.",
        );
    };
}

/** Declares an invariant that holds today, with the same id-prefixed name convention. */
export function invariant(id: string, title: string, body: IntegrityTestBody): void {
    it(qualified(id, title), body);
}
