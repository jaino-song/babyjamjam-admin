import { PrismaClient } from "@prisma/client";

import { ClientService } from "application/services/client.service";
import { ClientDueDateSchedulerService } from "application/services/client-due-date-scheduler.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { MessageAutomationIntentService } from "application/services/message-automation-intent.service";
import { ScheduleChangeService } from "application/services/schedule-change.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { CreateClientUsecase } from "application/usecases/client/create-client.usecase";
import { UpdateClientUsecase } from "application/usecases/client/update-client.usecase";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { KR_BUILTIN_CALENDAR, type KrBusinessDayCalendar } from "domain/utils/business-days";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import type { PrismaService } from "infrastructure/database/prisma.service";
/**
 * Local helpers for the clients state-integrity specs. Everything here is
 * area-local wiring shared by the specs in this folder; harness-owned helpers
 * live in `../helpers/` and are deliberately untouched.
 */

/** KST calendar date of `now` as `YYYY-MM-DD`, via the application's own helper. */
export { isoDateInKorea } from "domain/utils/business-days";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Adds `days` to a `YYYY-MM-DD` string (UTC arithmetic on date-only values). */
export function addDays(isoDate: string, days: number): string {
    if (!ISO_DATE.test(isoDate)) {
        throw new Error(`addDays expects YYYY-MM-DD, got "${isoDate}"`);
    }
    const [year, month, day] = isoDate.split("-").map((part) => Number(part));
    const date = new Date(Date.UTC(year!, (month! - 1), day!));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` string → UTC-midnight `Date`, the stored shape of `@db.Date` columns. */
export function dbDate(isoDate: string): Date {
    if (!ISO_DATE.test(isoDate)) {
        throw new Error(`dbDate expects YYYY-MM-DD, got "${isoDate}"`);
    }
    return new Date(`${isoDate}T00:00:00.000Z`);
}

/** The calendar stub every spec hands to services: real builtin Korean business days, no DB. */
export const calendarStub = {
    forBranch: async () => KR_BUILTIN_CALENDAR,
} as unknown as HolidayCalendarService;

export interface ClientServiceDeps {
    prisma: PrismaService;
    /** A live PrismaClient used by the default find-by-id double. */
    raw: PrismaClient;
    clientRepository?: SbClientRepository;
    messageAutomationIntentService?: Record<string, (...args: never[]) => Promise<unknown>>;
}

/**
 * Minimal real-DB `ClientService`: real prisma + real repository + real
 * create/update usecases; read-by-id resolves through the raw client, and every
 * collaborator the audited write paths never touch is an inert stub. Same
 * construction shape as `test/prisma/eformsign-void-fences.real-db.spec.ts`.
 */
export function makeClientService(deps: ClientServiceDeps): ClientService {
    const repository = deps.clientRepository ?? new SbClientRepository(deps.prisma);
    const readClient = {
        execute: async (_branchId: string, id: number) =>
            ClientMapper.toDomain(await deps.raw.client.findUniqueOrThrow({ where: { id } })),
    };
    return new ClientService(
        new CreateClientUsecase(repository, calendarStub),
        readClient as never,
        {} as never,
        {} as never,
        new UpdateClientUsecase(repository, calendarStub),
        {} as never,
        deps.prisma,
        repository,
        {} as never,
        {} as never,
        (deps.messageAutomationIntentService ?? {}) as never,
        calendarStub,
    );
}

/**
 * Opens several concurrent server connections once so the client's pool holds
 * warm, already-established connections. A lazily-created pool connection
 * (e.g. a second statement racing an open transaction) can take seconds to
 * establish under load, which a short polling window then never observes.
 *
 * Uses `SELECT pg_sleep(0)` so the concurrent body is cheap; the connections
 * return to the pool and stay established.
 */
export async function prewarmConnections(
    prisma: PrismaClient | PrismaService,
    connections = 3,
): Promise<void> {
    await Promise.all(
        Array.from({ length: connections }, () =>
            prisma.$queryRaw`SELECT 1::int AS warmed FROM (SELECT pg_sleep(0.05)) AS warm` satisfies Promise<unknown>,
        ),
    );
}

/**
 * The transactional mode supplies real lifecycle/intent services over the same
 * database, as ClientModule does. The skipped-write race never sends messages;
 * vendor-facing trigger/link collaborators are irrelevant on that path.
 * Fallback explicitly exercises the optional-provider compatibility path.
 */
export function makeDueDateScheduler(
    prisma: PrismaService,
    mode: "transactional" | "fallback" = "fallback",
): ClientDueDateSchedulerService {
    const lease = { holdsLease: () => true };
    return new ClientDueDateSchedulerService(
        prisma,
        lease as never,
        undefined,
        mode === "transactional" ? new ServiceRecordLifecycleService(prisma, calendarStub) : undefined,
        mode === "transactional"
            ? new MessageAutomationIntentService(prisma, {} as never, {} as never, lease as never)
            : undefined,
    );
}

/** `ScheduleChangeService` with a real prisma and inert token writes. */
export function makeScheduleChangeService(prisma: PrismaService): ScheduleChangeService {
    const tokenService = {
        extendExpiryForCase: async () => undefined,
        extendExpiryForSchedule: async () => undefined,
    };
    return new ScheduleChangeService(prisma, tokenService as unknown as ServiceRecordTokenService, calendarStub);
}

/** The `KrBusinessDayCalendar` handed to domain entities by the calendar stub. */
export const builtinCalendar: KrBusinessDayCalendar = KR_BUILTIN_CALENDAR;
