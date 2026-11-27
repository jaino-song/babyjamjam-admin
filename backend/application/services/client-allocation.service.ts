import { readBackfilledScalarHousehold } from "application/policies/baby-record-provenance.policy";
import {
    admitVoucherCode,
    resolveBabyRecordAllocation,
    type BabyRecordAllocationIssue,
    type BabyRecordAssignmentInput,
    type FetalType,
    type FetalTypeConfirmation,
    type ProviderSlot,
} from "@babyjamjam/shared/client/baby-record-allocation";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { problemBody } from "application/utils/problem-bodies";
import { createHash } from "node:crypto";
import type { AdminAuditEventWriter } from "./admin-audit-event.service";
import type { ServiceRecordAdminActor } from "./admin-service-record.service";
import { resolveServiceRecordCaseTarget, type ServiceRecordCaseTarget } from "./service-record-case-target";
import { RECORD_LINK_GROUP_CHANGED, recordLinkGroupCarrierEvidence } from "./service-record-link-group-source";
import { IMMUTABLE_FINALIZATION_STATUSES } from "./service-record-lifecycle.service";
import { hasConflictingUnboundCaseHistory } from "./service-record-token.service";
import { legacyRecordBindingConflict, type LockedLegacyRecordBinding } from "./client-legacy-record-binding";

export type AuditedLegacyRecordBinding = LockedLegacyRecordBinding & {
    actor: ServiceRecordAdminActor;
    audit: AdminAuditEventWriter;
};

export interface ClientAllocationInput {
    fetalType?: FetalType;
    babyCount?: number;
    providers?: Provider[];
    babyAssignments?: RequestedAssignment[];
    voucherIssuanceYear?: number;
    expectedAllocationVersion?: string;
}

interface Provider {
    slot: ProviderSlot;
    employeeId: number;
}

interface RequestedAssignment {
    babyId?: string;
    ordinal?: number;
    providerSlot: ProviderSlot | null;
}

interface Baby {
    babyId: string;
    ordinal: number;
}

export interface ClientAllocationProjection {
    fetalType: FetalType | null;
    fetalConfirmation: FetalTypeConfirmation;
    babyCount: number;
    babies: Baby[];
    historicalMaxOrdinal: number;
    providers: Provider[];
    babyAssignments: (Baby & { providerSlot: ProviderSlot | null })[];
    allocationVersion: string;
}

const snapshotSelect = {
    id: true,
    branchId: true,
    type: true,
    voucherClient: true,
    fetalType: true,
    fetalConfirmation: true,
    babies: { select: { id: true, ordinal: true, active: true }, orderBy: { ordinal: "asc" } },
    employeeSchedules: {
        where: { replaced: false, terminatedAt: null },
        orderBy: { id: "desc" },
        take: 1,
        select: {
            id: true,
            incarnationId: true,
            primaryEmployeeId: true,
            secondaryEmployeeId: true,
            startDate: true,
            endDate: true,
            recordTeamSlots: {
                where: { active: true },
                select: { id: true, slot: true, employeeId: true, legacyBackfilled: true },
                orderBy: { slot: "asc" },
            },
            recordBabyAssignments: {
                where: { activeOwner: true },
                select: { babyId: true, id: true, teamSlotId: true },
                orderBy: { babyId: "asc" },
            },
        },
    },
} satisfies Prisma.clientSelect;

export type ClientAllocationSnapshot = Prisma.clientGetPayload<{ select: typeof snapshotSelect }>;

export async function loadClientAllocations(
    db: Prisma.TransactionClient,
    branchId: string,
    clientIds: number[],
): Promise<Map<number, ClientAllocationSnapshot>> {
    if (!db.client_baby || clientIds.length === 0) return new Map();
    const rows = await db.client.findMany({
        where: { id: { in: clientIds }, branchId, deletedAt: null },
        select: {
            ...snapshotSelect,
            babies: { ...snapshotSelect.babies, where: { branchId } },
            employeeSchedules: {
                ...snapshotSelect.employeeSchedules,
                where: { ...snapshotSelect.employeeSchedules.where, branchId },
            },
        },
    });
    return new Map(rows.map((row) => [row.id, row]));
}

export function allocationProjection(snapshot: ClientAllocationSnapshot): ClientAllocationProjection {
    const schedule = snapshot.employeeSchedules[0];
    const slots = schedule?.recordTeamSlots ?? [];
    const owners = new Map(schedule?.recordBabyAssignments.map((row) => [row.babyId, row.teamSlotId]));
    const slotNumbers = new Map(slots.map((row) => [row.id, row.slot as ProviderSlot]));
    const babies = snapshot.babies.filter((row) => row.active)
        .map(({ id, ordinal }) => ({ babyId: id, ordinal }));
    const providers: Provider[] = slots.filter((row) => row.slot > 1)
        .map(({ slot, employeeId }) => ({ slot: slot as ProviderSlot, employeeId }));
    if (schedule) {
        providers.unshift({ slot: 0, employeeId: schedule.primaryEmployeeId });
        if (schedule.secondaryEmployeeId !== null) {
            providers.splice(1, 0, { slot: 1, employeeId: schedule.secondaryEmployeeId });
        }
    }
    // First allocation (including a signed legacy binding) must reject a
    // stale period or schedule incarnation. Keep existing configured versions.
    const versionSource = snapshot.fetalConfirmation !== "CONFIRMED"
        ? snapshot
        : {
            ...snapshot,
            employeeSchedules: snapshot.employeeSchedules.map(({ id, primaryEmployeeId, secondaryEmployeeId, recordTeamSlots, recordBabyAssignments }) =>
                ({ id, primaryEmployeeId, secondaryEmployeeId, recordTeamSlots, recordBabyAssignments })),
        };
    return {
        fetalType: snapshot.fetalType,
        fetalConfirmation: snapshot.fetalConfirmation ?? "UNCONFIRMED",
        babyCount: babies.length,
        babies,
        historicalMaxOrdinal: snapshot.babies.at(-1)?.ordinal ?? 0,
        providers,
        babyAssignments: babies.map((baby) => ({
            ...baby,
            providerSlot: slotNumbers.get(owners.get(baby.babyId) ?? "") ?? null,
        })),
        allocationVersion: createHash("sha256").update(JSON.stringify(versionSource)).digest("base64url"),
    };
}

export function assertAllocationStaffInput(
    input: ClientAllocationInput & { primaryEmployeeId?: number | null; secondaryEmployeeId?: number | null },
): void {
    if (input.providers !== undefined && (input.primaryEmployeeId !== undefined || input.secondaryEmployeeId !== undefined)) {
        invalid("/providers");
    }
}

export function hasAllocationInput(input: ClientAllocationInput): boolean {
    return input.fetalType !== undefined || input.babyCount !== undefined
        || input.providers !== undefined || input.babyAssignments !== undefined
        || input.voucherIssuanceYear !== undefined || input.expectedAllocationVersion !== undefined;
}

function invalid(pointer: string, code: "INVALID_VALUE" | "REQUIRED" = "INVALID_VALUE"): never {
    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
        pointer, code, detail: "배정 정보를 확인해 주세요.", location: "body",
    }));
}

export function allocationConflict(pointer: string): never {
    throw new ConflictException(problemBody("REQUEST_CONFLICT", {
        pointer, code: "INVALID_VALUE", detail: "현재 아기 및 담당자 배정을 확인해 주세요.", location: "body",
    }));
}

function rejectIssue(issue: BabyRecordAllocationIssue, assignments: RequestedAssignment[]): never {
    switch (issue.field) {
        case "voucher":
            return invalid(
                ["missing-year", "invalid-year", "missing-catalog"].includes(issue.code) ? "/voucherIssuanceYear" : "/type",
                issue.code === "missing-year" || issue.code === "missing-code" ? "REQUIRED" : "INVALID_VALUE",
            );
        case "providers":
            return invalid(`/providers/${issue.index}/${["disabled-slot", "duplicate-slot"].includes(issue.code) ? "slot" : "employeeId"}`);
        case "babyAssignments": {
            const key = ["unavailable-slot", "fixed-primary"].includes(issue.code)
                ? "providerSlot" : assignments[issue.index]?.babyId === undefined ? "ordinal" : "babyId";
            return invalid(`/babyAssignments/${issue.index}/${key}`);
        }
        case "fetalType":
            return invalid("/fetalType", issue.code === "required" ? "REQUIRED" : "INVALID_VALUE");
        default:
            return invalid("/babyCount");
    }
}

export interface ClientAllocationPlan {
    fetalType: FetalType;
    providers: Provider[];
    assignments: { babyId: string | null; ordinal: number; providerSlot: ProviderSlot | null }[];
    retired: string[];
    unchanged: boolean;
    adoptBackfilledSlots?: boolean;
    legacyContinuity?: boolean;
}

const maxPrismaInt = 2_147_483_647;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function validateInput(input: ClientAllocationInput): asserts input is Required<Omit<ClientAllocationInput, "expectedAllocationVersion">> & ClientAllocationInput {
    for (const key of ["fetalType", "babyCount", "providers", "babyAssignments", "voucherIssuanceYear"] as const) {
        if (input[key] == null) invalid(`/${key}`, "REQUIRED");
    }
    if (!Number.isSafeInteger(input.babyCount) || input.babyCount! < 1 || input.babyCount! > maxPrismaInt) {
        invalid("/babyCount");
    }
    if (!Number.isSafeInteger(input.voucherIssuanceYear) || input.voucherIssuanceYear! < 1 || input.voucherIssuanceYear! > maxPrismaInt) {
        invalid("/voucherIssuanceYear");
    }
    if (!Array.isArray(input.providers)) invalid("/providers");
    if (!Array.isArray(input.babyAssignments)) invalid("/babyAssignments");
    if (input.babyAssignments.length !== input.babyCount) invalid("/babyCount");
    for (const [index, provider] of input.providers.entries()) {
        if (!provider || ![0, 1, 2, 3].includes(provider.slot)) invalid(`/providers/${index}/slot`);
        if (!Number.isSafeInteger(provider.employeeId) || provider.employeeId < 1 || provider.employeeId > maxPrismaInt) {
            invalid(`/providers/${index}/employeeId`, provider.employeeId == null ? "REQUIRED" : "INVALID_VALUE");
        }
    }
    if (input.providers.length && !input.providers.some(({ slot }) => slot === 0)) {
        invalid("/providers/0/slot");
    }
    for (const [index, row] of input.babyAssignments.entries()) {
        const pointer = `/babyAssignments/${index}`;
        if (!row) invalid(pointer);
        if (row.babyId !== undefined && (typeof row.babyId !== "string" || !uuid.test(row.babyId))) invalid(`${pointer}/babyId`);
        if (row.ordinal !== undefined && (!Number.isSafeInteger(row.ordinal) || row.ordinal < 1 || row.ordinal > maxPrismaInt)) invalid(`${pointer}/ordinal`);
        if (row.babyId === undefined && row.ordinal === undefined) invalid(`${pointer}/ordinal`, "REQUIRED");
        if (row.babyId !== undefined && row.ordinal !== undefined) invalid(`${pointer}/ordinal`);
        if (row.providerSlot === undefined) invalid(`${pointer}/providerSlot`, "REQUIRED");
        if (row.providerSlot === null ? input.providers.length > 0 : ![0, 1, 2, 3].includes(row.providerSlot)) {
            invalid(`${pointer}/providerSlot`);
        }
    }
}

async function assertBabiesCanRetire(
    tx: Prisma.TransactionClient,
    scope: { branchId: string; clientId: number },
    retired: string[],
): Promise<void> {
    const authoredFields = [
        { momName: { not: null } }, { momBirth: { not: null } },
        { babyName: { not: null } }, { babyBirth: { not: null } },
        { deliveryType: { not: null } }, { babyWeight: { not: null } },
    ];
    const retiringCases = { ...scope, babyId: { in: retired } };
    const authored = await tx.service_record_case.findFirst({
        where: {
            ...retiringCases,
            OR: [
                ...authoredFields,
                { legacyHeaders: { some: { OR: authoredFields } } },
                { days: { some: {} } }, { dayEditLogs: { some: {} } },
                { eformsignDocs: { some: {} } }, { snapshotChunks: { some: {} } },
                { editDrafts: { some: {} } }, { revisions: { some: {} } }, { revisionDocumentStates: { some: {} } },
                { currentRevisionId: { not: null } }, { currentUsableRevisionId: { not: null } },
                { currentUsableDocumentVersion: { not: null } }, { plannedSessions: { not: Prisma.DbNull } },
                { completedAt: { not: null } }, { finalizedAt: { not: null } },
                { finalizationStartedAt: { not: null } }, { documentsCompletedAt: { not: null } },
                { status: { in: [...IMMUTABLE_FINALIZATION_STATUSES] } },
            ],
        },
        select: { id: true },
    });
    if (authored) allocationConflict("/babyCount");

    // Archived days retain authored data after their live rows are removed.
    const cases = await tx.service_record_case.findMany({ where: retiringCases, select: { id: true } });
    if (cases.length && await tx.service_record_day_archive.findFirst({
        where: { ...scope, serviceRecordCaseId: { in: cases.map(({ id }) => id) } },
        select: { id: true },
    })) allocationConflict("/babyCount");
}

export async function planClientAllocation(
    tx: Prisma.TransactionClient,
    input: ClientAllocationInput,
    voucher: { voucherClient: boolean; type: string | null },
    current?: ClientAllocationSnapshot,
): Promise<ClientAllocationPlan> {
    validateInput(input);
    if (!voucher.voucherClient) invalid("/type");
    const projection = current && allocationProjection(current);
    if (projection && (typeof input.expectedAllocationVersion !== "string" || !input.expectedAllocationVersion)) {
        invalid("/expectedAllocationVersion", input.expectedAllocationVersion == null ? "REQUIRED" : "INVALID_VALUE");
    }
    const stale = projection && input.expectedAllocationVersion !== projection.allocationVersion;
    const activeByOrdinal = new Map(projection?.babies.map((baby) => [baby.ordinal, baby]));
    const known = new Set(projection?.babies.map((baby) => baby.babyId));
    const requested = input.babyAssignments.map((row) => {
        if (row.babyId !== undefined) return { babyId: row.babyId.toLowerCase(), providerSlot: row.providerSlot };
        // A retried addition still uses its allocated ordinal. Only a stale request
        // can use it, and only an identical final configuration will be accepted.
        const existing = stale && row.ordinal !== undefined && activeByOrdinal.get(row.ordinal);
        return existing
            ? { babyId: existing.babyId, providerSlot: row.providerSlot }
            : { ordinal: row.ordinal!, providerSlot: row.providerSlot };
    });
    const retained = new Set<string>();
    const targets = new Set<string | number>();
    for (const [index, row] of requested.entries()) {
        const target = row.babyId ?? row.ordinal!;
        const pointer = `/babyAssignments/${index}/${row.babyId === undefined ? "ordinal" : "babyId"}`;
        if (row.babyId !== undefined) {
            if (!known.has(row.babyId)) {
                if (stale) allocationConflict("/expectedAllocationVersion");
                invalid(pointer);
            }
            retained.add(row.babyId);
        }
        if (targets.has(target)) invalid(pointer);
        targets.add(target);
    }
    const babies = projection?.babies.filter((baby) => retained.has(baby.babyId)) ?? [];
    const historicalMaxOrdinal = projection?.historicalMaxOrdinal ?? 0;
    const forms = await tx.voucher_price_info.findMany({
        where: { year: input.voucherIssuanceYear },
        select: { type: true },
        distinct: ["type"],
    });
    const catalog = forms.length ? { [input.voucherIssuanceYear]: forms.flatMap(({ type }) => type ?? []) } : {};
    const rules = resolveBabyRecordAllocation({
        service: "voucher",
        mode: "submission",
        code: voucher.type,
        issuanceYear: input.voucherIssuanceYear,
        catalog,
        fetalType: input.fetalType,
        babyCount: input.babyCount,
        providers: input.providers,
        babies,
        historicalMaxOrdinal,
        babyAssignments: requested.flatMap((row): BabyRecordAssignmentInput[] => {
            if (row.providerSlot === null) return [];
            return [row.babyId === undefined
                ? { ordinal: row.ordinal!, providerSlot: row.providerSlot }
                : { babyId: row.babyId, providerSlot: row.providerSlot }];
        }),
    });
    if (rules.status !== "resolved") {
        if (stale) allocationConflict("/expectedAllocationVersion");
        if (rules.status === "not-applicable") invalid("/type");
        rejectIssue(rules.issue, requested);
    }
    for (const [index, row] of requested.entries()) {
        if (row.ordinal !== undefined && !rules.assignmentFor(row.ordinal)) {
            if (stale) allocationConflict("/expectedAllocationVersion");
            invalid(`/babyAssignments/${index}/ordinal`);
        }
    }
    if (historicalMaxOrdinal + input.babyCount - babies.length > maxPrismaInt) invalid("/babyCount");
    const assignments = requested.map((_, index) => {
        const { babyId, ordinal, providerSlot } = rules.assignmentAtRank(index + 1)!;
        return { babyId, ordinal, providerSlot };
    });
    const providers = [...input.providers].sort((left, right) => left.slot - right.slot);
    const adoptBackfilledSlots = current?.employeeSchedules[0]?.recordTeamSlots.some(slot => slot.legacyBackfilled) ?? false;
    const unchanged = !adoptBackfilledSlots && projection?.fetalConfirmation === "CONFIRMED"
        && projection.fetalType === rules.fetalType
        && current?.type === voucher.type
        && sameProviders(providers, projection.providers)
        && assignments.length === projection.babyCount
        && assignments.every((row, index) => {
            const previous = projection.babyAssignments[index]!;
            return row.babyId === previous.babyId && row.providerSlot === previous.providerSlot;
        });
    if (stale && !unchanged) allocationConflict("/expectedAllocationVersion");
    const retired = projection?.babies.filter((baby) => !retained.has(baby.babyId)).map((baby) => baby.babyId) ?? [];
    return { fetalType: rules.fetalType, assignments, providers, retired, unchanged, adoptBackfilledSlots };
}

export function sameProviders(left: Provider[], right: Provider[]): boolean {
    return left.length === right.length && left.every((row, index) =>
        row.slot === right[index]?.slot && row.employeeId === right[index]?.employeeId);
}

export async function planLegacyClientAllocation(
    tx: Prisma.TransactionClient,
    snapshot: ClientAllocationSnapshot | undefined,
    request: {
        type?: string | null;
        voucherClient?: boolean;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        primaryPointer?: string;
        secondaryPointer?: string;
    },
    persistHistoricalAllocation = false,
): Promise<ClientAllocationPlan | null> {
    if (!snapshot) return null;
    const projection = allocationProjection(snapshot);
    if (projection.fetalConfirmation !== "CONFIRMED" || !projection.fetalType) return null;
    const primaryPointer = request.primaryPointer ?? "/primaryEmployeeId";
    const secondaryPointer = request.secondaryPointer ?? "/secondaryEmployeeId";
    const providers = projection.providers.filter(({ slot }) =>
        slot === 0 ? request.primaryEmployeeId === undefined : slot !== 1 || request.secondaryEmployeeId === undefined);
    if (request.primaryEmployeeId !== undefined) providers.push({ slot: 0, employeeId: request.primaryEmployeeId });
    if (request.secondaryEmployeeId != null) providers.push({ slot: 1, employeeId: request.secondaryEmployeeId });
    providers.sort((left, right) => left.slot - right.slot);
    const occupied = new Set<number>();
    for (const provider of providers) {
        if (occupied.has(provider.employeeId)) {
            allocationConflict(request.secondaryEmployeeId === provider.employeeId ? secondaryPointer : primaryPointer);
        }
        occupied.add(provider.employeeId);
    }
    if (providers.length && providers[0]?.slot !== 0) allocationConflict(secondaryPointer);
    const type = request.type === undefined ? snapshot.type : request.type;
    if (!(request.voucherClient ?? snapshot.voucherClient) || type === null) allocationConflict("/type");
    // The legacy payload does not carry an issuance year. Use an actual catalog
    // year admitting the unchanged or replacement code, without guessing a year
    // from service dates or modifying price storage.
    const prices = await tx.voucher_price_info.findMany({
        select: { year: true, type: true },
        distinct: ["year", "type"],
        orderBy: { year: "desc" },
    });
    const price = prices.find((row) => row.type && admitVoucherCode(type, row.year, { [row.year]: [row.type] }).admitted);
    if (!price?.type) allocationConflict("/type");
    const assignments = projection.babyAssignments.map((row) => {
        if (row.providerSlot !== null && !providers.some(({ slot }) => slot === row.providerSlot)) allocationConflict(secondaryPointer);
        return row;
    });
    const rules = resolveBabyRecordAllocation({
        service: "voucher", mode: "legacy", confirmation: "CONFIRMED",
        code: type, issuanceYear: price.year, catalog: { [price.year]: [price.type] },
        fetalType: projection.fetalType, babyCount: projection.babyCount,
        babies: projection.babies, historicalMaxOrdinal: projection.historicalMaxOrdinal, providers,
        babyAssignments: assignments.flatMap(({ babyId, providerSlot }) => providerSlot === null ? [] : [{ babyId, providerSlot }]),
    });
    if (rules.status !== "resolved") {
        if (rules.status === "unconfirmed" && rules.issue.field === "providers" && request.type === undefined) {
            allocationConflict(providers[rules.issue.index]?.slot === 0 ? primaryPointer : secondaryPointer);
        }
        allocationConflict("/type");
    }
    const legacyContinuity = rules.fetalType === "SINGLETON" && snapshot.branchId !== null
        && !!await readBackfilledScalarHousehold(tx, { branchId: snapshot.branchId, clientId: snapshot.id });
    // Standalone schedule creation retains its scalar validations. Its service
    // carries forward the original assignment after those validations succeed.
    if (legacyContinuity && !persistHistoricalAllocation) return null;
    return {
        fetalType: rules.fetalType, providers, retired: [],
        unchanged: sameProviders(providers, projection.providers),
        legacyContinuity,
        assignments: assignments.map((row) => ({
            ...row, providerSlot: rules.assignmentFor(row.ordinal)!.providerSlot,
        })),
    };
}

export async function persistClientAllocation(
    tx: Prisma.TransactionClient,
    scope: { branchId: string; clientId: number },
    plan: ClientAllocationPlan,
    scheduleId: number | null,
    previousScheduleId: number | null = scheduleId,
    legacyBinding?: AuditedLegacyRecordBinding,
): Promise<void> {
    if (legacyBinding && (plan.unchanged || scheduleId === null || scheduleId !== previousScheduleId)) {
        legacyRecordBindingConflict("schedule");
    }
    if (plan.unchanged && previousScheduleId === scheduleId) return;
    const newRows = plan.assignments.filter(({ babyId }) => babyId === null);
    if (previousScheduleId !== null || plan.retired.length) await lockCredentialCases(tx, scope);
    const previousOwners = previousScheduleId === null ? [] : await readCredentialOwners(tx, scope, previousScheduleId);
    const previousSingleton = previousScheduleId !== null && previousOwners.length <= 1
        ? await resolveServiceRecordCaseTarget(tx, scope) : null;
    const firstAllocation = previousSingleton?.kind === "resolved" && previousSingleton.babyId === null
        && previousSingleton.babyCount === null && previousOwners.length === 0
        && !await tx.service_record_baby_assignment.findFirst({ where: scope, select: { id: true } });
    if (plan.retired.length) {
        await assertBabiesCanRetire(tx, scope, plan.retired);
        await revokeRetiredBabyCredentials(tx, scope, plan.retired);
        // The database's conditional foreign key requires owners to close
        // before retiring a baby, including an owner from an older schedule.
        await tx.service_record_baby_assignment.updateMany({
            where: { ...scope, babyId: { in: plan.retired }, activeOwner: true },
            data: { activeOwner: null, endedAt: new Date() },
        });
        await tx.client_baby.updateMany({
            where: { ...scope, id: { in: plan.retired }, active: true }, data: { active: false },
        });
    }
    const inserted = newRows.length ? await tx.client_baby.createManyAndReturn({
        data: newRows.map(({ ordinal }) => ({ ...scope, ordinal })),
        select: { id: true, ordinal: true },
    }) : [];
    const insertedByOrdinal = new Map(inserted.map(({ id, ordinal }) => [ordinal, id]));
    await tx.client.updateMany({
        where: { id: scope.clientId, branchId: scope.branchId },
        data: { fetalType: plan.fetalType, fetalConfirmation: "CONFIRMED" },
    });

    if (previousScheduleId !== null && previousScheduleId !== scheduleId) {
        await endScheduleOwners(tx, scope, previousScheduleId);
    }
    if (scheduleId === null) {
        if (previousScheduleId !== null) await revokeScheduleCredentials(tx, scope, previousScheduleId);
        return;
    }
    const scheduleScope = { ...scope, scheduleId };
    const slots = await tx.service_record_team_slot.findMany({ where: { ...scheduleScope, active: true } });
    const slotChanges = slots.filter((old) => (plan.adoptBackfilledSlots && old.legacyBackfilled) || !plan.providers.some(
        ({ slot, employeeId }) => old.slot === slot && old.employeeId === employeeId,
    ));
    const retiredSlotIds = new Set(slotChanges.map(({ id }) => id));
    const desired = new Map(plan.assignments.map((row) => [row.babyId ?? insertedByOrdinal.get(row.ordinal)!, row.providerSlot]));
    const history = await tx.service_record_baby_assignment.findMany({
        where: scheduleScope, orderBy: { version: "desc" },
        select: { id: true, babyId: true, teamSlotId: true, activeOwner: true, version: true },
    });
    const slotById = new Map(slots.map((row) => [row.id, row.slot]));
    const changed = history.filter((row) => row.activeOwner === true && (
        retiredSlotIds.has(row.teamSlotId) || desired.get(row.babyId) !== slotById.get(row.teamSlotId)
    ));
    if (changed.length) await tx.service_record_baby_assignment.updateMany({
        where: { ...scheduleScope, id: { in: changed.map(({ id }) => id) }, activeOwner: true },
        data: { activeOwner: null, endedAt: new Date() },
    });
    if (slotChanges.length) await tx.service_record_team_slot.updateMany({
        where: { ...scheduleScope, id: { in: [...retiredSlotIds] }, active: true }, data: { active: false },
    });
    const kept = slots.filter(({ id }) => !retiredSlotIds.has(id));
    const toInsert = plan.providers.filter(({ slot }) => !kept.some((row) => row.slot === slot));
    const created = toInsert.length ? await tx.service_record_team_slot.createManyAndReturn({
        data: toInsert.map((provider) => ({ ...scheduleScope, ...provider, ...(plan.legacyContinuity ? { legacyBackfilled: true } : {}) })),
    }) : [];
    const bySlot = new Map([...kept, ...created].map((row) => [row.slot, row]));
    const closed = new Set(changed.map(({ id }) => id));
    const existingOwners = new Set(history.filter((row) => row.activeOwner && !closed.has(row.id)).map(({ babyId }) => babyId));
    const versions = new Map(history.slice().reverse().map((row) => [row.babyId, row.version]));
    const newOwners = [...desired].flatMap(([babyId, slot]) => {
        if (slot === null || existingOwners.has(babyId)) return [];
        const owner = bySlot.get(slot)!;
        return [{
            ...scheduleScope, babyId, teamSlotId: owner.id, employeeId: owner.employeeId,
            version: (versions.get(babyId) ?? 0) + 1,
            ...(plan.legacyContinuity ? { legacyBackfilled: true } : {}),
        }];
    });
    if (newOwners.length) {
        await tx.service_record_baby_assignment.createMany({ data: newOwners });
    }

    if (legacyBinding) {
        const babyId = insertedByOrdinal.get(legacyBinding.babyOrdinal);
        if (!babyId) legacyRecordBindingConflict("allocation");
        const now = new Date();
        const tokenScope = { branchId: scope.branchId, scheduleId, schedule: scope };
        const stillActive = await tx.service_record_token.findFirst({
            where: { ...tokenScope, id: legacyBinding.tokenId, serviceRecordCaseId: legacyBinding.caseId,
                active: true, revokedAt: null, expiresAt: { gt: now } },
            select: { id: true },
        });
        if (!stillActive) legacyRecordBindingConflict("link");
        const bound = await tx.service_record_case.updateMany({
            where: { ...scope, id: legacyBinding.caseId, babyId: null },
            data: { babyId, version: { increment: 1 } },
        });
        if (bound.count !== 1) legacyRecordBindingConflict("case");
        // The proven row is already scoped to the original case and remains
        // byte-for-byte intact, including its verified session and lockout.
        await revokeCredentials(tx, { ...tokenScope, id: { not: legacyBinding.tokenId } }, now);
        await legacyBinding.audit.appendInTransaction(tx, {
            action: "service_record.legacy_case_adopt",
            targetType: "service_record_case",
            targetId: legacyBinding.caseId,
            branchId: scope.branchId,
            actor: legacyBinding.actor,
            after: { clientId: scope.clientId, babyId },
            outcome: "success",
        });
        return;
    }

    if (previousScheduleId !== null) {
        const currentOwners = await readCredentialOwners(tx, scope, scheduleId);
        await reconcileCaseCredentials(tx, scope, previousScheduleId, scheduleId, previousOwners, currentOwners, {
            target: previousSingleton, firstAllocation,
        });
    }
}

type AllocationScope = { branchId: string; clientId: number };

async function lockCredentialCases(tx: Prisma.TransactionClient, { branchId, clientId }: AllocationScope) {
    if (typeof tx.$queryRaw !== "function") return;
    // Callers hold the client lock. The finalizer locks its case before
    // changing tokens, and lifecycle sync may still update these cases later
    // in this transaction. Take all of the affected client's case locks first.
    await tx.$queryRaw(Prisma.sql`
        SELECT id FROM service_record_case
        WHERE branch_id = ${branchId}::uuid AND client_id = ${clientId}
        ORDER BY id FOR UPDATE
    `);
}

function readCredentialOwners(tx: Prisma.TransactionClient, scope: AllocationScope, scheduleId: number) {
    return tx.service_record_baby_assignment.findMany({
        where: { ...scope, scheduleId, activeOwner: true, endedAt: null, teamSlot: { active: true } },
        select: { babyId: true, employeeId: true, employee: { select: { phone: true, deletedAt: true } } },
    });
}

type CredentialOwner = Awaited<ReturnType<typeof readCredentialOwners>>[number];

function revokeCredentials(tx: Prisma.TransactionClient, where: Prisma.service_record_tokenWhereInput, now: Date) {
    return tx.service_record_token.updateMany({
        where: { ...where, revokedAt: null },
        data: { active: false, revokedAt: now, accessTokenHash: null, verifiedAt: null },
    });
}

async function revokeRetiredBabyCredentials(tx: Prisma.TransactionClient, scope: AllocationScope, retired: string[]) {
    const now = new Date();
    await revokeCredentials(tx, {
        branchId: scope.branchId,
        schedule: scope,
        OR: [
            { serviceRecordCase: { ...scope, babyId: { in: retired } } },
            // A legacy unscoped token must never gain access to the surviving case.
            { serviceRecordCaseId: null },
        ],
    }, now);
    await tx.message_trigger_job.updateMany({
        where: {
            ...scope,
            recordMembers: { some: { ...scope, babyId: { in: retired } } },
            status: { in: ["pending", "processing", "needs_setup", "dispatching"] },
            canceledByUser: false, logs: { none: recordLinkGroupCarrierEvidence },
        },
        data: {
            status: "canceled", cancelReason: RECORD_LINK_GROUP_CHANGED, canceledAt: now,
            claimToken: null, nextAttemptAt: null, processingDeadlineAt: null,
        },
    });
}

async function reconcileCaseCredentials(
    tx: Prisma.TransactionClient,
    scope: AllocationScope,
    previousScheduleId: number,
    scheduleId: number,
    previousOwners: CredentialOwner[],
    currentOwners: CredentialOwner[],
    previous: { target: ServiceRecordCaseTarget | null; firstAllocation: boolean },
): Promise<void> {
    const handover = previousScheduleId !== scheduleId;
    const now = new Date();
    const tokenScope = { branchId: scope.branchId, scheduleId: previousScheduleId, schedule: scope };
    const formerOwners = new Map(previousOwners.map((owner) => [owner.babyId, owner]));
    const nextOwners = new Map(currentOwners.map((owner) => [owner.babyId, owner]));
    const cases = await tx.service_record_case.findMany({
        where: { ...scope, OR: [{ babyId: { in: [...formerOwners.keys()] } }, { babyId: null }] },
        select: { id: true, babyId: true, finalizedAt: true },
        orderBy: { id: "asc" },
    });
    const legacyCaseId = previous.target?.kind === "resolved" ? previous.target.caseId : null;
    const singleton = legacyCaseId ? await resolveServiceRecordCaseTarget(tx, scope) : null;

    for (const record of cases) {
        if (!record.babyId) continue;
        const former = formerOwners.get(record.babyId);
        const next = nextOwners.get(record.babyId);
        const retained = former && next?.employeeId === former.employeeId && !next.employee.deletedAt;
        const allowLegacy = previousOwners.length === 1 && record.id === legacyCaseId && singleton
            && singleton.kind === "resolved" && singleton.caseId === record.id;
        const caseScope = {
            ...tokenScope,
            OR: [{ serviceRecordCaseId: record.id }, ...(allowLegacy ? [{ serviceRecordCaseId: null }] : [])],
        };
        if (!retained) {
            await revokeCredentials(tx, caseScope, now);
        } else if (handover && !record.finalizedAt) {
            if (!(next.employee.phone ?? "").replace(/\D/g, "")) continue;
            // Shift only still-valid credentials before the existing post-commit
            // old-schedule revoke runs. The token and its verified session stay intact.
            await tx.service_record_token.updateMany({
                where: {
                    ...caseScope, employeeId: next.employeeId, active: true,
                    revokedAt: null, expiresAt: { gt: now },
                },
                data: { scheduleId, serviceRecordCaseId: record.id },
            });
        }
    }

    const unbound = cases.filter(({ babyId }) => babyId === null);
    if (unbound.length > 0) {
        const [record] = unbound;
        const [former] = previousOwners;
        const [next] = currentOwners;
        const sameUnboundCase = unbound.length === 1 && record && !record.finalizedAt
            && previous.target?.kind === "resolved" && previous.target.babyId === null && previous.target.caseId === record.id
            && singleton?.kind === "resolved" && singleton.caseId === record.id && singleton.babyCount === 1;
        const sameOwner = previous.target?.kind === "resolved" && previous.target.babyCount === 1
            && former && next && former.babyId === next.babyId && former.employeeId === next.employeeId;
        const owner = sameUnboundCase && currentOwners.length === 1 && next && next.employee.deletedAt === null
            && (previous.firstAllocation || sameOwner)
            ? await readContinuingUnboundOwner(tx, scope, previousScheduleId, scheduleId, next)
            : null;
        const unboundScope = {
            ...tokenScope,
            OR: [{ serviceRecordCaseId: { in: unbound.map(({ id }) => id) } }, { serviceRecordCaseId: null }],
        };
        if (owner && handover) {
            // Move the original credential row, including its challenge and verified session.
            await tx.service_record_token.updateMany({
                where: {
                    ...unboundScope, employeeId: owner.employeeId, active: true,
                    revokedAt: null, expiresAt: { gt: new Date() }, expectedPhoneHash: owner.phoneHash,
                    employee: { branchId: scope.branchId, deletedAt: null, phone: owner.phone },
                },
                data: { scheduleId },
            });
        } else if (!owner && !handover) {
            // Stamp the old generation even when a later allocation could restore its owner.
            await revokeCredentials(tx, unboundScope, now);
        }
    }

    if (handover) {
        await revokeCredentials(tx, tokenScope, now);
    } else if (previousOwners.length > 0 && currentOwners.length > 1) {
        // An unscoped singleton credential cannot become usable again if this
        // household later returns to one baby.
        await revokeCredentials(tx, { ...tokenScope, serviceRecordCaseId: null }, now);
    }
}

async function readContinuingUnboundOwner(
    tx: Prisma.TransactionClient,
    scope: AllocationScope,
    previousScheduleId: number,
    scheduleId: number,
    { babyId, employeeId, employee: { phone } }: CredentialOwner,
) {
    const normalizedPhone = (phone ?? "").replace(/\D/g, "");
    if (!normalizedPhone) return null;
    const current = await tx.employee_schedule.findFirst({
        where: { ...scope, replaced: false, terminatedAt: null, client: { branchId: scope.branchId, deletedAt: null } },
        orderBy: { id: "desc" },
        select: { id: true, primaryEmployeeId: true, client: { select: { serviceStatus: true } } },
    });
    if (current?.id !== scheduleId || current.primaryEmployeeId !== employeeId
        || current.client.serviceStatus === "terminated") return null;
    if (previousScheduleId !== scheduleId) {
        const outgoing = await tx.employee_schedule.findFirst({
            where: { ...scope, id: previousScheduleId, replaced: true, terminatedAt: null },
            select: { primaryEmployeeId: true },
        });
        if (outgoing?.primaryEmployeeId !== employeeId) return null;
    }
    if (await hasConflictingUnboundCaseHistory(tx, { ...scope, scheduleId, employeeId, babyId })) return null;
    return { employeeId, phone, phoneHash: createHash("sha256").update(normalizedPhone).digest("hex") };
}

async function endScheduleOwners(tx: Prisma.TransactionClient, scope: AllocationScope, scheduleId: number) {
    await tx.service_record_baby_assignment.updateMany({
        where: { ...scope, scheduleId, activeOwner: true },
        data: { activeOwner: null, endedAt: new Date() },
    });
}

async function revokeScheduleCredentials(tx: Prisma.TransactionClient, scope: AllocationScope, scheduleId: number) {
    await revokeCredentials(tx, { branchId: scope.branchId, scheduleId, schedule: scope }, new Date());
}

export async function closeScheduleAllocation(
    tx: Prisma.TransactionClient,
    scope: AllocationScope,
    scheduleId: number,
): Promise<void> {
    await lockCredentialCases(tx, scope);
    if (tx.service_record_baby_assignment) await endScheduleOwners(tx, scope, scheduleId);
    if (tx.service_record_token) await revokeScheduleCredentials(tx, scope, scheduleId);
}
