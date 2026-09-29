import { Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import {
    ClientWithInitialSchedule,
    AutomaticServiceStatusUpdateResult,
    IClientRepository,
    InitialClientSchedule,
    buildClientListWhere,
    ClientListSummary,
    ClientListTab,
    CLIENT_LIST_TAB_VALUES,
    clientListTabWhere,
    getClientListDateRanges,
    PaginatedResult,
} from "domain/repositories/client.repository.interface";
import { SERVICE_STATUS } from "domain/value-objects/service-status.vo";
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
import type { Prisma } from "@prisma/client";

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
    constructor(private readonly prismaService: PrismaService) {}

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
            breastPump: true,
            eDocId: true,
            suppressGreetingSms: true,
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
            where: { id, branchId: branchid },
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
            WHERE "id" = ${id} AND "branch_id" = ${branchid}::uuid
            FOR UPDATE
        `;
        const select = await this.getClientSelect(transaction);
        const client = await transaction.client.findFirst({
            where: { id, branchId: branchid },
            select,
        });
        return client ? ClientMapper.toDomain(client as any) : null;
    }

    async findAll(branchid: string): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const clients = await this.prismaService.client.findMany({
            where: { branchId: branchid },
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
            where: { branchId: branchid },
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
            where: { id: client.id, branchId: branchid },
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
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity | null> {
        const apply = async (tx: Prisma.TransactionClient): Promise<ClientEntity | null> => {
            const current = await this.findByIdForUpdate(branchid, id, tx);
            if (!current || clientAgentTargetVersion(current) !== expectedTargetVersion) {
                return null;
            }

            current.update(updates);
            const data = await this.getClientUpdateData(current, tx);
            const updated = await tx.client.updateMany({
                where: { id, branchId: branchid },
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

    async delete(branchid: string, id: number): Promise<void> {
        await this.prismaService.$transaction(async (transaction) => {
            // The lock is the linearization point for this destructive action.
            // Every dependency check and the delete itself must use this same
            // transaction so a concurrent child insert cannot race the guard.
            const lockedRows = await transaction.$queryRaw<Array<{ id: number }>>`
                SELECT "id"
                FROM "client"
                WHERE "id" = ${id} AND "branch_id" = ${branchid}::uuid
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
                throw new RetentionDeleteBlockedError(
                    CLIENT_RETENTION_BLOCKED,
                    CLIENT_RETENTION_BLOCKED_MESSAGE,
                );
            }

            const result = await transaction.client.deleteMany({
                where: { id, branchId: branchid },
            });
            if (result.count !== 1) {
                throw new ScopedDeleteNotFoundError("client", id);
            }
        });
    }

    async findByStartDate(branchid: string, date: Date): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        // Normalize to start of day for date comparison
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                startDate: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findByEndDate(branchid: string, date: Date): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        // Normalize to start of day for date comparison
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                endDate: {
                    gte: startOfDay,
                    lte: endOfDay,
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
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                createdAt: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findStartingWithinDays(branchid: string, days: number): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                startDate: {
                    gte: today,
                    lte: endDate,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findEndingWithinDays(branchid: string, days: number): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                endDate: {
                    gte: today,
                    lte: endDate,
                },
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findWithIncompleteContractsStartingWithinDays(
        branchid: string,
        days: number
    ): Promise<ClientEntity[]> {
        const baseSelect = await this.getClientSelect();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                startDate: {
                    gte: today,
                    lte: endDate,
                },
                eDocId: { not: null },
                eformsignDocByEDocId: {
                    statusType: { not: '050' },
                },
            },
            select: {
                ...baseSelect,
                eformsignDocByEDocId: {
                    select: {
                        documentId: true,
                        statusType: true,
                    },
                },
            },
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findWithoutContractSentStartingWithinDays(
        branchid: string,
        days: number
    ): Promise<ClientEntity[]> {
        const select = await this.getClientSelect();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const endDate = new Date(today);
        endDate.setDate(endDate.getDate() + days);
        endDate.setHours(23, 59, 59, 999);

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                startDate: {
                    gte: today,
                    lte: endDate,
                },
                eDocId: null,
            },
            select,
        });
        return clients.map((client) => ClientMapper.toDomain(client as any));
    }

    async findByPhone(branchid: string, normalizedPhone: string): Promise<ClientEntity | null> {
        const client = await this.prismaService.client.findFirst({
            where: { branchId: branchid, phoneNormalized: normalizedPhone },
        });
        return client ? ClientMapper.toDomain(client as any) : null;
    }
}
