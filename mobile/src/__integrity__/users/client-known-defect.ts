/**
 * Client-side known-defect wrapper for the `users` state-integrity area
 * (mirrors backend/test/integrity/helpers/known-defect.ts semantics, implemented
 * locally with jest only — backend helpers are never imported into the client
 * packages).
 *
 * `knownDefect` states the CORRECT invariant: while the defect exists the body
 * fails and `it.failing` keeps the suite green. `expectedFailure` closes the
 * false-pass hole of plain `it.failing`: a failure whose message does NOT match
 * is logged and the wrapper returns normally, which `it.failing` reports RED,
 * and a body that passes is also RED — forcing a flip to `invariant` after a fix.
 */

export type ClientTestBody = jest.ProvidesCallback;
export type ExpectedFailurePattern = RegExp | string;

export function invariant(id: string, title: string, body: ClientTestBody): void {
    it(`${id} ${title}`, body);
}

function messageOf(thrown: unknown): string {
    return thrown instanceof Error ? thrown.message : String(thrown);
}

function matches(pattern: ExpectedFailurePattern, message: string): boolean {
    if (typeof pattern === "string") {
        return message.includes(pattern);
    }
    pattern.lastIndex = 0;
    return pattern.test(message);
}

export function knownDefect(
    id: string,
    title: string,
    body: ClientTestBody,
    expectedFailure: ExpectedFailurePattern,
): void {
    it.failing(`${id} ${title}`, async () => {
        let thrown: unknown;
        try {
            // Bodies in these specs are async functions; done-callback bodies cannot be
            // intercepted this way and are not supported here.
            await (body as () => unknown)();
        } catch (error) {
            thrown = error;
        }
        if (thrown === undefined) {
            return;
        }
        const message = messageOf(thrown);
        if (!matches(expectedFailure, message)) {
            console.error(
                `[knownDefect] ${id} ${title}: expected failure ${String(expectedFailure)} but the test failed for a ` +
                    `different reason: ${message}. Returning normally so it.failing reports RED.`,
            );
            return;
        }
        throw thrown;
    });
}
