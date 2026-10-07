import {
    buildClientUpdatePayload,
    hasServicePeriodChange,
    serializeClientUpdateFields,
    type ClientUpdateFormFields,
} from "../client-update-payload";

const stored: ClientUpdateFormFields = {
    name: "홍길동",
    birthday: "1990-01-01",
    dueDate: "2026-10-20",
    birthDate: "",
    address: "인천시 남동구",
    phone: "01012345678",
    primaryEmployeeId: 3,
    secondaryEmployeeId: null,
    type: "A가1",
    duration: 10,
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    startDate: "2026-11-02",
    endDate: "2026-11-13",
    careCenter: false,
    voucherClient: true,
    breastPump: false,
    serviceStatus: "pre_booking",
    areaId: "",
};

describe("mobile client update payload", () => {
    it("sends nothing when nothing changed", () => {
        expect(buildClientUpdatePayload({ baseline: stored, current: { ...stored } })).toEqual({});
    });

    it("sends only the changed field for a non-period edit", () => {
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: { ...stored, address: "인천시 연수구" },
        })).toEqual({ address: "인천시 연수구" });
    });

    it("sends the whole period and the opening end date for any period change", () => {
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: { ...stored, startDate: "2026-11-03", endDate: "2026-11-16" },
        })).toEqual({
            startDate: "2026-11-03",
            endDate: "2026-11-16",
            duration: 10,
            expectedEndDate: "2026-11-13",
        });
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: { ...stored, duration: 15 },
        })).toEqual({
            startDate: "2026-11-02",
            endDate: "2026-11-13",
            duration: 15,
            expectedEndDate: "2026-11-13",
        });
    });

    it("guards against an end date that was empty when the form opened", () => {
        expect(buildClientUpdatePayload({
            baseline: { ...stored, startDate: "", endDate: "", duration: null },
            current: { ...stored },
        }).expectedEndDate).toBeNull();
    });

    it("carries the business-day confirmation only with a period change", () => {
        const periodEdit = { ...stored, endDate: "2026-11-16" };
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: periodEdit,
            allowBusinessDayMismatch: true,
        })).toEqual(expect.objectContaining({ allowBusinessDayMismatch: true }));
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: { ...stored, address: "인천시 연수구" },
            allowBusinessDayMismatch: true,
        })).toEqual({ address: "인천시 연수구" });
    });

    it("does not send employee ids that are unset, and sends one that was assigned", () => {
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: { ...stored, primaryEmployeeId: null },
        })).toEqual({});
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: { ...stored, secondaryEmployeeId: 9 },
        })).toEqual({ secondaryEmployeeId: 9 });
    });

    it("removes the secondary employee with an explicit null, and does not resend an unchanged null", () => {
        const withSecondary: ClientUpdateFormFields = { ...stored, secondaryEmployeeId: 4 };
        expect(buildClientUpdatePayload({
            baseline: withSecondary,
            current: { ...withSecondary, secondaryEmployeeId: null },
        })).toEqual({ secondaryEmployeeId: null });
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: { ...stored, secondaryEmployeeId: null },
        })).toEqual({});
        expect(buildClientUpdatePayload({
            baseline: withSecondary,
            current: { ...withSecondary },
        })).toEqual({});
    });

    it("sends a re-priced client's new prices", () => {
        expect(buildClientUpdatePayload({
            baseline: stored,
            current: { ...stored, fullPrice: "1100000", actualPrice: "300000" },
        })).toEqual({ fullPrice: "1100000", actualPrice: "300000" });
    });

    it("never sends a field the form does not hold", () => {
        const withoutOptional: ClientUpdateFormFields = { ...stored, birthDate: undefined, areaId: undefined };
        const fields = serializeClientUpdateFields(withoutOptional);
        expect(fields).not.toHaveProperty("birthDate");
        expect(fields).not.toHaveProperty("areaId");
    });

    it("reports a period change only when a period field differs", () => {
        expect(hasServicePeriodChange(stored, { ...stored, address: "인천시 연수구" })).toBe(false);
        expect(hasServicePeriodChange(stored, { ...stored, endDate: "2026-11-16" })).toBe(true);
        expect(hasServicePeriodChange(stored, { ...stored, duration: 15 })).toBe(true);
    });
});

// The desktop helper is the original; the mobile one mirrors it. Both must give the same body for
// the same edit, or the two apps would write a client differently.
describe("parity with the desktop client update payload", () => {
    type Helper = {
        buildClientUpdatePayload: typeof buildClientUpdatePayload;
        hasServicePeriodChange: typeof hasServicePeriodChange;
    };
    const desktop = jest.requireActual(
        "../../../../../../frontend/src/components/app/clients/client-update-payload",
    ) as Helper;

    const edits: Array<[string, Partial<ClientUpdateFormFields>]> = [
        ["no change", {}],
        ["address only", { address: "인천시 연수구" }],
        ["name and phone", { name: "김길동", phone: "01099998888" }],
        ["start date", { startDate: "2026-11-03", endDate: "2026-11-16" }],
        ["end date only", { endDate: "2026-11-20" }],
        ["duration only", { duration: 15 }],
        ["period cleared", { startDate: "", endDate: "", duration: null }],
        ["reprice", { fullPrice: "1100000", grant: "900000", actualPrice: "200000" }],
        ["out-of-pocket switch", { voucherClient: false, type: "", fullPrice: "900000" }],
        ["employees", { primaryEmployeeId: null, secondaryEmployeeId: 9 }],
        // Not here: clearing an assigned secondary employee. Mobile sends `secondaryEmployeeId: null` (as the
        // old wizard did); the desktop helper still omits it, which is a known desktop limitation.
        ["care center and status", { careCenter: true, serviceStatus: "active" }],
        ["due date cleared", { dueDate: "" }],
    ];

    it.each(edits)("builds the same body as desktop for: %s", (_label, change) => {
        const current = { ...stored, ...change } as ClientUpdateFormFields;
        for (const allowBusinessDayMismatch of [false, true]) {
            const input = { baseline: stored, current, allowBusinessDayMismatch };
            expect(buildClientUpdatePayload(input)).toEqual(
                // The desktop form type is wider than the mobile one; the fields compared are the same.
                desktop.buildClientUpdatePayload(input as never),
            );
        }
        expect(hasServicePeriodChange(stored, current)).toBe(
            desktop.hasServicePeriodChange(stored as never, current as never),
        );
    });
});
