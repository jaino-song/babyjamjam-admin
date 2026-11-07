import {
    MANUAL_BACKUP_CONTRACT_MILESTONES,
    MANUAL_BACKUP_RECORD_MILESTONES,
    canonicalManualBackupScope,
    decideManualBackupScope,
    manualBackupKstRange,
    parseManualBackupScope,
    type ManualBackupDocument,
    type ManualBackupScope,
} from "domain/eformsign-backup/manual-backup-scope";

// Literal oracles intentionally do not derive from the production constants.
const CONTRACT = ["created", "sent", "opened", "signed", "reviewed", "completed"] as const;
const RECORD = ["created", "sent", "reviewed", "completed"] as const;
const scope = (overrides: Partial<ManualBackupScope> = {}): ManualBackupScope => ({
    period: "all", start: "", end: "", kind: "all",
    contractStages: [...CONTRACT], recordStages: [...RECORD], ...overrides,
});
const custom = (start: string, end: string): ManualBackupScope => scope({ period: "custom", start, end });
const document = (overrides: Partial<Extract<ManualBackupDocument, { kind: "contract" }>> = {}): ManualBackupDocument => ({
    kind: "contract", currentMilestone: "completed", createdAt: new Date("2026-11-05T03:00:00Z"), ...overrides,
});

function expectRejected(input: unknown, path: string): void {
    const result = parseManualBackupScope(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection");
    expect(result.issues).toEqual(expect.arrayContaining([
        { path, message: expect.any(String) },
    ]));
    for (const issue of result.issues) {
        expect(issue.message).toMatch(/[가-힣]/);
    }
}

describe("manual backup scope contract", () => {
    it("should expose the exact six contract and four record IDs in order", () => {
        expect(MANUAL_BACKUP_CONTRACT_MILESTONES).toEqual(CONTRACT);
        expect(MANUAL_BACKUP_RECORD_MILESTONES).toEqual(RECORD);
    });

    it("should accept the default scope and relevant kind subsets", () => {
        const defaults = scope();
        expect(parseManualBackupScope(defaults)).toEqual({ ok: true, value: defaults });
        for (const selected of [
            scope({ kind: "contract", contractStages: ["signed"], recordStages: [] }),
            scope({ kind: "record", contractStages: [], recordStages: ["reviewed"] }),
        ]) {
            expect(parseManualBackupScope(selected)).toEqual({ ok: true, value: selected });
        }
    });

    it("should clone, deduplicate and canonically order both arrays without mutating frozen input", () => {
        const contractStages = Object.freeze(["completed", "created", "signed", "created"] as const);
        const recordStages = Object.freeze(["completed", "sent", "sent"] as const);
        const input = Object.freeze(scope({ contractStages, recordStages }));
        const result = parseManualBackupScope(input);
        expect(result).toEqual({ ok: true, value: {
            period: "all", start: "", end: "", kind: "all",
            contractStages: ["created", "signed", "completed"], recordStages: ["sent", "completed"],
        } });
        if (!result.ok) throw new Error("Expected valid scope");
        expect(result.value).not.toBe(input);
        expect(result.value.contractStages).not.toBe(contractStages);
        expect(result.value.recordStages).not.toBe(recordStages);
        const second = parseManualBackupScope(input);
        if (!second.ok) throw new Error("Expected valid scope");
        expect(second.value.contractStages).not.toBe(result.value.contractStages);
        expect(second.value.recordStages).not.toBe(result.value.recordStages);
        expect(input.contractStages).toEqual(["completed", "created", "signed", "created"]);
        expect(input.recordStages).toEqual(["completed", "sent", "sent"]);
    });

    it.each([null, undefined, [], "private@example.test", 4, new Date(), new (class Scope {})()])(
        "should reject non-plain input %#", (input) => expectRejected(input, ""),
    );

    it("should accept plain objects with a null prototype", () => {
        const input: unknown = Object.assign(Object.create(null), scope());
        expect(parseManualBackupScope(input)).toEqual({ ok: true, value: scope() });
    });

    it.each(["period", "start", "end", "kind", "contractStages", "recordStages"])(
        "should reject a missing %s field", (field) => {
            const input: Record<string, unknown> = { ...scope() };
            delete input[field];
            expectRejected(input, field);
        },
    );

    it("should reject unknown keys without copying their names or values into issues", () => {
        const input = { ...scope(), "private@example.test": "secret-person-name" };
        expectRejected(input, "");
        const serialized = JSON.stringify(parseManualBackupScope(input));
        expect(serialized).not.toContain("private@example.test");
        expect(serialized).not.toContain("secret-person-name");
        expectRejected({ ...scope(), [Symbol("private@example.test")]: true }, "");
        const hidden = Object.defineProperty(scope(), "private@example.test", { value: true });
        expectRejected(hidden, "");
    });

    it.each([
        ["period", 7, "period"], ["period", "private@example.test", "period"],
        ["kind", null, "kind"], ["kind", "private@example.test", "kind"],
        ["start", 20261105, "start"], ["end", null, "end"],
        ["contractStages", "created", "contractStages"], ["recordStages", {}, "recordStages"],
        ["contractStages", ["private@example.test"], "contractStages.0"],
        ["recordStages", ["signed"], "recordStages.0"],
        ["recordStages", ["opened"], "recordStages.0"],
        ["contractStages", [false], "contractStages.0"],
        ["recordStages", [null], "recordStages.0"],
        ["contractStages", new Array(1), "contractStages.0"],
    ])("should reject malformed %s input %#", (field, value, path) => {
        const result = parseManualBackupScope({ ...scope(), [field]: value });
        expectRejected({ ...scope(), [field]: value }, path as string);
        expect(JSON.stringify(result)).not.toContain("private@example.test");
    });

    it("should reject accessors and hostile objects without throwing or echoing errors", () => {
        const input = Object.defineProperty(scope(), "start", {
            get() { throw new Error("private@example.test"); },
        });
        expectRejected(input, "start");
        const proxy = new Proxy({}, { getPrototypeOf() { throw new Error("private@example.test"); } });
        expectRejected(proxy, "");
        expect(JSON.stringify(parseManualBackupScope(proxy))).not.toContain("private@example.test");
    });

    it.each(["contractStages", "recordStages"])("should cap %s at 32 input items before deduplication", (field) => {
        expect(parseManualBackupScope({ ...scope(), [field]: Array(32).fill("created") }).ok).toBe(true);
        expectRejected({ ...scope(), [field]: Array(33).fill("created") }, field);
    });

    it.each([
        ["all", "contractStages"], ["all", "recordStages"],
        ["contract", "contractStages"], ["record", "recordStages"],
    ] as const)("should require relevant nonempty stages for %s/%s", (kind, field) => {
        expectRejected({ ...scope({ kind }), [field]: [] }, field);
    });

    it("should still validate hidden groups' types and IDs", () => {
        expectRejected({ ...scope({ kind: "contract" }), recordStages: ["signed"] }, "recordStages.0");
        expectRejected({ ...scope({ kind: "record" }), contractStages: null }, "contractStages");
    });

    it.each(["start", "end"])("should require empty %s for the all period", (field) => {
        expectRejected({ ...scope(), [field]: "2026-11-05" }, field);
    });

    it.each(["2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])(
        "should accept valid calendar day %s", (day) => {
            expect(parseManualBackupScope(custom(day, day))).toEqual({ ok: true, value: custom(day, day) });
        },
    );

    it.each([
        "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00",
        "0000-01-01", "10000-01-01", "2026-1-01", "26-01-01", "2026-11-05T00:00:00Z",
        "2026/11/05", " 2026-11-05", "2026-11-05\n", "private@example.test",
    ])("should reject invalid calendar day %s on each bound", (day) => {
        expectRejected(custom(day, ""), "start");
        expectRejected(custom("", day), "end");
        expect(JSON.stringify(parseManualBackupScope(custom(day, "")))).not.toContain("private@example.test");
    });

    it("should reject reversed dates and accept custom open bounds", () => {
        expectRejected(custom("2026-11-06", "2026-11-05"), "end");
        for (const selected of [custom("", ""), custom("2026-11-05", ""), custom("", "2026-11-05")]) {
            expect(parseManualBackupScope(selected)).toEqual({ ok: true, value: selected });
        }
    });

    it.each([
        ["7", "2026-10-30", "2026-11-05"],
        ["7", "2023-12-29", "2024-01-04"],
        ["30", "2024-02-01", "2024-03-01"],
        ["30", "2001-12-15", "2002-01-13"],
    ] as const)("should preserve posted %s-day bounds %s..%s regardless of today's date", (period, start, end) => {
        const input = scope({ period, start, end });
        expect(parseManualBackupScope(input)).toEqual({ ok: true, value: input });
    });

    it.each([
        ["7", "2026-10-31", "2026-11-05", "end"],
        ["7", "2026-10-29", "2026-11-05", "end"],
        ["30", "2024-02-02", "2024-03-01", "end"],
        ["30", "2024-01-31", "2024-03-01", "end"],
        ["7", "", "2026-11-05", "start"],
        ["30", "2026-11-05", "", "end"],
    ] as const)("should reject invalid fixed %s-day bounds %#", (period, start, end, path) => {
        expectRejected(scope({ period, start, end }), path);
    });
});

describe("manualBackupKstRange", () => {
    it("should convert KST midnight to literal UTC bounds and return independent Dates", () => {
        const input = Object.freeze(custom("2026-11-05", "2026-11-05"));
        const range = manualBackupKstRange(input);
        expect(range).toEqual({ gte: new Date("2026-11-04T15:00:00Z"), lt: new Date("2026-11-05T15:00:00Z") });
        expect(range.gte).not.toBe(manualBackupKstRange(input).gte);
        expect(range.lt).not.toBe(manualBackupKstRange(input).lt);
        range.gte?.setTime(0);
        range.lt?.setTime(0);
        expect(manualBackupKstRange(input)).toEqual({
            gte: new Date("2026-11-04T15:00:00Z"), lt: new Date("2026-11-05T15:00:00Z"),
        });
        expect(input).toEqual(custom("2026-11-05", "2026-11-05"));
    });

    it.each([
        ["2024-02-29", "2024-02-29", "2024-02-28T15:00:00.000Z", "2024-02-29T15:00:00.000Z"],
        ["2026-12-31", "2026-12-31", "2026-12-30T15:00:00.000Z", "2026-12-31T15:00:00.000Z"],
        ["0001-01-01", "0001-01-01", "0000-12-31T15:00:00.000Z", "0001-01-01T15:00:00.000Z"],
        ["9999-12-31", "9999-12-31", "9999-12-30T15:00:00.000Z", "9999-12-31T15:00:00.000Z"],
    ])("should handle leap and year boundaries for %s", (start, end, gte, lt) => {
        const range = manualBackupKstRange(custom(start, end));
        expect(range.gte?.toISOString()).toBe(gte);
        expect(range.lt?.toISOString()).toBe(lt);
    });

    it("should omit absent bounds and return an empty range for all periods", () => {
        expect(manualBackupKstRange(scope())).toEqual({});
        expect(manualBackupKstRange(custom("", ""))).toEqual({});
        expect(manualBackupKstRange(custom("2026-11-05", ""))).toEqual({ gte: new Date("2026-11-04T15:00:00Z") });
        expect(manualBackupKstRange(custom("", "2026-11-05"))).toEqual({ lt: new Date("2026-11-05T15:00:00Z") });
    });

    it.each([
        custom("2026-02-30", ""), custom("2026-11-06", "2026-11-05"),
        scope({ period: "7", start: "2026-11-01", end: "2026-11-05" }),
        scope({ start: "2026-11-05" }), scope({ contractStages: [] }),
        { ...scope(), kind: "unexpected" }, null,
    ])("should reject invalid internal scopes with RangeError %#", (input) => {
        expect(() => manualBackupKstRange(input as ManualBackupScope)).toThrow(RangeError);
        expect(() => canonicalManualBackupScope(input as ManualBackupScope)).toThrow(RangeError);
    });
});

describe("canonicalManualBackupScope", () => {
    it("should serialize fixed key order and canonical arrays for fingerprint identity", () => {
        const input = {
            recordStages: ["completed", "created", "created"], kind: "all", end: "2026-11-05",
            contractStages: ["signed", "created", "signed"], start: "2026-11-01", period: "custom",
        } as ManualBackupScope;
        const expected = '{"period":"custom","start":"2026-11-01","end":"2026-11-05","kind":"all","contractStages":["created","signed"],"recordStages":["created","completed"]}';
        expect(canonicalManualBackupScope(input)).toBe(expected);
        expect(canonicalManualBackupScope({
            ...input, contractStages: ["created", "signed"], recordStages: ["created", "completed"],
        })).toBe(expected);
        expect(input.contractStages).toEqual(["signed", "created", "signed"]);
        expect(canonicalManualBackupScope({ ...input, kind: "contract" })).not.toBe(expected);
        expect(canonicalManualBackupScope({ ...input, end: "2026-11-06" })).not.toBe(expected);
        expect(canonicalManualBackupScope({ ...input, contractStages: ["completed"] })).not.toBe(expected);
    });
});

describe("decideManualBackupScope", () => {
    it.each([
        ["2026-11-04T14:59:59.999Z", false, "date-filter"],
        ["2026-11-04T15:00:00.000Z", true, null],
        ["2026-11-05T14:59:59.999Z", true, null],
        ["2026-11-05T15:00:00.000Z", false, "date-filter"],
    ])("should apply inclusive start and exclusive next-day end at %s", (at, matches, reason) => {
        expect(decideManualBackupScope(custom("2026-11-05", "2026-11-05"), document({ createdAt: new Date(at as string) })))
            .toEqual({ matches, reason });
    });

    it("should apply open and all bounds", () => {
        expect(decideManualBackupScope(custom("2026-11-05", ""), document({ createdAt: new Date("2099-01-01Z") }))).toEqual({ matches: true, reason: null });
        expect(decideManualBackupScope(custom("", "2026-11-05"), document({ createdAt: new Date("2000-01-01Z") }))).toEqual({ matches: true, reason: null });
        expect(decideManualBackupScope(scope(), document({ createdAt: new Date("1900-01-01Z") }))).toEqual({ matches: true, reason: null });
    });

    it("should match only the current milestone, never cumulative history", () => {
        expect(decideManualBackupScope(scope({ contractStages: ["created", "signed"] }), document())).toEqual({ matches: false, reason: "stage-filter" });
        expect(decideManualBackupScope(scope({ contractStages: ["completed"] }), document())).toEqual({ matches: true, reason: null });
        for (const currentMilestone of CONTRACT) {
            expect(decideManualBackupScope(scope({ contractStages: [currentMilestone] }), document({ currentMilestone }))).toEqual({ matches: true, reason: null });
        }
        for (const currentMilestone of RECORD) {
            const record: ManualBackupDocument = { kind: "record", currentMilestone, createdAt: new Date("2026-11-05T03:00Z") };
            expect(decideManualBackupScope(scope({ recordStages: [currentMilestone] }), record)).toEqual({ matches: true, reason: null });
        }
        expect(decideManualBackupScope(scope({ recordStages: ["created"] }), {
            kind: "record", currentMilestone: "completed", createdAt: new Date("2026-11-05T03:00Z"),
        })).toEqual({ matches: false, reason: "stage-filter" });
    });

    it.each(["contract", "record"] as const)("should report unknown %s milestones as unverified for all vs subset", (kind) => {
        const unknown: ManualBackupDocument = { kind, currentMilestone: null, createdAt: new Date("2026-11-05T03:00Z") };
        expect(decideManualBackupScope(scope({ kind }), unknown)).toEqual({ matches: true, reason: "stage-unverified" });
        expect(decideManualBackupScope(scope(), unknown)).toEqual({ matches: true, reason: "stage-unverified" });
        const subset = kind === "contract" ? scope({ contractStages: ["created"] }) : scope({ recordStages: ["created"] });
        expect(decideManualBackupScope(subset, unknown)).toEqual({ matches: false, reason: "stage-unverified" });
        expect(decideManualBackupScope(custom("2026-11-06", ""), unknown)).toEqual({ matches: false, reason: "date-filter" });
    });

    it("should reject kinds before date/stage filters and invalid Dates before other document filters", () => {
        expect(decideManualBackupScope(scope({ kind: "record", contractStages: [] }), document())).toEqual({ matches: false, reason: "kind-filter" });
        expect(decideManualBackupScope(scope({ kind: "contract", recordStages: [] }), {
            kind: "record", currentMilestone: null, createdAt: new Date("2026-11-05T03:00Z"),
        })).toEqual({ matches: false, reason: "kind-filter" });
        expect(decideManualBackupScope(custom("2026-11-06", ""), document({ createdAt: new Date(NaN) }))).toEqual({ matches: false, reason: "invalid-date" });
        expect(decideManualBackupScope(scope({ kind: "record" }), document({ createdAt: new Date(NaN) }))).toEqual({ matches: false, reason: "invalid-date" });
    });

    it("should preserve the document Date and scope", () => {
        const input = Object.freeze(scope());
        const doc = Object.freeze(document());
        const before = doc.createdAt.getTime();
        expect(decideManualBackupScope(input, doc)).toEqual({ matches: true, reason: null });
        expect(doc.createdAt.getTime()).toBe(before);
        expect(input).toEqual(scope());
    });
});
