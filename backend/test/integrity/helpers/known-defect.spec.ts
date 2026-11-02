import { wrapExpectedFailure } from "./known-defect";

/**
 * Pure unit tests (no database) for the `expectedFailure` guard of
 * `knownDefect`. They exercise the wrapper's inner function directly, one case
 * per `it.failing` outcome:
 *
 * - matching failure → the wrapper rethrows → `it.failing` counts a failure → GREEN;
 * - non-matching failure → the wrapper returns normally → `it.failing` counts
 *   an unexpected pass → RED (a wrong-reason failure must not stay green);
 * - passing body → the wrapper returns normally → RED (the defect looks fixed).
 */
describe("knownDefect expectedFailure guard (pure unit)", () => {
    it("rethrows a failure whose message matches — it.failing stays green", async () => {
        const wrapped = wrapExpectedFailure(
            "SI-TEST-01",
            "matching failure stays green",
            async () => {
                throw new Error("uniq_client_branch_phone_normalized_key violated as the defect predicts");
            },
            /uniq_client_branch_phone_normalized_key/,
        );
        await expect(wrapped()).rejects.toThrow(/uniq_client_branch_phone_normalized_key/);
    });

    it("returns normally on a non-matching failure and logs the mismatch — it.failing turns red", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const wrapped = wrapExpectedFailure(
                "SI-TEST-02",
                "wrong-reason failure turns red",
                async () => {
                    throw new Error("ECONNREFUSED 127.0.0.1:5432 — infra problem, not the defect");
                },
                /defect symptom/,
            );
            // The thrown reason does not match the expected defect symptom, so
            // the wrapper must not swallow it green: it returns normally, which
            // it.failing counts as an unexpected pass (RED), after logging.
            await expect(wrapped()).resolves.toBeUndefined();
            expect(consoleError).toHaveBeenCalledTimes(1);
            expect(consoleError.mock.calls[0]?.[0]).toContain("SI-TEST-02");
            expect(consoleError.mock.calls[0]?.[0]).toContain("ECONNREFUSED");
        } finally {
            consoleError.mockRestore();
        }
    });

    it("returns normally when the body passes — it.failing turns red", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const wrapped = wrapExpectedFailure(
                "SI-TEST-03",
                "fixed defect turns red",
                async () => {
                    // Body passes: the defect looks fixed; the wrapper returns
                    // normally so it.failing reports RED.
                },
                /defect symptom/,
            );
            await expect(wrapped()).resolves.toBeUndefined();
            expect(consoleError).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it("accepts a plain substring matcher as well as a RegExp", async () => {
        const wrapped = wrapExpectedFailure(
            "SI-TEST-04",
            "substring matcher",
            async () => {
                throw new Error("violates foreign key constraint on employee");
            },
            "violates foreign key constraint",
        );
        await expect(wrapped()).rejects.toThrow(/violates foreign key constraint/);
    });

    it("keeps matching a g-flagged RegExp across repeated failures (lastIndex must not leak between .test calls)", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            // One pattern constant shared by two knownDefect tests — the way a
            // module-level matcher would be used. A `g` flag makes `.test()`
            // advance `lastIndex`, so without a reset the second test's
            // matching failure would be misread as a wrong-reason failure.
            const sharedPattern = /service_record_edit_draft pinned the case/g;
            const first = wrapExpectedFailure(
                "SI-TEST-05",
                "first failure with a shared g-flagged pattern",
                async () => {
                    throw new Error("delete service_record_case#1 failed: service_record_edit_draft pinned the case");
                },
                sharedPattern,
            );
            await expect(first()).rejects.toThrow(/service_record_edit_draft pinned the case/);

            const second = wrapExpectedFailure(
                "SI-TEST-06",
                "second failure with the same shared g-flagged pattern",
                async () => {
                    throw new Error("delete service_record_case#2 failed: service_record_edit_draft pinned the case");
                },
                sharedPattern,
            );
            // Still rethrown: the pattern matched again from the start.
            await expect(second()).rejects.toThrow(/service_record_edit_draft pinned the case/);
            expect(consoleError).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
});
