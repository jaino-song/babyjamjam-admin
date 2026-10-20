import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientEntity } from "domain/entities/client.entity";
import {
    ClientWithInitialSchedule,
    ClientPhoneMatch,
    AutomaticServiceStatusUpdateResult,
    IClientRepository,
    InitialClientSchedule,
    buildClientListWhere,
    ClientListSummary,
    ClientDeleteOutcome,
    ClientListTab,
    CLIENT_LIST_TAB_VALUES,
    clientListTabWhere,
    getClientCalendarDayRange,
    getClientDateWindow,
    getClientListDateRanges,
    getEffectiveClientServiceStatus,
    getKstDayInstantRange,
    PaginatedResult,
} from "domain/repositories/client.repository.interface";
import { SERVICE_STATUS } from "domain/value-objects/service-status.vo";
import { isoDateInKorea, type KrBusinessDayCalendar } from "domain/utils/business-days";
import {
    CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD,
    findLatestContractSignalsByClientId,
    isActiveContractSignal,
    isContractSendRequired,
    isIncompleteContractSignal,
} from "application/utils/current-contract-document";
import { configuredServiceRecordTemplateIds } from "application/utils/eformsign-document-kind";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import {
    hasColumn,
    type SchemaCapabilityClient,
} from "infrastructure/database/schema-capabilities";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";
import {
    isAutomaticServiceStatusTransitionAllowed,
    ServiceStatusType,
} from "domain/value-objects/service-status.vo";
import {
    CLIENT_RETENTION_BLOCKED,
    CLIENT_RETENTION_BLOCKED_MESSAGE,
    RetentionDeleteBlockedError,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";
import { ordinaryAutomationJobWhere } from "application/utils/message-automation-record-sql";
import type { Prisma } from "@prisma/client";

const CLIENT_DELETED_CANCEL_REASON = "고객 삭제";

const CHOSUNG_LIST = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ",
    "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
] as const;
const CHOSUNG_SET = new Set<string>(CHOSUNG_LIST);
const PHONE_LIKE_QUERY_PATTERN = /^\+?[\d\s().-]*\d[\d\s().-]*$/;

// The backend runtime vendor does not expose the frontend korean-search helper.
// Keep the parity fallback local and scan only branch-scoped candidate fields
// for query forms that PostgreSQL `contains` cannot represent.
function getChosungString(value: string): string {
    return Array.from(value.normalize("NFC"), (character) => {
        const code = character.charCodeAt(0);
        if (code >= 0xac00 && code <= 0xd7a3) {
            return CHOSUNG_LIST[Math.floor((code - 0xac00) / 588)] ?? character;
        }
        return character;
    }).join("");
}

function normalizePhoneLookupKey(value: string | null | undefined): string {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (!digits) return "";

    const nationalDigits = digits.startsWith("0082") ? digits.slice(2) : digits;
    if (!nationalDigits) return "";

    // Only a full international number (82 + 9-10 national digits) carries the
    // country code. A short digit query such as "8212" is part of a local
    // number, and rewriting it to "012" would match unrelated phones.
    if (nationalDigits.startsWith("82") && nationalDigits.length >= 11) {
        const domesticDigits = nationalDigits.slice(2);
        if (!domesticDigits) return "";
        return domesticDigits.startsWith("0") ? domesticDigits : `0${domesticDigits}`;
    }

    if (/^1\d{9}$/.test(nationalDigits)) return `0${nationalDigits}`;
    return nationalDigits;
}

function matchesKoreanSearch(target: string, query: string): boolean {
    const normalizedTarget = target.normalize("NFC").toLowerCase();
    const normalizedQuery = query.normalize("NFC").trim().toLowerCase();
    if (normalizedTarget.includes(normalizedQuery)) return true;
    if (!Array.from(normalizedQuery).some((character) => CHOSUNG_SET.has(character))) return false;

    return getChosungString(normalizedTarget).replace(/\s/g, "").startsWith(normalizedQuery);
}

function matchesClientSearch(
    query: string,
    values: readonly (string | null | undefined)[],
): boolean {
    const normalizedQuery = query.normalize("NFC").trim();
    if (!normalizedQuery) return true;

    const phoneQuery = PHONE_LIKE_QUERY_PATTERN.test(normalizedQuery)
        ? normalizePhoneLookupKey(normalizedQuery)
        : "";

    return values.some((value) => {
        if (value == null) return false;
        if (matchesKoreanSearch(value, normalizedQuery)) return true;
        return phoneQuery.length > 0 && normalizePhoneLookupKey(value).includes(phoneQuery);
    });
}

function requiresClientSearchFallback(search: string | undefined): boolean {
    if (search === undefined) return false;
    const normalizedQuery = search.normalize("NFC").trim();
    return Array.from(normalizedQuery).some((character) => CHOSUNG_SET.has(character))
        || PHONE_LIKE_QUERY_PATTERN.test(normalizedQuery);
}

@Injectable()
export class SbClientRepository implements IClientRepository {
    private readonly logger = new Logger(SbClientRepository.name);

    constructor(
        private readonly prismaService: PrismaService,
        @Optional() private readonly configService?: ConfigService,
    ) {}

    private async getClientSelect(capabilityClient: SchemaCapabilityClient = this.prismaService) {
        const supportsCreatedAt = await hasColumn(capabilityClient, "client", "created_at");
        const supportsAreaId = await hasColumn(capabilityClient, "client", "area_id");
        const supportsBirthDate = await hasColumn(capabilityClient, "client", "birth_date");

        return {
            id: true,
            name: true,
            address: true,
            phone: true,
            phoneNormalized: true,
            type: true,
            duration: true,
            fullPrice: true,
            grant: true,
            actualPrice: true,
            startDate: true,
            endDate: true,
            careCenter: true,
            voucherClient: true,
            birthday: true,
            dueDate: true,
            serviceStatus: true,
            bookingConfirmedAt: true,
            breastPump: true,
            eDocId: true,
            suppressGreetingSms: true,
            smsAutomationEnabled: true,
            // Tenant key — every where-clause already relies on this column,
            // and reads must carry it so ClientEntity.branchId is populated.
            branchId: true,
            ...(supportsCreatedAt ? { createdAt: true } : {}),
            ...(supportsAreaId ? { areaId: true } : {}),
            ...(supportsBirthDate ? { birthDate: true } : {}),
        } as const;
    }

    private async getClientCreateData(
        client: ClientEntity,
        capabilityClient: SchemaCapabilityClient = this.prismaService,
    ) {
        const { areaId, birthDate, ...rest } = ClientMapper.toPrismaCreate(client);
        const supportsAreaId = await hasColumn(capabilityClient, "client", "area_id");
        const supportsBirthDate = await hasColumn(capabilityClient, "client", "birth_date");

        return {
            ...rest,
            ...(supportsAreaId ? { areaId } : {}),
            ...(supportsBirthDate ? { birthDate } : {}),
        };
    }

    private async getClientUpdateData(
        client: ClientEntity,
        capabilityClient: SchemaCapabilityClient = this.prismaService,
    ) {
        const { areaId, birthDate, ...rest } = ClientMapper.toPrismaUpdate(client);
        const supportsAreaId = await hasColumn(capabilityClient, "client", "area_id");
        const supportsBirthDate = await hasColumn(capabilityClient, "client", "birth_date");

        return {
            ...rest,
            ...(supportsAreaId ? { areaId } : {}),
            ...(supportsBirthDate ? { birthDate } : {}),
        };
    }

    async findById(branchid: string, id: number): Promise<ClientEntity | null> {
        const select = await this.getClientSelect();
        const client = await this.prismaService.client.findFirst({
            where: { id, branchId: branchid, deletedAt: null },
            select,
        });
        return client ? ClientMapper.toDomain(client) : null;
    }

    async findByIdForUpdate(
        branchid: string,
        id: number,
        transaction: Prisma.TransactionClient,
    ): Promise<ClientEntity | null> {
        // The approval target is read only after PostgreSQL has acquired the
        // branch-scoped row lock. Callers must perform their comparison and
        // any mutation with this same transaction; an unlocked re-read is not
        // a substitute for this linearization point.
        await transaction.$queryRaw`
            SELECT "id"
            FROM "client"
            WHERE "id" = ${id} AND "branch_id" = ${branchid}::uuid AND "deleted_at" IS NULL
            FOR UPDATE
        `;
        const select = await this.getClientSelect(transaction);
        const client = await transaction.client.findFirst({
            where: { id, branchId: branchid, deletedAt: null },
            select,
        });
        return client ? ClientMapper.toDomain(client as any) : null;
    }

    async findAll(branchid: string): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const clients = await this.prismaService.client.findMany({
            where: { branchId: branchid, deletedAt: null },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findNamesByIds(branchid: string, ids: number[]): Promise<Array<{ id: number; name: string }>> {
        if (ids.length === 0) return [];
        return this.prismaService.client.findMany({
            where: { branchId: branchid, id: { in: ids } },
            select: { id: true, name: true },
        });
    }

    private async findSpecialSearchClientIds(branchid: string, search: string): Promise<number[]> {
        // This candidate scan is intentionally complete for the authorized
        // branch so pagination cannot hide a later Korean/phone match.
        const candidates = await this.prismaService.client.findMany({
            where: { branchId: branchid, deletedAt: null },
            select: {
                id: true,
                name: true,
                address: true,
                phone: true,
                phoneNormalized: true,
            },
        });

        return candidates
            .filter((candidate) => matchesClientSearch(search, [
                candidate.name,
                candidate.phone,
                candidate.phoneNormalized,
                candidate.address,
            ]))
            .map((candidate) => candidate.id);
    }

    private withClientIds(where: Prisma.clientWhereInput, ids: number[]): Prisma.clientWhereInput {
        const existingAnd = Array.isArray(where.AND)
            ? where.AND
            : where.AND
                ? [where.AND]
                : [];
        return {
            ...where,
            AND: [...existingAnd, { id: { in: ids } }],
        };
    }

    async findAllPaginated(
        branchid: string,
        page: number,
        limit: number,
        search?: string,
        tab: ClientListTab = "all",
    ): Promise<PaginatedResult<ClientEntity>> {
        const skip = (page - 1) * limit;
        const ranges = getClientListDateRanges();
        const specialSearch = search !== undefined && requiresClientSearchFallback(search);
        const matchingIds = specialSearch
            ? await this.findSpecialSearchClientIds(branchid, search)
            : undefined;
        const baseWhere = buildClientListWhere(
            branchid,
            specialSearch ? undefined : search,
            tab,
            ranges.todayStart,
        );
        const where = matchingIds === undefined ? baseWhere : this.withClientIds(baseWhere, matchingIds);

        try {
            const select = await this.getClientSelect();
            const [clients, total] = await Promise.all([
                this.prismaService.client.findMany({
                    where,
                    skip,
                    take: limit,
                    orderBy: { id: 'desc' },
                    select,
                }),
                this.prismaService.client.count({ where }),
            ]);

            return {
                data: clients.map((client) => ClientMapper.toDomain(client as any)),
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            };
        } catch (error) {
            console.error('[ClientRepository] findAllPaginated error:', error);
            throw error;
        }
    }

    async getListSummary(branchid: string, search?: string): Promise<ClientListSummary> {
        const ranges = getClientListDateRanges();
        const specialSearch = search !== undefined && requiresClientSearchFallback(search);
        const matchingIds = specialSearch
            ? await this.findSpecialSearchClientIds(branchid, search)
            : undefined;
        const baseWhereWithoutSearch = buildClientListWhere(
            branchid,
            undefined,
            "all",
            ranges.todayStart,
        );
        const baseWhere = matchingIds === undefined
            ? buildClientListWhere(branchid, search, "all", ranges.todayStart)
            : this.withClientIds(baseWhereWithoutSearch, matchingIds);
        const whereForTab = (tab: ClientListTab): Prisma.clientWhereInput => {
            const withoutSearch = buildClientListWhere(
                branchid,
                undefined,
                tab,
                ranges.todayStart,
            );
            return matchingIds === undefined
                ? buildClientListWhere(branchid, search, tab, ranges.todayStart)
                : this.withClientIds(withoutSearch, matchingIds);
        };
        const withPredicate = (predicate: Prisma.clientWhereInput): Prisma.clientWhereInput => {
            const existingAnd = Array.isArray(baseWhere.AND)
                ? baseWhere.AND
                : baseWhere.AND
                    ? [baseWhere.AND]
                    : [];
            return {
                ...baseWhere,
                AND: [...existingAnd, predicate],
            };
        };

        const [total, tabCounts, thisMonth, nextMonth, serviceEnd] = await Promise.all([
            this.prismaService.client.count({ where: baseWhere }),
            Promise.all(
                CLIENT_LIST_TAB_VALUES.map(async (tab) => [
                    tab,
                    await this.prismaService.client.count({
                        where: tab === "all" ? baseWhere : whereForTab(tab),
                    }),
                ] as const),
            ),
            this.prismaService.client.count({
                where: withPredicate({
                    dueDate: {
                        gte: ranges.thisMonthStart,
                        lt: ranges.nextMonthStart,
                    },
                }),
            }),
            this.prismaService.client.count({
                where: withPredicate({
                    dueDate: {
                        gte: ranges.nextMonthStart,
                        lt: ranges.nextMonthEndExclusive,
                    },
                }),
            }),
            this.prismaService.client.count({
                where: withPredicate({
                    AND: [
                        clientListTabWhere(SERVICE_STATUS.ACTIVE, ranges.todayStart),
                        {
                            endDate: {
                                gte: ranges.todayStart,
                                lt: ranges.threeDaysLaterEndExclusive,
                            },
                        },
                    ],
                }),
            }),
        ]);

        const byTab = Object.fromEntries(tabCounts) as Record<ClientListTab, number>;
        return {
            total,
            byTab,
            dueDate: {
                thisMonth,
                nextMonth,
            },
            serviceEnd: {
                count: serviceEnd,
                from: ranges.today,
                to: ranges.threeDaysLater,
            },
        };
    }

    async create(branchid: string, client: ClientEntity, transaction?: Prisma.TransactionClient): Promise<ClientEntity> {
        const queryClient = transaction ?? this.prismaService;
        const select = await this.getClientSelect(queryClient);
        const data = await this.getClientCreateData(client, queryClient);
        const created = await queryClient.client.create({
            data: {
                ...data,
                branchId: branchid,
            },
            select,
        });
        return ClientMapper.toDomain(created as any);
    }

    async createWithInitialSchedule(
        branchid: string,
        client: ClientEntity,
        schedule: InitialClientSchedule,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientWithInitialSchedule> {
        const queryClient = transaction ?? this.prismaService;
        const select = await this.getClientSelect(queryClient);
        const data = await this.getClientCreateData(client, queryClient);
        const created = await queryClient.client.create({
            data: {
                ...data,
                branchId: branchid,
                employeeSchedules: {
                    create: {
                        branchId: branchid,
                        primaryEmployeeId: schedule.primaryEmployeeId,
                        secondaryEmployeeId: schedule.secondaryEmployeeId,
                        workAddress: schedule.workAddress,
                        startDate: schedule.startDate,
                        endDate: schedule.endDate,
                        replaced: false,
                    },
                },
            },
            select: {
                ...select,
                employeeSchedules: {
                    select: { id: true },
                    orderBy: { id: "desc" },
                    take: 1,
                },
            },
        });
        const scheduleId = created.employeeSchedules[0]?.id;
        if (scheduleId === undefined) {
            throw new Error("Initial employee schedule was not created");
        }

        return {
            client: ClientMapper.toDomain(created),
            scheduleId,
        };
    }

    async update(
        branchid: string,
        client: ClientEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity> {
        const db = transaction ?? this.prismaService;
        const select = await this.getClientSelect(db);
        const data = await this.getClientUpdateData(client, db);
        const result = await db.client.updateMany({
            where: { id: client.id, branchId: branchid, deletedAt: null },
            data,
        });
        if (result.count === 0) {
            throw new Error("Client not found for branch");
        }
        const updated = await db.client.findFirst({
            where: { id: client.id, branchId: branchid },
            select,
        });
        if (!updated) {
            throw new Error("Client not found after update");
        }
        return ClientMapper.toDomain(updated as any);
    }

    async updateServiceStatusIfCurrent(
        branchid: string,
        id: number,
        expectedServiceStatus: string | null,
        newServiceStatus: ServiceStatusType,
    ): Promise<AutomaticServiceStatusUpdateResult> {
        if (!isAutomaticServiceStatusTransitionAllowed(expectedServiceStatus, newServiceStatus)) {
            return "stale";
        }

        const result = await this.prismaService.client.updateMany({
            where: {
                id,
                branchId: branchid,
                serviceStatus: expectedServiceStatus,
            },
            data: { serviceStatus: newServiceStatus },
        });

        return result.count === 1 ? "updated" : "stale";
    }

    async updateIfTargetVersion(
        branchid: string,
        id: number,
        expectedTargetVersion: string,
        updates: Parameters<IClientRepository["updateIfTargetVersion"]>[3],
        calendar: KrBusinessDayCalendar,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity | null> {
        const apply = async (tx: Prisma.TransactionClient): Promise<ClientEntity | null> => {
            const current = await this.findByIdForUpdate(branchid, id, tx);
            if (!current || clientAgentTargetVersion(current) !== expectedTargetVersion) {
                return null;
            }

            current.update(updates, calendar);
            const data = await this.getClientUpdateData(current, tx);
            const updated = await tx.client.updateMany({
                where: { id, branchId: branchid, deletedAt: null },
                data,
            });
            if (updated.count !== 1) return null;

            const select = await this.getClientSelect(tx);
            const row = await tx.client.findFirst({
                where: { id, branchId: branchid },
                select,
            });
            return row ? ClientMapper.toDomain(row as any) : null;
        };

        return transaction ? apply(transaction) : this.prismaService.$transaction(apply);
    }

    async delete(branchid: string, id: number): Promise<ClientDeleteOutcome> {
        return this.prismaService.$transaction(async (transaction): Promise<ClientDeleteOutcome> => {
            // The lock is the linearization point for this destructive action.
            // Every dependency check and the delete itself must use this same
            // transaction so a concurrent child insert cannot race the guard.
            const lockedRows = await transaction.$queryRaw<Array<{ id: number }>>`
                SELECT "id"
                FROM "client"
                WHERE "id" = ${id} AND "branch_id" = ${branchid}::uuid AND "deleted_at" IS NULL
                FOR UPDATE
            `;
            if (lockedRows.length === 0) {
                throw new ScopedDeleteNotFoundError("client", id);
            }

            const dependencyRows = await transaction.$queryRaw<Array<{ count: number }>>`
                SELECT COUNT(*)::int AS "count"
                FROM (
                    SELECT 1 FROM "employee_schedule"
                    WHERE "client_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "service_record_case"
                    WHERE "client_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "eformsign_doc"
                    WHERE "client_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "eformsign_doc"
                    WHERE "document_id" = (
                        SELECT "e_doc_id"
                        FROM "client"
                        WHERE "id" = ${id} AND "branch_id" = ${branchid}::uuid
                    )
                    UNION ALL
                    SELECT 1 FROM "eformsign_document_job"
                    WHERE "client_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "call_record"
                    WHERE "matched_client_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "client_draft"
                    WHERE "client_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "schedule_change_request"
                    WHERE "client_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "message_trigger_job"
                    WHERE "client_id" = ${id}
                    UNION ALL
                    SELECT 1 FROM "message_log"
                    WHERE "client_id" = ${id}
                ) AS "dependencies"
            `;

            if (Number(dependencyRows[0]?.count ?? 0) > 0) {
                // Fail closed: the tombstone is written only when the switch is exactly
                // "true". Otherwise the row is left untouched and the delete is refused
                // before any assignment is ended or any job is canceled.
                if (!this.isTombstoneDeleteEnabled()) {
                    throw new RetentionDeleteBlockedError(CLIENT_RETENTION_BLOCKED, CLIENT_RETENTION_BLOCKED_MESSAGE);
                }
                await this.tombstoneLockedClient(transaction, branchid, id);
                return "tombstoned";
            }

            const result = await transaction.client.deleteMany({
                where: { id, branchId: branchid },
            });
            if (result.count !== 1) {
                throw new ScopedDeleteNotFoundError("client", id);
            }
            return "deleted";
        });
    }

    /**
     * CLIENT_TOMBSTONE_DELETE_ENABLED stays off until production main runs a build that
     * reads `client.deleted_at`; an older build would revive the canceled jobs of a
     * tombstoned client. Only the exact string "true" enables it. Read per call.
     */
    private isTombstoneDeleteEnabled(): boolean {
        const raw = this.configService
            ? this.configService.get<string>("CLIENT_TOMBSTONE_DELETE_ENABLED")
            : process.env["CLIENT_TOMBSTONE_DELETE_ENABLED"];
        return raw === "true";
    }

    /**
     * 고객-06: a client with retained history keeps its row as a tombstone instead of
     * being refused. Runs inside the delete transaction, after the row lock.
     *  - `deletedAt` hides the row from every list, search and lookup;
     *  - `phoneNormalized` is cleared so the branch-unique phone key is free for a new
     *    client and the tombstone drops out of phone matching (the raw `phone` stays);
     *  - open assignments end exactly as `terminateService` ends them, so the employees
     *    are no longer held by a client nobody can see;
     *  - pending automatic messages are canceled with the same predicate as
     *    `cancelPendingByClientContext`, which cannot join this transaction.
     */
    private async tombstoneLockedClient(
        transaction: Prisma.TransactionClient,
        branchid: string,
        id: number,
    ): Promise<void> {
        const now = new Date();
        const tombstoned = await transaction.client.updateMany({
            where: { id, branchId: branchid, deletedAt: null },
            data: { deletedAt: now, phoneNormalized: null },
        });
        if (tombstoned.count !== 1) {
            throw new ScopedDeleteNotFoundError("client", id);
        }

        await transaction.employee_schedule.updateMany({
            where: { clientId: id, branchId: branchid, replaced: false, terminatedAt: null },
            data: { terminatedAt: now },
        });

        // Source: SbMessageTriggerJobRepository.cancelPendingByClientContext.
        await transaction.message_trigger_job.updateMany({
            where: {
                ...ordinaryAutomationJobWhere(),
                branchId: branchid,
                status: { in: ["pending", "processing", "needs_setup"] },
                OR: [
                    { clientId: id },
                    { employeeSchedule: { is: { clientId: id } } },
                ],
            },
            data: {
                status: "canceled",
                canceledAt: now,
                cancelReason: CLIENT_DELETED_CANCEL_REASON,
                claimToken: null,
            },
        });
    }

    async findByStartDate(branchid: string, date: Date): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        // start_date is a date-only column (UTC-midnight values): compare the Korean calendar day.
        const { dayStart, nextDayStart } = getClientCalendarDayRange(date);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                startDate: {
                    gte: dayStart,
                    lt: nextDayStart,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findByEndDate(branchid: string, date: Date): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const { dayStart, nextDayStart } = getClientCalendarDayRange(date);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                endDate: {
                    gte: dayStart,
                    lt: nextDayStart,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findByCreatedDate(branchid: string, date: Date): Promise<ClientEntity[]> {
        const supportsCreatedAt = await hasColumn(this.prismaService, "client", "created_at");
        if (!supportsCreatedAt) {
            return [];
        }

        const select = await this.getClientSelect();
        // created_at is a timestamp: the Korean calendar day is KST midnight to KST midnight.
        const { start, endExclusive } = getKstDayInstantRange(date);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                createdAt: {
                    gte: start,
                    lt: endExclusive,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findStartingWithinDays(
        branchid: string,
        days: number,
        now: Date = new Date(),
    ): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const { start, endExclusive } = getClientDateWindow(days, now);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                startDate: {
                    gte: start,
                    lt: endExclusive,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findEndingWithinDays(
        branchid: string,
        days: number,
        now: Date = new Date(),
    ): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const { start, endExclusive } = getClientDateWindow(days, now);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                endDate: {
                    gte: start,
                    lt: endExclusive,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    /**
     * Bounded query + in-memory rule: the database narrows to the clients starting inside the
     * (small) Korean-calendar window, and the "current contract is alive but not completed"
     * rule runs over those rows. Prisma cannot express it because the current contract is the
     * newest non-service-record `eformsign_doc` per client, not the `eDocId` pin.
     */
    async findWithIncompleteContractsStartingWithinDays(
        branchid: string,
        days: number,
        now: Date = new Date(),
    ): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const { start, endExclusive } = getClientDateWindow(days, now);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                startDate: {
                    gte: start,
                    lt: endExclusive,
                },
            },
            select,
        });

        const latestContracts = await findLatestContractSignalsByClientId(
            this.prismaService,
            configuredServiceRecordTemplateIds(this.configService),
            clients.map((client) => client.id),
        );
        return clients
            .filter((client) => isIncompleteContractSignal(latestContracts.get(client.id)))
            .map((client) => ClientMapper.toDomain(client as any));
    }

    /**
     * Bounded query + in-memory rule. The in-memory pass re-runs the dashboard's complete rule
     * (`isContractSendRequired` over the effective service status and the current contract), so
     * the database predicate only has to be a SUPERSET of it:
     *  - `startDate < addBusinessDays(today, threshold + 1)`: a start inside the business-day
     *    send window is exactly any date before the business day just past it (the same bound
     *    `getActionRequiredAlerts` uses); a null start never matches;
     *  - confirmed and not a stored manual terminated status, and `endDate >= today` (a finished
     *    service is effectively completed), except 교체 요청 which keeps its stored status.
     * That leaves the branch's currently running or upcoming clients starting before the window
     * end, which is bounded by the branch's live clients rather than its whole history.
     */
    async findWithoutContractSentStartingWithinDays(
        branchid: string,
        calendar: KrBusinessDayCalendar,
        now: Date = new Date(),
    ): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const { todayStart } = getClientListDateRanges(now);

        // The lookahead is only an optimisation. When its horizon runs past the supported
        // holiday years (late December), fall back to the same superset WITHOUT the start bound:
        // the per-client rule below still decides, and a client it cannot judge is skipped by
        // its own calendar guard. Never answer "none" just because the horizon is unsupported.
        let startDateBound: Prisma.clientWhereInput["startDate"] = { not: null };
        try {
            startDateBound = {
                lt: new Date(
                    `${calendar.addBusinessDays(isoDateInKorea(now), CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD + 1)}T00:00:00.000Z`,
                ),
            };
        } catch (error) {
            this.logger.warn(
                `Contract-send lookahead for branch ${branchid} is outside the supported holiday calendar range; scanning without the start-date bound (${error instanceof Error ? error.message : String(error)})`,
            );
        }

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                startDate: startDateBound,
                OR: [
                    { serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED },
                    {
                        AND: [
                            {
                                OR: [
                                    { serviceStatus: null },
                                    {
                                        serviceStatus: {
                                            notIn: [
                                                SERVICE_STATUS.TERMINATED,
                                                SERVICE_STATUS.REPLACEMENT_REQUESTED,
                                            ],
                                        },
                                    },
                                ],
                            },
                            { bookingConfirmedAt: { not: null } },
                            { endDate: { gte: todayStart } },
                        ],
                    },
                ],
            },
            select,
        });

        const latestContracts = await findLatestContractSignalsByClientId(
            this.prismaService,
            configuredServiceRecordTemplateIds(this.configService),
            clients.map((client) => client.id),
        );

        const skippedClientIds: number[] = [];
        const needingSend = clients.filter((client) =>
            isContractSendRequired(
                {
                    clientId: client.id,
                    now,
                    serviceStatus: getEffectiveClientServiceStatus(
                        client.serviceStatus ?? null,
                        client.startDate ?? null,
                        client.endDate ?? null,
                        client.bookingConfirmedAt,
                        now,
                    ),
                    startDate: client.startDate ?? null,
                    hasActiveContractDocument: isActiveContractSignal(latestContracts.get(client.id)),
                },
                calendar,
                (clientId) => {
                    if (clientId !== undefined) skippedClientIds.push(clientId);
                },
            ),
        );
        if (skippedClientIds.length > 0) {
            this.logger.warn(
                `Skipped ${skippedClientIds.length} client(s) from the contract-send check, a date is outside the supported holiday calendar range: client ids ${skippedClientIds.slice(0, 20).join(", ")}`,
            );
        }
        return needingSend.map((client) => ClientMapper.toDomain(client as any));
    }

    async findPhoneMatches(branchId: string, phoneSuffixes: string[]): Promise<ClientPhoneMatch[]> {
        if (phoneSuffixes.length === 0) return [];
        return this.prismaService.client.findMany({
            where: {
                branchId,
                deletedAt: null,
                OR: [...new Set(phoneSuffixes)].map(suffix => ({ phone: { endsWith: suffix } })),
            },
            select: { id: true, branchId: true, name: true, phone: true, birthday: true },
        });
    }

    async findByPhone(branchid: string, normalizedPhone: string): Promise<ClientEntity | null> {
        const client = await this.prismaService.client.findFirst({
            where: { branchId: branchid, phoneNormalized: normalizedPhone, deletedAt: null },
        });
        return client ? ClientMapper.toDomain(client as any) : null;
    }
}
