import { ClientEntity } from "domain/entities/client.entity";
import { SERVICE_STATUS, ServiceStatusType } from "domain/value-objects/service-status.vo";
import { isoDateInKorea } from "domain/utils/business-days";
import type { Prisma } from "@prisma/client";

export type AutomaticServiceStatusUpdateResult = "updated" | "stale";

export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export const CLIENT_LIST_TAB_VALUES = [
    "all",
    SERVICE_STATUS.PRE_BOOKING,
    SERVICE_STATUS.WAITING,
    SERVICE_STATUS.REPLACEMENT_REQUESTED,
    SERVICE_STATUS.ACTIVE,
    SERVICE_STATUS.COMPLETED,
    SERVICE_STATUS.TERMINATED,
] as const;

export type ClientListTab = (typeof CLIENT_LIST_TAB_VALUES)[number];

export interface ClientListSummary {
    total: number;
    byTab: Record<ClientListTab, number>;
    dueDate: {
        thisMonth: number;
        nextMonth: number;
    };
    serviceEnd: {
        count: number;
        from: string;
        to: string;
    };
}

interface KoreaCalendarDate {
    year: number;
    month: number;
    day: number;
}

export interface ClientListDateRanges {
    today: string;
    threeDaysLater: string;
    todayStart: Date;
    tomorrowStart: Date;
    threeDaysLaterEndExclusive: Date;
    thisMonthStart: Date;
    nextMonthStart: Date;
    nextMonthEndExclusive: Date;
}

function parseKoreaCalendarDate(isoDate: string): KoreaCalendarDate {
    const [year = "0", month = "0", day = "0"] = isoDate.split("-");
    return { year: Number(year), month: Number(month), day: Number(day) };
}

function formatKoreaCalendarDate(date: KoreaCalendarDate): string {
    return [date.year, date.month, date.day]
        .map((value, index) => index === 0 ? String(value).padStart(4, "0") : String(value).padStart(2, "0"))
        .join("-");
}

function shiftCalendarDays(isoDate: string, days: number): string {
    const { year, month, day } = parseKoreaCalendarDate(isoDate);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return formatKoreaCalendarDate({
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    });
}

function firstOfMonth(isoDate: string, monthOffset: number): string {
    const { year, month } = parseKoreaCalendarDate(isoDate);
    const shifted = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
    return formatKoreaCalendarDate({
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: 1,
    });
}

function dateOnlyStart(isoDate: string): Date {
    return new Date(`${isoDate}T00:00:00.000Z`);
}

export function getClientListDateRanges(now = new Date()): ClientListDateRanges {
    const today = isoDateInKorea(now);
    const tomorrow = shiftCalendarDays(today, 1);
    const threeDaysLater = shiftCalendarDays(today, 3);
    const dayAfterThreeDays = shiftCalendarDays(today, 4);
    const thisMonthStart = firstOfMonth(today, 0);
    const nextMonthStart = firstOfMonth(today, 1);
    const monthAfterNextStart = firstOfMonth(today, 2);

    return {
        today,
        threeDaysLater,
        todayStart: dateOnlyStart(today),
        tomorrowStart: dateOnlyStart(tomorrow),
        threeDaysLaterEndExclusive: dateOnlyStart(dayAfterThreeDays),
        thisMonthStart: dateOnlyStart(thisMonthStart),
        nextMonthStart: dateOnlyStart(nextMonthStart),
        nextMonthEndExclusive: dateOnlyStart(monthAfterNextStart),
    };
}

export function clientListTabWhere(
    tab: Exclude<ClientListTab, "all">,
): Prisma.clientWhereInput {
    return { serviceStatus: tab };
}

export function buildClientListWhere(
    branchid: string,
    search?: string,
    tab: ClientListTab = "all",
): Prisma.clientWhereInput {
    const normalizedSearch = search?.trim();
    const where: Prisma.clientWhereInput = {
        branchId: branchid,
        ...(normalizedSearch
            ? {
                OR: [
                    { name: { contains: normalizedSearch, mode: "insensitive" as const } },
                    { address: { contains: normalizedSearch, mode: "insensitive" as const } },
                    { phone: { contains: normalizedSearch, mode: "insensitive" as const } },
                ],
            }
            : {}),
    };

    if (tab !== "all") {
        where.AND = [clientListTabWhere(tab)];
    }

    return where;
}

export interface InitialClientSchedule {
    primaryEmployeeId: number;
    secondaryEmployeeId: number | null;
    workAddress: string;
    startDate: Date;
    endDate: Date;
}

export interface ClientWithInitialSchedule {
    client: ClientEntity;
    scheduleId: number;
}

export interface IClientRepository {
    findById(branchid: string, id: number): Promise<ClientEntity | null>;
    /**
     * Lock one branch-owned client row for an approval-bound mutation or
     * external-effect staging operation. The lock and all work performed with
     * the returned entity must share the supplied transaction.
     */
    findByIdForUpdate(
        branchid: string,
        id: number,
        transaction: Prisma.TransactionClient,
    ): Promise<ClientEntity | null>;
    findAll(branchid: string): Promise<ClientEntity[]>;
    findAllPaginated(
        branchid: string,
        page: number,
        limit: number,
        search?: string,
        tab?: ClientListTab,
    ): Promise<PaginatedResult<ClientEntity>>;
    getListSummary?(branchid: string, search?: string): Promise<ClientListSummary>;
    create(branchid: string, client: ClientEntity, transaction?: Prisma.TransactionClient): Promise<ClientEntity>;
    createWithInitialSchedule(
        branchid: string,
        client: ClientEntity,
        schedule: InitialClientSchedule,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientWithInitialSchedule>;
    update(
        branchid: string,
        client: ClientEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity>;
    /**
     * Apply a date-derived status only when the branch-owned row still has the
     * status observed by the caller. A stale result is benign and must not be
     * retried with the stale value.
     */
    updateServiceStatusIfCurrent(
        branchid: string,
        id: number,
        expectedServiceStatus: string | null,
        newServiceStatus: ServiceStatusType,
    ): Promise<AutomaticServiceStatusUpdateResult>;
    /**
     * Compare the approval target while holding the row lock, then apply the
     * update before releasing that lock. A null result means the target version
     * no longer matches; callers must not fall back to an unlocked update.
     */
    updateIfTargetVersion(
        branchid: string,
        id: number,
        expectedTargetVersion: string,
        updates: Partial<{
            name: string;
            address: string | null;
            phone: string | null;
            type: string | null;
            duration: number | null;
            fullPrice: string | null;
            grant: string | null;
            actualPrice: string | null;
            startDate: Date | null;
            endDate: Date | null;
            careCenter: boolean | null;
            voucherClient: boolean;
            birthday: string | null;
            dueDate: Date | null;
            birthDate: Date | null;
            serviceStatus: string | null;
            breastPump: boolean;
            eDocId: string | null;
            areaId: string | null;
        }>,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity | null>;
    delete(branchid: string, id: number): Promise<void>;

    // Date-based queries for scheduler (P3)
    /**
     * Find clients whose service starts on a specific date
     * Used for contract reminders (3-day, 1-day before)
     */
    findByStartDate(branchid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients whose service ends on a specific date
     * Used for survey requests
     */
    findByEndDate(branchid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients created on a specific date (for payment reminders)
     * Used to send payment reminders X days after registration
     */
    findByCreatedDate(branchid: string, date: Date): Promise<ClientEntity[]>;

    /**
     * Find clients whose service starts within the next N days (inclusive)
     * Used for daily summary notifications
     */
    findStartingWithinDays(branchid: string, days: number): Promise<ClientEntity[]>;

    /**
     * Find clients whose service ends within the next N days (inclusive)
     * Used for daily summary notifications
     */
    findEndingWithinDays(branchid: string, days: number): Promise<ClientEntity[]>;

    /**
     * Find clients with incomplete contracts (eformsign doc not completed)
     * whose service starts within the next N days
     */
    findWithIncompleteContractsStartingWithinDays(
        branchid: string,
        days: number
    ): Promise<ClientEntity[]>;

    /**
     * Find clients without any contract sent (eDocId is null)
     * whose service starts within the next N days
     */
    findWithoutContractSentStartingWithinDays(
        branchid: string,
        days: number
    ): Promise<ClientEntity[]>;

    /**
     * Find a client in the branch whose phone, normalized to bare digits, equals
     * the given normalized phone. Used to dedupe (reuse existing) on create.
     */
    findByPhone(branchid: string, normalizedPhone: string): Promise<ClientEntity | null>;

    /**
     * Batch id -> name lookup for display purposes only (e.g. cross-referencing a
     * schedule row). Not filtered on any lifecycle state, so a historical row
     * still resolves a name.
     *
     * Required (not optional): `schedules.list` depends on it to resolve client
     * names, and an optional method here let a missing implementation degrade
     * silently to nulls with nothing failing. Every implementer (`SbClientRepository`,
     * `MockClientRepository`) already provides it.
     */
    findNamesByIds(branchid: string, ids: number[]): Promise<Array<{ id: number; name: string }>>;
}

export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";
