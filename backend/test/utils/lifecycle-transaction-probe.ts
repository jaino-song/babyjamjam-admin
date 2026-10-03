import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { KOREAN_HOLIDAY_CALENDAR, createKrBusinessDayCalendar } from "domain/utils/business-days";
import { createHolidayCalendarStub } from "./holiday-calendar.stub";

const BRANCH_ID = "11111111-1111-1111-1111-111111111111";

/**
 * A real `ServiceRecordLifecycleService` over an in-memory client with no
 * service-record case yet (so the lifecycle must read the branch calendar to
 * derive N), plus a root client whose `$transaction` records the window in which
 * the owning transaction holds its pooled connection.
 *
 * The calendar service reads through the root client, so a `forBranch` call made
 * while that window is open needs a second pooled connection. A caller that opens
 * its own `$transaction` must therefore resolve the calendar first and hand it to
 * `ensureForClient`; `state.forBranchWhileOpen` lists, per `forBranch` call, whether
 * it happened inside that window.
 */
export function createLifecycleTransactionProbe(options: { clientId?: number } = {}) {
    const clientId = options.clientId ?? 1;
    const tables = {
        client: {
            findUnique: jest.fn().mockResolvedValue({
                id: clientId,
                branchId: BRANCH_ID,
                startDate: new Date("2026-09-07T00:00:00.000Z"),
                endDate: new Date("2026-09-18T00:00:00.000Z"),
                duration: 9,
                serviceStatus: "in_progress",
                employeeSchedules: [],
            }),
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        service_record_case: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ id: "case-1" }),
        },
        service_record_token: { updateMany: jest.fn() },
    };
    const state = { open: false, forBranchWhileOpen: [] as boolean[] };
    const prisma = {
        ...tables,
        $transaction: jest.fn(async (callback: (tx: typeof tables) => Promise<unknown>) => {
            state.open = true;
            try {
                return await callback(tables);
            } finally {
                state.open = false;
            }
        }),
    };
    const calendar = createKrBusinessDayCalendar(
        [...Object.values(KOREAN_HOLIDAY_CALENDAR).flat(), "2026-09-14"],
        { version: "kr-db-test", supportedYears: Object.keys(KOREAN_HOLIDAY_CALENDAR).map(Number) },
    );
    const holidayCalendar = createHolidayCalendarStub();
    (holidayCalendar.forBranch as jest.Mock).mockImplementation(async () => {
        state.forBranchWhileOpen.push(state.open);
        return calendar;
    });
    const lifecycle = new ServiceRecordLifecycleService(prisma as unknown as PrismaService, holidayCalendar);
    jest.spyOn(lifecycle, "recompute").mockResolvedValue({ id: "case-1" } as never);
    return { prisma, tables, holidayCalendar, calendar, lifecycle, state, branchId: BRANCH_ID };
}
