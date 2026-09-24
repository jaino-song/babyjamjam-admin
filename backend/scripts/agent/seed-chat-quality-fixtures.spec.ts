import {
    buildFixturePlan,
    diffAgainstExisting,
    parseCliArgs,
    CliUsageError,
    isFixtureMarkerPhone,
    addDaysYmd,
    mondayOfWeek,
    fridayOfWeek,
    nextMonday,
    nthBusinessDayOnOrAfter,
    MUST_NOT_EXIST_NAME,
    DOCUMENT_ID_PREFIX,
    type ExistingState,
    type FixturePlan,
} from "./seed-chat-quality-fixtures";

const BRANCH_ID = "33dbe950-1574-4951-b7b4-92d97ab29512";

function emptyExistingState(): ExistingState {
    return {
        clientsWithFixtureNames: [],
        employeesWithFixtureNames: [],
        otherMarkerPhoneClientRows: [],
        otherMarkerPhoneEmployeeRows: [],
        mustNotExistNameCount: 0,
        schedules: [],
        contractDocs: [],
    };
}

describe("date helpers", () => {
    test("addDaysYmd adds/subtracts calendar days across month/year boundaries", () => {
        expect(addDaysYmd("2026-09-24", 3)).toBe("2026-09-27");
        expect(addDaysYmd("2026-09-24", -14)).toBe("2026-09-10");
        expect(addDaysYmd("2026-12-30", 3)).toBe("2027-01-02");
    });

    test("mondayOfWeek/fridayOfWeek resolve the calendar week for a Thursday", () => {
        // 2026-09-24 is a Thursday.
        expect(mondayOfWeek("2026-09-24")).toBe("2026-09-21");
        expect(fridayOfWeek("2026-09-24")).toBe("2026-09-25");
    });

    test("mondayOfWeek is idempotent on a Monday and a Sunday wraps to the prior Monday", () => {
        expect(mondayOfWeek("2026-09-21")).toBe("2026-09-21");
        expect(mondayOfWeek("2026-09-27")).toBe("2026-09-21"); // Sunday
    });

    test("nextMonday is always strictly in the future, even when today is itself a Monday", () => {
        expect(nextMonday("2026-09-24")).toBe("2026-09-28"); // Thursday -> next Monday
        expect(nextMonday("2026-09-21")).toBe("2026-09-28"); // Monday -> the FOLLOWING Monday, not today
        expect(nextMonday("2026-09-27")).toBe("2026-09-28"); // Sunday -> tomorrow
    });

    test("nthBusinessDayOnOrAfter skips weekends", () => {
        // 2026-09-28 is a Monday with no holiday in the immediate window.
        expect(nthBusinessDayOnOrAfter("2026-09-28", 1)).toBe("2026-09-28");
        expect(nthBusinessDayOnOrAfter("2026-09-28", 5)).toBe("2026-10-02"); // Mon-Fri, no weekend crossed
    });

    test("nthBusinessDayOnOrAfter also skips the shared KR holiday calendar", () => {
        // From 2026-09-28 (Mon), the 6th business day must skip the Sat/Sun
        // (10-03/10-04) AND the National Foundation Day holidays (10-03, 10-05)
        // and Hangeul Day (10-09).
        expect(nthBusinessDayOnOrAfter("2026-09-28", 10)).toBe("2026-10-13");
    });
});

describe("isFixtureMarkerPhone", () => {
    test("accepts every phone in the reserved marker range", () => {
        expect(isFixtureMarkerPhone("01000000100")).toBe(true);
        expect(isFixtureMarkerPhone("01000000199")).toBe(true);
        expect(isFixtureMarkerPhone("01000000150")).toBe(true);
    });

    test("rejects phones outside the range and null/undefined", () => {
        expect(isFixtureMarkerPhone("01000000099")).toBe(false);
        expect(isFixtureMarkerPhone("01000000200")).toBe(false);
        expect(isFixtureMarkerPhone(null)).toBe(false);
        expect(isFixtureMarkerPhone(undefined)).toBe(false);
    });
});

describe("buildFixturePlan", () => {
    const TODAY = "2026-09-24"; // Thursday, matches the brief's own worked example
    const plan = buildFixturePlan(TODAY, BRANCH_ID);

    test("produces exactly 9 clients and 4 employees, all in the given branch", () => {
        expect(plan.clients).toHaveLength(9);
        expect(plan.employees).toHaveLength(4);
        expect(plan.branchId).toBe(BRANCH_ID);
    });

    test("every fixture phone is inside the marker range", () => {
        for (const client of plan.clients) {
            expect(isFixtureMarkerPhone(client.phoneNormalized)).toBe(true);
        }
        for (const employee of plan.employees) {
            expect(isFixtureMarkerPhone(employee.phoneNormalized)).toBe(true);
        }
    });

    test("names are unique per table except the deliberate 탁은서 pair (C7 client / E3 employee)", () => {
        const clientNames = plan.clients.map((c) => c.name);
        expect(new Set(clientNames).size).toBe(clientNames.length);
        const employeeNames = plan.employees.map((e) => e.name);
        expect(new Set(employeeNames).size).toBe(employeeNames.length);

        const c7 = plan.clients.find((c) => c.key === "C7");
        const e3 = plan.employees.find((e) => e.key === "E3");
        expect(c7?.name).toBe("탁은서");
        expect(e3?.name).toBe("탁은서");
        // Different tables, so this is not a same-table duplicate.
        expect(c7?.phoneNormalized).not.toBe(e3?.phoneNormalized);
    });

    test("C4's schedule covers this week's Monday-Friday relative to --today", () => {
        const c4Schedule = plan.schedules.find((s) => s.clientKey === "C4");
        expect(c4Schedule?.startDate).toBe("2026-09-21");
        expect(c4Schedule?.endDate).toBe("2026-09-25");
    });

    test("C9's service end date is --today + 3 days", () => {
        const c9 = plan.clients.find((c) => c.key === "C9");
        expect(c9?.endDate).toBe("2026-09-27");
    });

    test("C5's schedule starts next Monday and runs 10 business days", () => {
        const c5Schedule = plan.schedules.find((s) => s.clientKey === "C5");
        expect(c5Schedule?.startDate).toBe("2026-09-28");
        expect(c5Schedule?.endDate).toBe("2026-10-13");
    });

    test("service status values match the amended per-client table", () => {
        const byKey = new Map(plan.clients.map((c) => [c.key, c.serviceStatus] as const));
        expect(byKey.get("C1")).toBe("completed");
        expect(byKey.get("C2")).toBe("completed");
        expect(byKey.get("C3")).toBe("active");
        expect(byKey.get("C4")).toBe("active");
        expect(byKey.get("C5")).toBe("waiting");
        expect(byKey.get("C6")).toBe("active");
        expect(byKey.get("C7")).toBe("completed");
        expect(byKey.get("C8")).toBe("active");
        expect(byKey.get("C9")).toBe("active");
    });

    test("contract doc status codes: 003 for C1/C2/C9, 060 for C3", () => {
        const byKey = new Map(plan.contractDocs.map((d) => [d.clientKey, d] as const));
        expect(byKey.get("C1")?.statusType).toBe("003");
        expect(byKey.get("C2")?.statusType).toBe("003");
        expect(byKey.get("C9")?.statusType).toBe("003");
        const c3Doc = byKey.get("C3");
        expect(c3Doc?.statusType).toBe("060");
        expect(c3Doc?.stepType).not.toBe("06");
        expect(c3Doc?.stepName).toContain("산모");
    });

    test("every contract doc id carries the required fixture prefix", () => {
        for (const doc of plan.contractDocs) {
            expect(doc.documentId.startsWith(DOCUMENT_ID_PREFIX)).toBe(true);
        }
    });

    test("employee work areas: E1 is 남동구, others are elsewhere", () => {
        const e1 = plan.employees.find((e) => e.key === "E1");
        expect(e1?.workArea).toEqual(["남동구"]);
        expect(e1?.openToNextWork).toBe(false);
    });

    test("every fixture client suppresses the greeting SMS and is a voucher client", () => {
        for (const client of plan.clients) {
            expect(client.suppressGreetingSms).toBe(true);
            expect(client.voucherClient).toBe(true);
        }
    });

    test(`"${MUST_NOT_EXIST_NAME}" never appears as a fixture name`, () => {
        const allNames = [...plan.clients.map((c) => c.name), ...plan.employees.map((e) => e.name)];
        expect(allNames).not.toContain(MUST_NOT_EXIST_NAME);
    });

    test("is deterministic for the same inputs", () => {
        const again = buildFixturePlan(TODAY, BRANCH_ID);
        expect(again).toEqual(plan);
    });

    test("rejects a malformed --today", () => {
        expect(() => buildFixturePlan("2026/09/24", BRANCH_ID)).toThrow();
    });

    test("rejects an empty branchId", () => {
        expect(() => buildFixturePlan(TODAY, "")).toThrow();
    });
});

describe("diffAgainstExisting", () => {
    const plan: FixturePlan = buildFixturePlan("2026-09-24", BRANCH_ID);

    test("every row is a create against empty existing state, with no refusals", () => {
        const diff = diffAgainstExisting(plan, emptyExistingState());
        expect(diff.refusals).toEqual([]);
        expect(diff.clients.every((entry) => entry.kind === "create")).toBe(true);
        expect(diff.employees.every((entry) => entry.kind === "create")).toBe(true);
        expect(diff.schedules.every((entry) => entry.kind === "create")).toBe(true);
        expect(diff.contractDocs.every((entry) => entry.kind === "create")).toBe(true);
    });

    test("an existing fixture row with matching marker phone becomes update or unchanged, never create", () => {
        const c1 = plan.clients.find((c) => c.key === "C1")!;
        const state: ExistingState = {
            ...emptyExistingState(),
            clientsWithFixtureNames: [{
                id: 501, name: c1.name, phone: c1.phone, phoneNormalized: c1.phoneNormalized,
                address: "다른 주소", type: c1.type, startDate: c1.startDate, endDate: c1.endDate,
                serviceStatus: c1.serviceStatus, voucherClient: c1.voucherClient, suppressGreetingSms: c1.suppressGreetingSms,
            }],
        };
        const diff = diffAgainstExisting(plan, state);
        const entry = diff.clients.find((e) => e.key === "C1")!;
        expect(entry.kind).toBe("update");
        expect(entry.changedFields).toContain("address");
        expect(entry.existingId).toBe(501);
        expect(diff.refusals).toEqual([]);
    });

    test("an identical existing fixture row is unchanged", () => {
        const c1 = plan.clients.find((c) => c.key === "C1")!;
        const state: ExistingState = {
            ...emptyExistingState(),
            clientsWithFixtureNames: [{
                id: 501, name: c1.name, phone: c1.phone, phoneNormalized: c1.phoneNormalized,
                address: c1.address, type: c1.type, startDate: c1.startDate, endDate: c1.endDate,
                serviceStatus: c1.serviceStatus, voucherClient: c1.voucherClient, suppressGreetingSms: c1.suppressGreetingSms,
            }],
        };
        const diff = diffAgainstExisting(plan, state);
        const entry = diff.clients.find((e) => e.key === "C1")!;
        expect(entry.kind).toBe("unchanged");
        expect(diff.refusals).toEqual([]);
    });

    test("refuses when a fixture name exists with a non-marker phone (never touch a non-fixture row)", () => {
        const c1 = plan.clients.find((c) => c.key === "C1")!;
        const state: ExistingState = {
            ...emptyExistingState(),
            clientsWithFixtureNames: [{
                id: 9, name: c1.name, phone: "010-9999-0000", phoneNormalized: "01099990000",
                address: null, type: null, startDate: null, endDate: null,
                serviceStatus: null, voucherClient: true, suppressGreetingSms: false,
            }],
        };
        const diff = diffAgainstExisting(plan, state);
        expect(diff.refusals.length).toBeGreaterThan(0);
        expect(diff.refusals[0]).toContain(c1.name);
    });

    test("refuses when any other row in the branch holds a marker-range phone not belonging to this plan", () => {
        const state: ExistingState = {
            ...emptyExistingState(),
            otherMarkerPhoneClientRows: [{ name: "누군가", phoneNormalized: "01000000150" }],
        };
        const diff = diffAgainstExisting(plan, state);
        expect(diff.refusals.some((r) => r.includes("01000000150"))).toBe(true);
    });

    test(`refuses when "${MUST_NOT_EXIST_NAME}" is present`, () => {
        const state: ExistingState = { ...emptyExistingState(), mustNotExistNameCount: 1 };
        const diff = diffAgainstExisting(plan, state);
        expect(diff.refusals.some((r) => r.includes(MUST_NOT_EXIST_NAME))).toBe(true);
    });
});

describe("parseCliArgs", () => {
    test("parses required flags and defaults --apply to false", () => {
        const options = parseCliArgs([`--branch-id=${BRANCH_ID}`, "--database-url-sha=0123456789ab"]);
        expect(options).toEqual({ branchId: BRANCH_ID, databaseUrlSha: "0123456789ab", today: undefined, apply: false });
    });

    test("parses --today and --apply", () => {
        const options = parseCliArgs([
            `--branch-id=${BRANCH_ID}`, "--database-url-sha=0123456789ab", "--today=2026-09-24", "--apply",
        ]);
        expect(options.today).toBe("2026-09-24");
        expect(options.apply).toBe(true);
    });

    test("throws when --branch-id is missing", () => {
        expect(() => parseCliArgs(["--database-url-sha=0123456789ab"])).toThrow(CliUsageError);
    });

    test("throws when --database-url-sha is missing", () => {
        expect(() => parseCliArgs([`--branch-id=${BRANCH_ID}`])).toThrow(CliUsageError);
    });

    test("throws when --database-url-sha is not exactly 12 lowercase hex chars", () => {
        expect(() => parseCliArgs([`--branch-id=${BRANCH_ID}`, "--database-url-sha=ABCDEF012345"])).toThrow(CliUsageError);
        expect(() => parseCliArgs([`--branch-id=${BRANCH_ID}`, "--database-url-sha=short"])).toThrow(CliUsageError);
    });

    test("throws on a malformed --today", () => {
        expect(() => parseCliArgs([`--branch-id=${BRANCH_ID}`, "--database-url-sha=0123456789ab", "--today=notadate"])).toThrow();
    });

    test("throws on an unrecognized argument", () => {
        expect(() => parseCliArgs(["--nonsense=1"])).toThrow(CliUsageError);
    });
});
