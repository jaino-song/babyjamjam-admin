import { Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import type { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { SERVICE_RECORD_CASE_STATUS, ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { KOREAN_HOLIDAY_CALENDAR, createKrBusinessDayCalendar } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { tenantIsolationExtension } from "infrastructure/database/tenant-isolation.extension";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { UpsertSessionDto } from "interface/dto/service-record-entry.dto";

/**
 * Real-PostgreSQL check that a session-save auto-extend closes the client's open
 * holiday review item in the same transaction, through the tenant-isolation extension
 * in `enforce` mode. Skipped unless HOLIDAY_REVIEW_REAL_DB=1, and then only against a
 * local throwaway database:
 *
 *   createdb throwaway_ae && export DATABASE_URL=postgresql://<user>@localhost/throwaway_ae DIRECT_URL=$DATABASE_URL
 *   npx prisma migrate deploy && HOLIDAY_REVIEW_REAL_DB=1 npx jest test/prisma/service-record-autoextend-review.real-db.spec.ts
 */
const ENABLED = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1";
const describeReal = ENABLED ? describe : describe.skip;

// Same guard as holiday-review.real-db.spec.ts (a spec cannot be imported without running it).
const THROWAWAY_URL = /^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/;
function assertThrowawayTarget(): void {
    const url = process.env["DATABASE_URL"];
    if (!url || url !== process.env["DIRECT_URL"] || !THROWAWAY_URL.test(url)) {
        throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL must be the same local throwaway database");
    }
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const SIGNATURE = "data:image/png;base64,aGVsbG8=";

describeReal("session-save auto-extend closes the open review item (real PostgreSQL, tenant enforce)", () => {
    let raw: PrismaClient;
    let service: ServiceRecordEntryService;
    let branchA: string;
    let branchB: string;
    let eventId: string;
    const previousMode = process.env["TENANT_ISOLATION_MODE"];

    beforeAll(async () => {
        assertThrowawayTarget();
        process.env["TENANT_ISOLATION_MODE"] = "enforce";
        for (const level of ["log", "warn", "debug", "error"] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
        }
        raw = new PrismaClient();
        await raw.$connect();
        const suffix = Date.now().toString(36);
        branchA = (await raw.branch.create({ data: { name: "A", slug: `throwaway-ae-a-${suffix}` } })).id;
        branchB = (await raw.branch.create({ data: { name: "B", slug: `throwaway-ae-b-${suffix}` } })).id;
        eventId = (await raw.holiday_change_event.create({
            data: { branchId: branchA, date: d("2026-09-14"), change: "added", name: "지점 휴무", source: "branch-override", processedAt: new Date() },
        })).id;

        // The branch closed on 2026-09-14 on top of the built-in calendar.
        const calendar = createKrBusinessDayCalendar(
            [...Object.values(KOREAN_HOLIDAY_CALENDAR).flat(), "2026-09-14"],
            { version: "kr-db-test", supportedYears: Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number) },
        );
        const holidayCalendar = { forBranch: async () => calendar } as unknown as HolidayCalendarService;
        const extended = new PrismaClient().$extends(tenantIsolationExtension());
        service = new ServiceRecordEntryService(
            extended as unknown as PrismaService,
            { extendExpiryForCase: async () => undefined } as unknown as ServiceRecordTokenService,
            { ensureForClient: async () => null, recompute: async () => null } as unknown as ServiceRecordLifecycleService,
            holidayCalendar,
        );
    });

    afterAll(async () => {
        const branches = { in: [branchA, branchB] };
        await raw.end_date_review_item.deleteMany({ where: { branchId: branches } });
        await raw.holiday_change_event.deleteMany({ where: { id: eventId } });
        await raw.service_record_day.deleteMany({ where: { branchId: branches } });
        await raw.service_record_case.deleteMany({ where: { branchId: branches } });
        await raw.employee_schedule.deleteMany({ where: { branchId: branches } });
        await raw.client.deleteMany({ where: { branchId: branches } });
        await raw.employee.deleteMany({ where: { branchId: branches } });
        await raw.branch.deleteMany({ where: { id: branches } });
        await raw.$disconnect();
        if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
        else process.env["TENANT_ISOLATION_MODE"] = previousMode;
        jest.restoreAllMocks();
    });

    /** A case 2026-09-07..2026-09-29 with N = 15 whose first session is about to be saved. */
    async function makeCase(branchId: string, label: string) {
        const employee = await raw.employee.create({
            data: { name: `제공자${label}`, workArea: [], phone: `010-0000-${label}`, phoneNormalized: `0100000${label}`, grade: "A", branchId },
        });
        const client = await raw.client.create({
            data: {
                name: `고객${label}`,
                voucherClient: false,
                branchId,
                startDate: d("2026-09-07"),
                endDate: d("2026-09-29"),
                duration: 15,
                serviceStatus: "active",
            },
        });
        const schedule = await raw.employee_schedule.create({
            data: {
                primaryEmployeeId: employee.id,
                workAddress: "서울",
                startDate: d("2026-09-07"),
                endDate: d("2026-09-29"),
                clientId: client.id,
                branchId,
            },
        });
        const record = await raw.service_record_case.create({
            data: {
                branchId,
                clientId: client.id,
                status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
                startDate: d("2026-09-07"),
                endDate: d("2026-09-29"),
                requiredSessionCount: 15,
            },
        });
        return { employee, client, schedule, record };
    }

    function makeItem(branchId: string, clientId: number, recalculatedEnd: string) {
        return raw.end_date_review_item.create({
            data: {
                changeEventId: eventId,
                branchId,
                clientId,
                storedEnd: d("2026-09-29"),
                recalculatedEnd: d(recalculatedEnd),
                affectedFrom: d("2026-09-14"),
                category: "safe",
                reason: "no_sessions_after_date",
                status: "open",
            },
        });
    }

    const save = (branchId: string, fixture: Awaited<ReturnType<typeof makeCase>>) =>
        tenantContextStore.run({ origin: "http", branchId }, async () => await service.upsertSession(
            {
                tokenId: "token-1",
                branchId,
                scheduleId: fixture.schedule.id,
                employeeId: fixture.employee.id,
                serviceRecordCaseId: fixture.record.id,
            },
            1,
            {
                serviceDate: "2026-09-07T00:00:00.000Z",
                answers: {},
                paymentConfirmed: true,
                momApproval: "approved",
                clientSignature: SIGNATURE,
            } as UpsertSessionDto,
            false,
        ));

    it("fixes the open item (system-resolved) when the extended end date is the recommended one, and leaves another branch's item alone", async () => {
        const own = await makeCase(branchA, "1111");
        const other = await makeCase(branchB, "2222");
        const ownItem = await makeItem(branchA, own.client.id, "2026-09-30");
        const otherItem = await makeItem(branchB, other.client.id, "2026-09-30");

        await save(branchA, own);

        expect((await raw.client.findUniqueOrThrow({ where: { id: own.client.id } })).endDate).toEqual(d("2026-09-30"));
        expect(await raw.end_date_review_item.findUniqueOrThrow({ where: { id: ownItem.id } })).toMatchObject({
            status: "fixed",
            resolvedBy: null,
            resolvedAt: expect.any(Date),
        });
        expect(await raw.end_date_review_item.findUniqueOrThrow({ where: { id: otherItem.id } })).toMatchObject({
            status: "open",
            resolvedAt: null,
        });
    });

    it("marks the open item obsolete when the extended end date differs from the recommendation", async () => {
        const fixture = await makeCase(branchA, "3333");
        const item = await makeItem(branchA, fixture.client.id, "2026-10-01");

        await save(branchA, fixture);

        expect((await raw.client.findUniqueOrThrow({ where: { id: fixture.client.id } })).endDate).toEqual(d("2026-09-30"));
        expect(await raw.end_date_review_item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
            status: "obsolete",
            resolvedAt: expect.any(Date),
        });
    });

    it("extends the end date without touching review items when the client has none open", async () => {
        const fixture = await makeCase(branchA, "4444");
        const kept = await makeItem(branchA, fixture.client.id, "2026-09-30");
        await raw.end_date_review_item.update({ where: { id: kept.id }, data: { status: "kept" } });

        await save(branchA, fixture);

        expect((await raw.client.findUniqueOrThrow({ where: { id: fixture.client.id } })).endDate).toEqual(d("2026-09-30"));
        expect((await raw.end_date_review_item.findUniqueOrThrow({ where: { id: kept.id } })).status).toBe("kept");
    });
});
