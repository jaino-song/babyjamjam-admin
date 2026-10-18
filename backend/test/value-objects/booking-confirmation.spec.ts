import { computeServiceStatus, ServiceStatusType } from "domain/value-objects/service-status.vo";
import { clientListTabWhere, getEffectiveClientServiceStatus } from "domain/repositories/client.repository.interface";
import { matchesWhere } from "../utils/prisma-where-evaluator";
import { MockClientRepository } from "../utils/mocks/client.repository.mock";
import { ClientFactory } from "../utils/factories/client.factory";
import { ClientEntity } from "domain/entities/client.entity";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";

describe("booking confirmation status", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const confirmed = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-10-08T00:00:00Z");
    const past = new Date("2026-10-06T00:00:00Z");
    const cases: [string | null, Date | null, Date | null, Date | null, ServiceStatusType][] = [
        ["waiting", future, future, null, "pre_booking"],
        [null, null, null, null, "pre_booking"],
        [null, null, null, confirmed, "pre_booking"],
        [null, future, future, confirmed, "waiting"],
        [null, past, future, confirmed, "active"],
        [null, past, past, confirmed, "completed"],
        ["pre_booking", future, future, confirmed, "waiting"],
        ["pre_booking", past, future, confirmed, "active"],
        ["pre_booking", past, past, confirmed, "completed"],
        ["waiting", null, future, confirmed, "pre_booking"],
        ["active", past, null, confirmed, "pre_booking"],
        ["terminated", past, future, null, "terminated"],
        ["terminated", past, future, confirmed, "terminated"],
        ["replacement_requested", past, future, null, "replacement_requested"],
        ["replacement_requested", past, future, confirmed, "replacement_requested"],
    ];

    beforeEach(() => jest.useFakeTimers().setSystemTime(now));
    afterEach(() => jest.useRealTimers());

    it.each(cases)("derives %s with start %s, end %s, confirmation %s as %s", (status, start, end, confirmation, expected) => {
        for (const derive of [computeServiceStatus, getEffectiveClientServiceStatus]) {
            expect(derive(status, start, end, confirmation, now)).toBe(expected);
        }
    });

    it.each(cases)("SQL predicates and mock agree for %s / %s / %s / %s", async (serviceStatus, startDate, endDate, bookingConfirmedAt, expected) => {
        const row = { serviceStatus, startDate, endDate, bookingConfirmedAt };
        const tabs = ["pre_booking", "waiting", "active", "completed", "terminated", "replacement_requested"] as const;
        const repository = new MockClientRepository();
        const client = Object.assign(ClientFactory.create({ bookingConfirmedAt }), row, { branchId: "branch-1" });
        repository.setData([client]);
        const summary = await repository.getListSummary("branch-1");
        for (const tab of tabs) {
            expect(matchesWhere(row, clientListTabWhere(tab, new Date("2026-10-07")))).toBe(tab === expected);
            expect((await repository.findAllPaginated("branch-1", 1, 10, undefined, tab)).total).toBe(tab === expected ? 1 : 0);
            expect(summary.byTab[tab]).toBe(tab === expected ? 1 : 0);
        }
    });

    it("requires confirmation in automatic tab predicates", () => {
        for (const tab of ["waiting", "active", "completed"] as const) {
            expect(clientListTabWhere(tab, past).AND).toContainEqual({ bookingConfirmedAt: { not: null } });
        }
    });

    it.each(["waiting", "active", "completed", "terminated", "replacement_requested"])("creates supplied %s unconfirmed and preserves only manual states", (serviceStatus) => {
        const client = ClientEntity.create({
            ...ClientFactory.create(), serviceStatus,
            startDate: new Date("2026-11-02"), endDate: new Date("2026-11-13"), duration: 10,
        }, KR_BUILTIN_CALENDAR);
        const expected = serviceStatus === "terminated" || serviceStatus === "replacement_requested" ? serviceStatus : "pre_booking";
        expect(client.bookingConfirmedAt).toBeNull();
        expect(ClientMapper.toPrismaCreate(client)).toMatchObject({ serviceStatus: expected, bookingConfirmedAt: null });
    });
});
