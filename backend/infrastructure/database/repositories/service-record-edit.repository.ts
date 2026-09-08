import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
    ServiceRecordEditConflictError,
    ServiceRecordEditDraftConflictError,
    ServiceRecordEditNotFoundError,
} from "domain/errors/service-record-edit.error";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import {
    type AppendServiceRecordRevisionInput,
    type ServiceRecordEditConfirmInput,
    type ServiceRecordEditConfirmPlan,
    type ServiceRecordEditConfirmNewSession,
    type ServiceRecordEditConfirmSnapshot,
    type CreateServiceRecordEditDraftInput,
    type DiscardServiceRecordEditDraftInput,
    type IServiceRecordEditRepository,
    type ServiceRecordEditDraft,
    type ServiceRecordEditJsonValue,
    type ServiceRecordEditSource,
    type ServiceRecordEditSourceAssignment,
    type ServiceRecordEditSourceDay,
    type ServiceRecordRevision,
    type ServiceRecordRevisionDocumentState,
    type CreateServiceRecordRevisionDocumentStateInput,
    type AdvanceServiceRecordRevisionDocumentStateInput,
    type RetryServiceRecordRevisionDocumentInput,
    type ServiceRecordEditTransactionContext,
    type UpdateServiceRecordEditDraftInput,
} from "domain/repositories/service-record-edit.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import {
    persistClientMessageAutomationIntent,
    persistScheduleMessageAutomationIntent,
} from "application/services/message-automation-intent-writer";
import {
    SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS,
    SERVICE_RECORD_REVISION_DOCUMENT_STATUSES,
} from "@babyjamjam/shared/types/service-record";
import type {
    ServiceRecordEditContractStage,
    ServiceRecordEditDocumentChunk,
    ServiceRecordEditDocumentScope,
    ServiceRecordEditSignatureMetadata,
    ServiceRecordEditConfirmResponse,
    ServiceRecordRevisionDispatchContext,
    ServiceRecordRevisionDocumentOperation,
    ServiceRecordRevisionDocumentStatus,
    ServiceRecordRevisionHistoryResponse,
} from "@babyjamjam/shared/types/service-record";

type DraftRow = Prisma.service_record_edit_draftGetPayload<Record<string, never>>;
type RevisionRow = Prisma.service_record_revisionGetPayload<Record<string, never>>;
type RevisionClient = Prisma.TransactionClient;
type DraftClient = Pick<PrismaService, "service_record_edit_draft">;
type DraftLockClient = DraftClient & Pick<PrismaService, "$queryRaw">;

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code === "P2002"
        : typeof error === "object"
            && error !== null
            && "code" in error
            && (error as { code?: unknown }).code === "P2002";
}

function toPrismaJson(value: ServiceRecordEditJsonValue): Prisma.InputJsonValue {
    // The editor contract stores JSON objects/arrays. The cast keeps the port
    // Prisma-free while allowing the adapter to pass its recursive value type
    // to Prisma's generated input type.
    return value as unknown as Prisma.InputJsonValue;
}

function toDomainJson(value: Prisma.JsonValue): ServiceRecordEditJsonValue {
    if (value === null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((item) => toDomainJson(item));
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
            if (item === undefined) throw new Error("Unexpected undefined JSON value");
            return [key, toDomainJson(item)];
        }),
    );
}

function signatureMetadata(
    sessions: Array<Omit<ServiceRecordEditSourceDay, "ambiguous">>,
): ServiceRecordEditSignatureMetadata {
    return {
        treatment: "preserve_existing",
        evidence: "observed",
        sessions: sessions
            .map((session) => ({
                sessionIndex: session.sessionIndex,
                hasSignature: Boolean(session.clientSignature),
                signedAt: session.clientSignedAt,
                submittedAt: session.submittedAt,
            }))
            .sort((left, right) => left.sessionIndex - right.sessionIndex),
    };
}

type DocumentScopeRecord = {
    id: string;
    formVersion: number;
    currentRevisionId: string | null;
    currentUsableRevisionId: string | null;
    currentUsableDocumentVersion: number | null;
};

type DocumentScopeClient = {
    id: number;
    eDocId: string | null;
};

type DocumentScopeRow = {
    documentId: string;
    documentKind: string | null;
    statusType: string;
    clientId: number | null;
    serviceRecordCaseId: string | null;
    employeeScheduleId: number | null;
    snapshotVersion: number | null;
    snapshotChunkIndex: number | null;
    stepName: string;
    updatedDate: Date;
    createdDate: Date;
};

function contractStage(document: DocumentScopeRow): Exclude<ServiceRecordEditContractStage, null> {
    const status = normalizeEformsignStatusCode(document.statusType);
    if (["003", "012", "022", "032", "050", "062", "072", "092"].includes(status)) {
        return "completed";
    }
    if (["011", "021", "031", "040", "042", "045", "047", "049", "061", "071", "080"].includes(status)) {
        return "rejected";
    }
    if (["001", "002", "010", "020", "030", "043", "060", "063", "064", "070"].includes(status)) {
        return "in_progress";
    }
    return "unknown";
}

type RevisionScopeRow = {
    id: string;
    revisionNumber: number;
    formVersionAtConfirm: number;
};

function unverifiedDocumentScope(formVersion: number | null): ServiceRecordEditDocumentScope {
    return {
        evidence: "unverified",
        serviceRecordSnapshot: {
            documentIds: [],
            snapshotVersion: null,
            chunks: [],
        },
        currentRevision: {
            id: null,
            revisionNumber: null,
            formVersion: null,
        },
        form: { version: formVersion },
        contract: {
            currentDocumentId: null,
            stage: null,
        },
    };
}

async function loadDocumentScope(
    tx: Prisma.TransactionClient,
    branchId: string,
    record: DocumentScopeRecord,
    client: DocumentScopeClient,
    scheduleIds: number[],
): Promise<ServiceRecordEditDocumentScope> {
    const fallback = unverifiedDocumentScope(record.formVersion);
    const documentDelegate = tx.eformsign_doc;
    const revisionDelegate = tx.service_record_revision;
    if (
        typeof documentDelegate?.findMany !== "function"
        || typeof revisionDelegate?.findMany !== "function"
    ) {
        return fallback;
    }

    let documents: DocumentScopeRow[];
    let revisions: RevisionScopeRow[];
    try {
        [documents, revisions] = await Promise.all([
            documentDelegate.findMany({
                where: {
                    branchId,
                    OR: [
                        { documentKind: "service_record_snapshot", serviceRecordCaseId: record.id },
                        ...(scheduleIds.length > 0
                            ? [{ documentKind: "service_record_snapshot", employeeScheduleId: { in: scheduleIds } }]
                            : []),
                        { documentKind: "contract", clientId: client.id },
                    ],
                },
                select: {
                    documentId: true,
                    documentKind: true,
                    statusType: true,
                    clientId: true,
                    serviceRecordCaseId: true,
                    employeeScheduleId: true,
                    snapshotVersion: true,
                    snapshotChunkIndex: true,
                    stepName: true,
                    updatedDate: true,
                    createdDate: true,
                },
                orderBy: [
                    { updatedDate: "desc" },
                    { createdDate: "desc" },
                    { documentId: "asc" },
                ],
            }) as Promise<DocumentScopeRow[]>,
            revisionDelegate.findMany({
                where: {
                    branchId,
                    serviceRecordCaseId: record.id,
                    ...(record.currentRevisionId || record.currentUsableRevisionId
                        ? { id: { in: [record.currentRevisionId, record.currentUsableRevisionId].filter((id): id is string => id !== null) } }
                        : { id: { in: [] } }),
                },
                select: {
                    id: true,
                    revisionNumber: true,
                    formVersionAtConfirm: true,
                },
            }) as Promise<RevisionScopeRow[]>,
        ]);
    } catch {
        return fallback;
    }

    const snapshots = documents.filter((document) => (
        document.documentKind === "service_record_snapshot"
        && (
            document.serviceRecordCaseId === record.id
            || (document.employeeScheduleId !== null && scheduleIds.includes(document.employeeScheduleId))
        )
    ));
    const snapshotChunks: ServiceRecordEditDocumentChunk[] = snapshots
        .map((document) => ({
            documentId: document.documentId,
            snapshotVersion: document.snapshotVersion,
            snapshotChunkIndex: document.snapshotChunkIndex,
        }))
        .sort((left, right) => (
            (left.snapshotVersion ?? 0) - (right.snapshotVersion ?? 0)
            || (left.snapshotChunkIndex ?? 0) - (right.snapshotChunkIndex ?? 0)
            || left.documentId.localeCompare(right.documentId)
        ));
    const snapshotVersions = snapshots
        .map((document) => document.snapshotVersion)
        .filter((version): version is number => Number.isInteger(version));
    const currentRevision = revisions.find((revision) => revision.id === record.currentRevisionId)
        ?? revisions.find((revision) => revision.id === record.currentUsableRevisionId);
    const contractDocs = documents.filter((document) => (
        document.documentKind === "contract" && document.clientId === client.id
    ));
    const exactContract = client.eDocId
        ? contractDocs.find((document) => document.documentId === client.eDocId)
        : undefined;
    const currentContract = exactContract ?? (client.eDocId == null && contractDocs.length === 1 ? contractDocs[0] : undefined);
    const contractIsUnverified = Boolean(
        (client.eDocId && !exactContract)
        || (!client.eDocId && contractDocs.length > 1),
    );

    return {
        evidence: contractIsUnverified ? "unverified" : "observed",
        serviceRecordSnapshot: {
            documentIds: [...new Set(snapshots.map((document) => document.documentId))].sort(),
            snapshotVersion: snapshotVersions.length > 0 ? Math.max(...snapshotVersions) : record.currentUsableDocumentVersion,
            chunks: snapshotChunks,
        },
        currentRevision: {
            id: currentRevision?.id ?? record.currentRevisionId ?? record.currentUsableRevisionId,
            revisionNumber: currentRevision?.revisionNumber ?? null,
            formVersion: currentRevision?.formVersionAtConfirm ?? null,
        },
        form: { version: record.formVersion },
        contract: {
            currentDocumentId: currentContract?.documentId ?? null,
            stage: currentContract ? contractStage(currentContract) : null,
        },
    };
}

function dateOnly(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
}

function instant(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function toDraft(row: DraftRow): ServiceRecordEditDraft {
    return {
        id: row.id,
        branchId: row.branchId,
        serviceRecordCaseId: row.serviceRecordCaseId,
        createdByUserId: row.createdByUserId,
        updatedByUserId: row.updatedByUserId,
        discardedByUserId: row.discardedByUserId,
        sourceCaseVersion: row.sourceCaseVersion,
        sourceFingerprint: row.sourceFingerprint,
        sourceSnapshot: row.sourceSnapshot as unknown as ServiceRecordEditJsonValue,
        changes: row.changes as unknown as ServiceRecordEditJsonValue,
        draftVersion: row.draftVersion,
        status: row.status as ServiceRecordEditDraft["status"],
        createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    discardedAt: row.discardedAt,
    confirmedByUserId: row.confirmedByUserId ?? null,
    confirmedAt: row.confirmedAt ?? null,
    confirmationIdempotencyKey: row.confirmationIdempotencyKey ?? null,
    confirmationFingerprint: row.confirmationFingerprint ?? null,
    confirmationResponse: row.confirmationResponse === null
        ? null
        : row.confirmationResponse as unknown as ServiceRecordEditJsonValue,
};
}

function toRevision(row: RevisionRow): ServiceRecordRevision {
    return {
        id: row.id,
        branchId: row.branchId,
        serviceRecordCaseId: row.serviceRecordCaseId,
        revisionNumber: row.revisionNumber,
        confirmedByUserId: row.confirmedByUserId,
        confirmedAt: row.confirmedAt,
        payload: row.payload as unknown as ServiceRecordEditJsonValue,
        plannedSessions: row.plannedSessions as unknown as ServiceRecordEditJsonValue,
        provenance: row.provenance as unknown as ServiceRecordEditJsonValue,
        formVersionAtConfirm: row.formVersionAtConfirm,
        snapshotReference: row.snapshotReference,
    };
}

function dateValue(value: string | null): Date | null {
    if (value === null) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonicalize(nested)]),
        );
    }
    return value;
}

function jsonFingerprint(value: unknown): string {
    return sha256CanonicalJson(value);
}

function sameSortedNumbers(left: number[], right: number[]): boolean {
    const a = [...new Set(left)].sort((x, y) => x - y);
    const b = [...new Set(right)].sort((x, y) => x - y);
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

type OptionalQueryTransaction = Prisma.TransactionClient & {
    $queryRaw?: <T = unknown>(query: Prisma.Sql) => Promise<T>;
};

type RevisionDocumentStateRow = {
    id: string;
    branchId: string;
    clientId: number;
    serviceRecordCaseId: string;
    revisionId: string;
    operation: string;
    generation: string;
    immutableInput: unknown;
    inputFingerprint: string;
    documentVersion: number | null;
    sourceDocumentId: string | null;
    targetDocumentId: string | null;
    templateId: string | null;
    templateVersion: string | null;
    workflowScope: unknown;
    mirrorGeneration: string | null;
    outputProof: unknown;
    step: string;
    status: string;
    attempts: number;
    nextAttemptAt: Date | string | null;
    lastErrorCode: string | null;
    version: number;
    createdAt: Date | string;
    updatedAt: Date | string;
};

function revisionDocumentOperation(value: string): ServiceRecordRevisionDocumentOperation {
    if (!(SERVICE_RECORD_REVISION_DOCUMENT_OPERATIONS as readonly string[]).includes(value)) {
        throw new ServiceRecordEditConflictError("Unknown revision document operation");
    }
    return value as ServiceRecordRevisionDocumentOperation;
}

function revisionDocumentStatus(value: string): ServiceRecordRevisionDocumentStatus {
    if (!(SERVICE_RECORD_REVISION_DOCUMENT_STATUSES as readonly string[]).includes(value)) {
        throw new ServiceRecordEditConflictError("Unknown revision document status");
    }
    return value as ServiceRecordRevisionDocumentStatus;
}

function jsonObjectOrConflict(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new ServiceRecordEditConflictError(`Revision document ${field} is invalid`);
    }
    return value as Record<string, unknown>;
}

function stateDate(value: Date | string | null): string | null {
    if (value === null) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new ServiceRecordEditConflictError("Revision document timestamp is invalid");
    }
    return parsed.toISOString();
}

function toRevisionDocumentState(row: RevisionDocumentStateRow): ServiceRecordRevisionDocumentState {
    const immutableInput = jsonObjectOrConflict(row.immutableInput, "immutable input");
    const inputFingerprint = row.inputFingerprint.trim();
    stateFingerprint(inputFingerprint);
    if (jsonFingerprint(immutableInput) !== inputFingerprint.toLowerCase()) {
        throw new ServiceRecordEditConflictError("Revision document fingerprint does not match immutable input");
    }
    return {
        id: row.id,
        branchId: row.branchId,
        clientId: row.clientId,
        serviceRecordCaseId: row.serviceRecordCaseId,
        revisionId: row.revisionId,
        operation: revisionDocumentOperation(row.operation),
        generation: row.generation,
        immutableInput,
        inputFingerprint,
        documentVersion: row.documentVersion,
        sourceDocumentId: row.sourceDocumentId,
        targetDocumentId: row.targetDocumentId,
        templateId: row.templateId,
        templateVersion: row.templateVersion,
        workflowScope: row.workflowScope === null
            ? null
            : jsonObjectOrConflict(row.workflowScope, "workflow scope"),
        mirrorGeneration: row.mirrorGeneration,
        outputProof: row.outputProof === null
            ? null
            : jsonObjectOrConflict(row.outputProof, "output proof"),
        step: row.step,
        status: revisionDocumentStatus(row.status),
        attempts: row.attempts,
        nextAttemptAt: stateDate(row.nextAttemptAt),
        lastErrorCode: row.lastErrorCode,
        version: row.version,
        createdAt: stateDate(row.createdAt) ?? "",
        updatedAt: stateDate(row.updatedAt) ?? "",
    };
}

function stateFingerprint(value: string): void {
    if (!/^[0-9a-f]{64}$/i.test(value)) {
        throw new ServiceRecordEditConflictError("Revision document fingerprint is invalid");
    }
}

function assertStateInput(input: CreateServiceRecordRevisionDocumentStateInput): void {
    if (!UUID_PATTERN.test(input.branchId)
        || !UUID_PATTERN.test(input.serviceRecordCaseId)
        || !UUID_PATTERN.test(input.revisionId)
        || !Number.isInteger(input.clientId)
        || input.clientId < 1) {
        throw new ServiceRecordEditConflictError("Revision document ownership is invalid");
    }
    if (!input.generation || input.generation.length > 128) {
        throw new ServiceRecordEditConflictError("Revision document generation is invalid");
    }
    stateFingerprint(input.inputFingerprint);
    if (jsonFingerprint(input.immutableInput) !== input.inputFingerprint.toLowerCase()) {
        throw new ServiceRecordEditConflictError("Revision document fingerprint does not match immutable input");
    }
    revisionDocumentOperation(input.operation);
    revisionDocumentStatus(input.status ?? "pending");
    if (!input.immutableInput || typeof input.immutableInput !== "object" || Array.isArray(input.immutableInput)) {
        throw new ServiceRecordEditConflictError("Revision document immutable input is invalid");
    }
}

function assertUuid(value: string, field: string): void {
    if (!UUID_PATTERN.test(value)) {
        throw new ServiceRecordEditConflictError(`Revision document ${field} is invalid`);
    }
}

function assertClientId(value: number): void {
    if (!Number.isInteger(value) || value < 1) {
        throw new ServiceRecordEditConflictError("Revision document client is invalid");
    }
}

function jsonSql(value: ServiceRecordEditJsonValue | null | undefined): Prisma.Sql {
    if (value === undefined || value === null) return Prisma.sql`NULL`;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new ServiceRecordEditConflictError("Revision document JSON input is invalid");
    }
    return Prisma.sql`${serialized}::jsonb`;
}

function nullableSql(value: string | null | undefined): Prisma.Sql {
    if (value === undefined || value === null) return Prisma.sql`NULL`;
    return Prisma.sql`${value}`;
}

function nullableDateSql(value: Date | null | undefined): Prisma.Sql {
    if (value === undefined || value === null) return Prisma.sql`NULL`;
    if (Number.isNaN(value.getTime())) {
        throw new ServiceRecordEditConflictError("Revision document retry timestamp is invalid");
    }
    return Prisma.sql`${value}`;
}

function canRetryRevisionDocumentState(row: Pick<RevisionDocumentStateRow, "status" | "step">): boolean {
    return (row.status === "failed" || row.status === "manual_review")
        && !["creating", "sent", "reconciling", "unknown"].includes(row.step);
}

async function rawStateQuery<T>(
    client: Prisma.TransactionClient | PrismaService,
    query: Prisma.Sql,
): Promise<T> {
    const queryClient = client as unknown as {
        $queryRaw?: <R = unknown>(statement: Prisma.Sql) => Promise<R>;
    };
    if (typeof queryClient.$queryRaw !== "function") {
        throw new ServiceRecordEditConflictError("Revision document state storage is unavailable");
    }
    return queryClient.$queryRaw<T>(query);
}

const revisionDocumentStateColumns = Prisma.sql`
    id,
    branch_id AS "branchId",
    client_id AS "clientId",
    service_record_case_id AS "serviceRecordCaseId",
    revision_id AS "revisionId",
    operation,
    generation,
    immutable_input AS "immutableInput",
    input_fingerprint AS "inputFingerprint",
    document_version AS "documentVersion",
    source_document_id AS "sourceDocumentId",
    target_document_id AS "targetDocumentId",
    template_id AS "templateId",
    template_version AS "templateVersion",
    workflow_scope AS "workflowScope",
    mirror_generation AS "mirrorGeneration",
    output_proof AS "outputProof",
    step,
    status,
    attempts,
    next_attempt_at AS "nextAttemptAt",
    last_error_code AS "lastErrorCode",
    version,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
`;

// `selectRevisionDocumentState` joins the state row to its owning case and
// revision.  Both joined tables expose an `id`, `version`, and timestamps;
// qualify every selected state column so PostgreSQL cannot resolve a field to
// the wrong owner.  Inserts/updates use the unqualified fragment above in
// their RETURNING clauses because those statements have one target table.
const revisionDocumentStateSelectColumns = Prisma.sql`
    state.id,
    state.branch_id AS "branchId",
    state.client_id AS "clientId",
    state.service_record_case_id AS "serviceRecordCaseId",
    state.revision_id AS "revisionId",
    state.operation,
    state.generation,
    state.immutable_input AS "immutableInput",
    state.input_fingerprint AS "inputFingerprint",
    state.document_version AS "documentVersion",
    state.source_document_id AS "sourceDocumentId",
    state.target_document_id AS "targetDocumentId",
    state.template_id AS "templateId",
    state.template_version AS "templateVersion",
    state.workflow_scope AS "workflowScope",
    state.mirror_generation AS "mirrorGeneration",
    state.output_proof AS "outputProof",
    state.step,
    state.status,
    state.attempts,
    state.next_attempt_at AS "nextAttemptAt",
    state.last_error_code AS "lastErrorCode",
    state.version,
    state.created_at AS "createdAt",
    state.updated_at AS "updatedAt"
`;

async function selectRevisionDocumentState(
    client: Prisma.TransactionClient | PrismaService,
    scope: {
        branchId: string;
        clientId: number;
        serviceRecordCaseId?: string;
        revisionId?: string;
        stateId?: string;
        generation?: string;
        forUpdate?: boolean;
    },
): Promise<RevisionDocumentStateRow[]> {
    const lock = scope.forUpdate ? Prisma.sql` FOR UPDATE` : Prisma.empty;
    return rawStateQuery<RevisionDocumentStateRow[]>(client, Prisma.sql`
        SELECT ${revisionDocumentStateSelectColumns}
        FROM "service_record_revision_document_state" AS state
        INNER JOIN "service_record_case" AS owner_case
            ON owner_case.branch_id = state.branch_id
           AND owner_case.id = state.service_record_case_id
           AND owner_case.client_id = state.client_id
        INNER JOIN "service_record_revision" AS owner_revision
            ON owner_revision.branch_id = state.branch_id
           AND owner_revision.service_record_case_id = state.service_record_case_id
           AND owner_revision.id = state.revision_id
        WHERE state.branch_id = ${scope.branchId}::uuid
          AND state.client_id = ${scope.clientId}
          ${scope.serviceRecordCaseId === undefined ? Prisma.empty : Prisma.sql`AND state.service_record_case_id = ${scope.serviceRecordCaseId}::uuid`}
          ${scope.revisionId === undefined ? Prisma.empty : Prisma.sql`AND state.revision_id = ${scope.revisionId}::uuid`}
          ${scope.stateId === undefined ? Prisma.empty : Prisma.sql`AND state.id = ${scope.stateId}::uuid`}
          ${scope.generation === undefined ? Prisma.empty : Prisma.sql`AND state.generation = ${scope.generation}`}
        ORDER BY state.created_at ASC, state.id ASC${lock}
    `);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function lockRowsByBranchAndIds(
    tx: Prisma.TransactionClient,
    table: string,
    delegateName: string,
    branchId: string,
    ids: Array<string | number>,
    uuidIds: boolean,
): Promise<void> {
    if (ids.length === 0) return;
    const transaction = tx as OptionalQueryTransaction;
    if (typeof transaction.$queryRaw === "function") {
        const values = Prisma.join(ids.map((id) => uuidIds
            ? Prisma.sql`${String(id)}::uuid`
            : Prisma.sql`${id}`));
        await transaction.$queryRaw(Prisma.sql`
            SELECT id
            FROM ${Prisma.raw(table)}
            WHERE branch_id = ${branchId}::uuid
              AND id IN (${values})
            FOR UPDATE
        `);
        return;
    }
    const delegate = (tx as unknown as Record<string, { findMany?: (args: unknown) => Promise<unknown> }>)[delegateName];
    if (typeof delegate?.findMany === "function") {
        await delegate.findMany({
            where: { branchId, id: { in: ids } },
            select: { id: true },
        });
    }
}

async function lockCaseChildren(
    tx: Prisma.TransactionClient,
    branchId: string,
    caseId: string,
    table: string,
    delegateName: string,
    caseColumn: string,
): Promise<void> {
    const transaction = tx as OptionalQueryTransaction;
    if (typeof transaction.$queryRaw === "function") {
        await transaction.$queryRaw(Prisma.sql`
            SELECT id
            FROM ${Prisma.raw(table)}
            WHERE branch_id = ${branchId}::uuid
              AND ${Prisma.raw(caseColumn)} = ${caseId}::uuid
            FOR UPDATE
        `);
        return;
    }
    const delegate = (tx as unknown as Record<string, { findMany?: (args: unknown) => Promise<unknown> }>)[delegateName];
    if (typeof delegate?.findMany === "function") {
        await delegate.findMany({
            where: { branchId, [caseColumn === "service_record_case_id" ? "serviceRecordCaseId" : caseColumn]: caseId },
            select: { id: true },
        });
    }
}

function isNonEmptyFutureContent(session: ServiceRecordEditConfirmNewSession): boolean {
    const hasAnswers = Array.isArray(session.answers)
        ? session.answers.length > 0
        : Boolean(session.answers && typeof session.answers === "object" && Object.keys(session.answers).length > 0);
    return hasAnswers
        || (typeof session.etcService === "string" && session.etcService.trim().length > 0)
        || (typeof session.notes === "string" && session.notes.trim().length > 0)
        || session.paymentConfirmed === true;
}

function assertFutureSessionPlan(
    plan: ServiceRecordEditConfirmPlan,
    source: ServiceRecordEditSource,
): void {
    if (plan.newSessions.length === 0) return;
    if (plan.status !== "confirmed") {
        throw new ServiceRecordEditConflictError("Future sessions require a confirmed plan");
    }
    const required = source.requiredSessionCount;
    if (typeof required !== "number" || !Number.isInteger(required) || required < 1 || !source.client.branchId) {
        throw new ServiceRecordEditConflictError("Future session provenance is unavailable");
    }

    const existingIndexes = new Set(source.sessions.map((session) => session.sessionIndex));
    const seenIndexes = new Set<number>();
    for (const session of plan.newSessions) {
        const assignment = source.assignments.find((candidate) => candidate.id === session.assignmentId);
        const canonicalEmployeeName = assignment?.employeeName ?? assignment?.primaryEmployeeName;
        const date = dateValue(session.serviceDate);
        const originalDate = dateValue(session.originalDate);
        if (
            !UUID_PATTERN.test(session.sourceRowId)
            || !Number.isInteger(session.sessionIndex)
            || session.sessionIndex < 1
            || session.sessionIndex > required
            || existingIndexes.has(session.sessionIndex)
            || seenIndexes.has(session.sessionIndex)
            || !DATE_ONLY_PATTERN.test(session.serviceDate)
            || !date
            || !DATE_ONLY_PATTERN.test(session.originalDate)
            || !originalDate
            || !assignment
            || assignment.branchId !== source.client.branchId
            || assignment.serviceRecordCaseId !== source.caseId
            || assignment.id !== session.assignmentId
            || assignment.scheduleId !== session.scheduleId
            || assignment.employeeId !== session.employeeId
            || !Number.isInteger(session.scheduleId)
            || session.scheduleId < 1
            || !Number.isInteger(session.employeeId)
            || session.employeeId < 1
            || !canonicalEmployeeName
            || session.employeeNameSnapshot !== canonicalEmployeeName
            || typeof session.provenanceVersion !== "string"
            || session.provenanceVersion.length === 0
            || !Number.isInteger(session.formVersion)
            || session.formVersion < 1
            || session.locked !== false
            || session.momApproval !== null
            || session.clientSignature !== null
            || session.clientSignedAt !== null
            || session.submittedAt !== null
            || !isNonEmptyFutureContent(session)
        ) {
            throw new ServiceRecordEditConflictError("Future session provenance is unavailable");
        }
        seenIndexes.add(session.sessionIndex);
    }
}

function isRevisionDocumentJobPayload(value: unknown): boolean {
    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value) as unknown;
        } catch {
            return false;
        }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>)["kind"] === "service_record_revision";
}

/**
 * A historical eformsign job may have lost its client_id when the provider
 * finalization path was enqueued.  Such a row is owned only when its document
 * still proves the same branch/client pair and the client's canonical e_doc_id
 * points at that exact document.  Keeping the pointer check in this predicate
 * prevents a stale document owner (or a document from another branch) from
 * broadening confirmation's job fence.
 *
 * Queries using this fragment must alias eformsign_document_job as `job`.
 */
function eformsignDocumentJobOwnershipPredicate(
    branchId: string,
    clientId: number,
): Prisma.Sql {
    return Prisma.sql`
        (
            (
                job.branch_id = ${branchId}::uuid
                AND job.client_id = ${clientId}
            )
            OR (
                job.branch_id = ${branchId}::uuid
                AND job.client_id IS NULL
                AND job.document_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM "eformsign_doc" AS owner_doc
                    INNER JOIN "client" AS owner_client
                        ON owner_client.id = ${clientId}
                       AND owner_client.branch_id = ${branchId}::uuid
                       AND owner_client.e_doc_id = owner_doc.document_id
                    WHERE owner_doc.document_id = job.document_id
                      AND owner_doc.branch_id = ${branchId}::uuid
                      AND owner_doc.client_id = ${clientId}
                )
            )
        )
    `;
}

/**
 * Lock contract documents proven by the currently locked client's canonical
 * e_doc_id before locking document jobs.  Case-linked service-record snapshot
 * documents are locked by lockCaseChildren; this closes the historical
 * contract-document gap without locking arbitrary branch documents.
 */
async function lockClientOwnedContractDocuments(
    tx: Prisma.TransactionClient,
    branchId: string,
    clientId: number,
): Promise<void> {
    const transaction = tx as OptionalQueryTransaction;
    if (typeof transaction.$queryRaw === "function") {
        await transaction.$queryRaw(Prisma.sql`
            SELECT owner_doc.id
            FROM "eformsign_doc" AS owner_doc
            INNER JOIN "client" AS owner_client
                ON owner_client.id = ${clientId}
               AND owner_client.branch_id = ${branchId}::uuid
               AND owner_client.e_doc_id = owner_doc.document_id
            WHERE owner_doc.branch_id = ${branchId}::uuid
              AND owner_doc.client_id = ${clientId}
            FOR UPDATE OF owner_doc
        `);
        return;
    }

    // The production transaction always exposes $queryRaw.  Keep the
    // delegate fallback narrow for repository unit doubles and non-raw test
    // clients; no client/document row is treated as owned when its pointer is
    // unavailable.
    const delegates = tx as unknown as {
        client?: { findFirst?: (args: unknown) => Promise<{ eDocId?: string | null } | null> };
        eformsign_doc?: { findMany?: (args: unknown) => Promise<unknown> };
    };
    if (typeof delegates.client?.findFirst !== "function"
        || typeof delegates.eformsign_doc?.findMany !== "function") {
        return;
    }
    const owner = await delegates.client.findFirst({
        where: { id: clientId, branchId },
        select: { eDocId: true },
    });
    if (!owner?.eDocId) return;
    await delegates.eformsign_doc.findMany({
        where: {
            branchId,
            clientId,
            documentId: owner.eDocId,
        },
        select: { id: true },
    });
}

async function findClientOwnedLegacyDocumentIds(
    tx: Prisma.TransactionClient,
    branchId: string,
    clientId: number,
): Promise<string[]> {
    const delegates = tx as unknown as {
        client?: { findFirst?: (args: unknown) => Promise<{ eDocId?: string | null } | null> };
        eformsign_doc?: { findMany?: (args: unknown) => Promise<Array<{ documentId?: string }>> };
    };
    if (typeof delegates.client?.findFirst !== "function"
        || typeof delegates.eformsign_doc?.findMany !== "function") {
        return [];
    }
    const owner = await delegates.client.findFirst({
        where: { id: clientId, branchId },
        select: { eDocId: true },
    });
    if (!owner?.eDocId) return [];
    const documents = await delegates.eformsign_doc.findMany({
        where: {
            branchId,
            clientId,
            documentId: owner.eDocId,
        },
        select: { documentId: true },
    });
    return documents
        .map((document) => document.documentId)
        .filter((documentId): documentId is string => typeof documentId === "string");
}

function jsonValueForConfirmation(response: ServiceRecordEditConfirmResponse): ServiceRecordEditJsonValue {
    return response as unknown as ServiceRecordEditJsonValue;
}

function parseConfirmationResponse(value: ServiceRecordEditJsonValue | null): ServiceRecordEditConfirmResponse | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
        (record["status"] !== "confirmed" && record["status"] !== "no_changes")
        || typeof record["caseId"] !== "string"
        || typeof record["clientId"] !== "number"
        || typeof record["draftId"] !== "string"
        || typeof record["draftVersion"] !== "number"
        || typeof record["caseVersion"] !== "number"
        || (record["revisionId"] !== null && typeof record["revisionId"] !== "string")
        || (record["revisionNumber"] !== null && typeof record["revisionNumber"] !== "number")
        || typeof record["documentStatus"] !== "string"
        || typeof record["confirmedAt"] !== "string"
    ) return null;
    return record as unknown as ServiceRecordEditConfirmResponse;
}

/**
 * Prisma adapter for the editor's durable draft and revision records.
 *
 * Every lookup that can be reached with an externally supplied identifier is
 * pinned by both branch and case. A case ownership check happens before draft
 * creation and revision append, so a valid case id from another branch cannot
 * be used to probe or attach a row. Draft writes use a version predicate; the
 * database therefore accepts exactly one winner when two administrators save
 * at the same time.
 */
@Injectable()
export class ServiceRecordEditRepository implements IServiceRecordEditRepository {
    constructor(private readonly prisma: PrismaService) {}

    async createOrResumeDraft(input: CreateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft> {
        // Lock the parent case for the complete ownership-check/read/create
        // sequence. A concurrent branch reassignment therefore cannot make the
        // draft's branch snapshot disagree with the case that was checked.
        try {
            return await this.prisma.$transaction(async (tx) => {
                await this.assertCaseBelongsToBranchWithClient(tx, input.branchId, input.serviceRecordCaseId);

                const existing = await this.findActiveDraftWithClient(tx, input.branchId, input.serviceRecordCaseId);
                if (existing) return existing;

                const created = await tx.service_record_edit_draft.create({
                    data: {
                        branchId: input.branchId,
                        serviceRecordCaseId: input.serviceRecordCaseId,
                        createdByUserId: input.actorUserId,
                        updatedByUserId: input.actorUserId,
                        sourceCaseVersion: input.sourceCaseVersion,
                        sourceFingerprint: input.sourceFingerprint,
                        sourceSnapshot: toPrismaJson(input.sourceSnapshot),
                        changes: toPrismaJson(input.changes ?? {}),
                        draftVersion: 1,
                        status: "ACTIVE",
                    },
                });
                return toDraft(created);
            });
        } catch (error) {
            // A unique violation aborts the transaction, so the loser must
            // resume on the root client after rollback. (The parent-case lock
            // normally serializes this path; the index remains the final guard
            // for writers that do not use this adapter.)
            if (!isUniqueConstraintError(error)) throw error;
            const concurrent = await this.findActiveDraft(input.branchId, input.serviceRecordCaseId);
            if (!concurrent) throw error;
            return concurrent;
        }
    }

    async findActiveDraft(branchId: string, serviceRecordCaseId: string): Promise<ServiceRecordEditDraft | null> {
        return this.findActiveDraftWithClient(this.prisma, branchId, serviceRecordCaseId);
    }

    private async findActiveDraftWithClient(
        client: DraftClient,
        branchId: string,
        serviceRecordCaseId: string,
    ): Promise<ServiceRecordEditDraft | null> {
        const row = await client.service_record_edit_draft.findFirst({
            where: {
                branchId,
                serviceRecordCaseId,
                status: "ACTIVE",
            },
            orderBy: { updatedAt: "desc" },
        });
        return row ? toDraft(row) : null;
    }

    async findDraft(
        branchId: string,
        serviceRecordCaseId: string,
        draftId: string,
    ): Promise<ServiceRecordEditDraft | null> {
        return this.findDraftWithClient(this.prisma, branchId, serviceRecordCaseId, draftId);
    }

    private async findDraftWithClient(
        client: DraftClient,
        branchId: string,
        serviceRecordCaseId: string,
        draftId: string,
    ): Promise<ServiceRecordEditDraft | null> {
        const row = await client.service_record_edit_draft.findFirst({
            where: {
                id: draftId,
                branchId,
                serviceRecordCaseId,
            },
        });
        return row ? toDraft(row) : null;
    }

    async findDraftById(branchId: string, draftId: string): Promise<ServiceRecordEditDraft | null> {
        const row = await this.prisma.service_record_edit_draft.findFirst({
            where: { id: draftId, branchId },
        });
        return row ? toDraft(row) : null;
    }

    private async findDraftByIdWithClient(
        client: DraftClient,
        branchId: string,
        draftId: string,
    ): Promise<ServiceRecordEditDraft | null> {
        const row = await client.service_record_edit_draft.findFirst({
            where: { id: draftId, branchId },
        });
        return row ? toDraft(row) : null;
    }

    async loadDraftWithSource(
        branchId: string,
        draftId: string,
    ): Promise<{ draft: ServiceRecordEditDraft; source: ServiceRecordEditSource } | null> {
        return this.prisma.$transaction(async (tx) => {
            const draft = await this.findDraftByIdWithClient(tx, branchId, draftId);
            if (!draft) return null;
            const source = await this.loadSourceWithClient(tx, branchId, { caseId: draft.serviceRecordCaseId });
            return source ? { draft, source } : null;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    }

    async loadSource(
        branchId: string,
        target: { clientId?: number; caseId?: string },
    ): Promise<ServiceRecordEditSource | null> {
        return this.prisma.$transaction(
            (tx) => this.loadSourceWithClient(tx, branchId, target),
            { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        );
    }

    private async loadSourceWithClient(
        tx: Prisma.TransactionClient,
        branchId: string,
        target: { clientId?: number; caseId?: string },
    ): Promise<ServiceRecordEditSource | null> {
        if (target.clientId === undefined && target.caseId === undefined) return null;
        let clientId = target.clientId;
        if (clientId !== undefined) {
            const ownedClient = await tx.client.findFirst({
                where: { id: clientId, branchId },
                select: { id: true },
            });
            if (!ownedClient) return null;
        }

        const record = await tx.service_record_case.findFirst({
            where: {
                branchId,
                ...(target.caseId ? { id: target.caseId } : {}),
                ...(clientId !== undefined ? { clientId } : {}),
            },
            select: {
                id: true,
                clientId: true,
                version: true,
                formVersion: true,
                status: true,
                completedAt: true,
                finalizationDueAt: true,
                finalizationStartedAt: true,
                finalizedAt: true,
                documentsCompletedAt: true,
                currentRevisionId: true,
                currentUsableRevisionId: true,
                currentUsableDocumentVersion: true,
                requiredSessionCount: true,
                startDate: true,
                endDate: true,
                momName: true,
                momBirth: true,
                babyName: true,
                babyBirth: true,
                deliveryType: true,
                babyWeight: true,
                plannedSessions: true,
                days: {
                    orderBy: [
                        { caseSessionIndex: "asc" },
                        { sessionIndex: "asc" },
                        { id: "asc" },
                    ],
                    select: {
                        id: true,
                        branchId: true,
                        scheduleId: true,
                        caseSessionIndex: true,
                        sessionIndex: true,
                        employeeNameSnapshot: true,
                        formVersion: true,
                        serviceDate: true,
                        answers: true,
                        etcService: true,
                        notes: true,
                        paymentConfirmed: true,
                        momApproval: true,
                        clientSignature: true,
                        clientSignedAt: true,
                        locked: true,
                        submittedAt: true,
                        employeeId: true,
                    },
                },
            },
        });
        if (!record || record.clientId === null) return null;
        clientId = record.clientId;

        const client = await tx.client.findFirst({
            where: { id: record.clientId, branchId },
            select: {
                id: true,
                branchId: true,
                name: true,
                duration: true,
                startDate: true,
                endDate: true,
                serviceStatus: true,
                eDocId: true,
            },
        });
        if (!client) return null;

        const schedules = await tx.employee_schedule.findMany({
            where: { branchId, clientId },
            orderBy: { id: "asc" },
            select: {
                id: true,
                branchId: true,
                startDate: true,
                endDate: true,
                replaced: true,
                terminatedAt: true,
                primaryEmployeeId: true,
                secondaryEmployeeId: true,
                primaryEmployee: { select: { name: true } },
                serviceRecordAssignment: {
                    select: {
                        id: true,
                        branchId: true,
                        serviceRecordCaseId: true,
                        scheduleId: true,
                        employeeId: true,
                        startDate: true,
                        endDate: true,
                        employeeNameSnapshot: true,
                    },
                },
            },
        });

        const rawSessions = record.days.map((day) => ({
            id: day.id,
            branchId: day.branchId,
            sourceRowId: day.id,
            scheduleId: day.scheduleId,
            sessionIndex: day.caseSessionIndex ?? day.sessionIndex,
            rawCaseSessionIndex: day.caseSessionIndex,
            rawSessionIndex: day.sessionIndex,
            serviceDate: dateOnly(day.serviceDate) ?? "",
            answers: toDomainJson(day.answers),
            etcService: day.etcService,
            notes: day.notes,
            paymentConfirmed: day.paymentConfirmed,
            momApproval: day.momApproval,
            clientSignature: day.clientSignature,
            clientSignedAt: instant(day.clientSignedAt),
            locked: day.locked,
            submittedAt: instant(day.submittedAt),
            employeeId: day.employeeId,
            employeeNameSnapshot: day.employeeNameSnapshot,
            formVersion: day.formVersion,
        } satisfies Omit<ServiceRecordEditSourceDay, "ambiguous">));
        const sessionIndexCounts = new Map<number, number>();
        for (const session of rawSessions) {
            sessionIndexCounts.set(session.sessionIndex, (sessionIndexCounts.get(session.sessionIndex) ?? 0) + 1);
        }
        const sessions: ServiceRecordEditSourceDay[] = rawSessions.map((session) => ({
            ...session,
            ambiguous: (sessionIndexCounts.get(session.sessionIndex) ?? 0) > 1,
        }));

        const assignments: ServiceRecordEditSourceAssignment[] = schedules.map((schedule) => ({
            id: schedule.serviceRecordAssignment?.id ?? null,
            branchId: schedule.serviceRecordAssignment?.branchId ?? schedule.branchId ?? null,
            serviceRecordCaseId: schedule.serviceRecordAssignment?.serviceRecordCaseId ?? null,
            scheduleId: schedule.id,
            employeeId: schedule.serviceRecordAssignment?.employeeId ?? schedule.primaryEmployeeId,
            startDate: dateOnly(schedule.serviceRecordAssignment?.startDate ?? schedule.startDate) ?? "",
            endDate: dateOnly(schedule.serviceRecordAssignment?.endDate ?? schedule.endDate) ?? "",
            replaced: schedule.replaced,
            employeeName: schedule.serviceRecordAssignment?.employeeNameSnapshot ?? schedule.primaryEmployee.name,
            scheduleStartDate: dateOnly(schedule.startDate) ?? "",
            scheduleEndDate: dateOnly(schedule.endDate) ?? "",
            scheduleTerminatedAt: instant(schedule.terminatedAt),
            primaryEmployeeId: schedule.primaryEmployeeId,
            secondaryEmployeeId: schedule.secondaryEmployeeId ?? null,
            primaryEmployeeName: schedule.primaryEmployee.name,
        }));

        const [sourceSignatureMetadata, documentScope] = await Promise.all([
            Promise.resolve(signatureMetadata(rawSessions)),
            loadDocumentScope(tx, branchId, record, client, schedules.map((schedule) => schedule.id)),
        ]);

        return {
            caseId: record.id,
            caseVersion: record.version,
            formVersion: record.formVersion,
            caseLifecycle: {
                status: record.status,
                completedAt: instant(record.completedAt),
                finalizationDueAt: instant(record.finalizationDueAt),
                finalizationStartedAt: instant(record.finalizationStartedAt),
                finalizedAt: instant(record.finalizedAt),
                documentsCompletedAt: instant(record.documentsCompletedAt),
            },
            requiredSessionCount: record.requiredSessionCount,
            startDate: dateOnly(record.startDate),
            endDate: dateOnly(record.endDate),
            header: {
                momName: record.momName,
                momBirth: record.momBirth,
                babyName: record.babyName,
                babyBirth: record.babyBirth,
                deliveryType: record.deliveryType,
                babyWeight: record.babyWeight,
            },
            sessions,
            assignments,
            plannedSessions: record.plannedSessions === null ? null : toDomainJson(record.plannedSessions),
            signatureMetadata: sourceSignatureMetadata,
            documentScope,
            client: {
                id: client.id,
                branchId: client.branchId,
                name: client.name,
                duration: client.duration,
                startDate: dateOnly(client.startDate),
                endDate: dateOnly(client.endDate),
                serviceStatus: client.serviceStatus,
            },
        };
    }

    async updateDraft(input: UpdateServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft> {
        // Keep the CAS write and response read in one transaction. The update
        // lock is held through the read, so a later writer cannot cause this
        // response to acknowledge another actor's changes.
        return this.prisma.$transaction(async (tx) => {
            const current = await this.findDraftWithClient(tx, input.branchId, input.serviceRecordCaseId, input.draftId);
            if (!current) throw new ServiceRecordEditNotFoundError();
            if (current.status !== "ACTIVE") {
                throw new ServiceRecordEditDraftConflictError("The service-record draft is no longer active");
            }

            const updated = await tx.service_record_edit_draft.updateMany({
                where: {
                    id: input.draftId,
                    branchId: input.branchId,
                    serviceRecordCaseId: input.serviceRecordCaseId,
                    status: "ACTIVE",
                    draftVersion: input.expectedDraftVersion,
                },
                data: {
                    changes: toPrismaJson(input.changes),
                    draftVersion: { increment: 1 },
                    updatedByUserId: input.actorUserId,
                },
            });
            if (updated.count !== 1) {
                throw new ServiceRecordEditDraftConflictError();
            }

            const persisted = await this.findDraftWithClient(tx, input.branchId, input.serviceRecordCaseId, input.draftId);
            if (!persisted) throw new ServiceRecordEditNotFoundError();
            return persisted;
        });
    }

    async discardDraft(input: DiscardServiceRecordEditDraftInput): Promise<ServiceRecordEditDraft> {
        return this.prisma.$transaction(async (tx) => {
            const current = await this.findDraftWithClient(tx, input.branchId, input.serviceRecordCaseId, input.draftId);
            if (!current) throw new ServiceRecordEditNotFoundError();
            if (current.status !== "ACTIVE") {
                throw new ServiceRecordEditDraftConflictError("The service-record draft is already closed");
            }

            const discardedAt = new Date();
            const updated = await tx.service_record_edit_draft.updateMany({
                where: {
                    id: input.draftId,
                    branchId: input.branchId,
                    serviceRecordCaseId: input.serviceRecordCaseId,
                    status: "ACTIVE",
                    draftVersion: input.expectedDraftVersion,
                },
                data: {
                    status: "DISCARDED",
                    discardedAt,
                    discardedByUserId: input.actorUserId,
                    updatedByUserId: input.actorUserId,
                    draftVersion: { increment: 1 },
                },
            });
            if (updated.count !== 1) {
                throw new ServiceRecordEditDraftConflictError();
            }

            const persisted = await this.findDraftWithClient(tx, input.branchId, input.serviceRecordCaseId, input.draftId);
            if (!persisted) throw new ServiceRecordEditNotFoundError();
            return persisted;
        });
    }

    async appendRevision(
        input: AppendServiceRecordRevisionInput,
    ): Promise<ServiceRecordRevision> {
        return this.prisma.$transaction((tx) => this.appendRevisionWithClient(tx, input));
    }

    private async appendRevisionWithClient(
        client: RevisionClient,
        input: AppendServiceRecordRevisionInput,
    ): Promise<ServiceRecordRevision> {
        // Lock and scope the parent first. This both validates ownership and
        // serializes revision-number allocation without touching case content.
        const ownedCase = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM service_record_case
            WHERE id = ${input.serviceRecordCaseId}::uuid
              AND branch_id = ${input.branchId}::uuid
            FOR UPDATE
        `);
        if (ownedCase.length !== 1) {
            throw new ServiceRecordEditNotFoundError();
        }

        const latest = await client.service_record_revision.findFirst({
            where: {
                branchId: input.branchId,
                serviceRecordCaseId: input.serviceRecordCaseId,
            },
            orderBy: { revisionNumber: "desc" },
        });
        const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
        if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
            throw new ServiceRecordEditConflictError("Revision number must be a positive integer");
        }

        try {
            const created = await client.service_record_revision.create({
                data: {
                    branchId: input.branchId,
                    serviceRecordCaseId: input.serviceRecordCaseId,
                    revisionNumber,
                    confirmedByUserId: input.actorUserId,
                    payload: toPrismaJson(input.payload),
                    plannedSessions: toPrismaJson(input.plannedSessions),
                    provenance: toPrismaJson(input.provenance),
                    formVersionAtConfirm: input.formVersionAtConfirm,
                    snapshotReference: input.snapshotReference ?? null,
                },
            });
            return toRevision(created);
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                throw new ServiceRecordEditConflictError("The revision number is already recorded");
            }
            throw error;
        }
    }

    async listRevisionHistory(
        branchId: string,
        clientId: number,
    ): Promise<ServiceRecordRevisionHistoryResponse | null> {
        assertUuid(branchId, "branch");
        assertClientId(clientId);
        return this.prisma.$transaction(
            (tx) => this.listRevisionHistoryWithClient(tx, branchId, clientId),
            { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        );
    }

    private async listRevisionHistoryWithClient(
        tx: Prisma.TransactionClient,
        branchId: string,
        clientId: number,
    ): Promise<ServiceRecordRevisionHistoryResponse | null> {
        const cases = await rawStateQuery<Array<{
            caseId: string;
            caseVersion: number;
            currentRevisionId: string | null;
            currentUsableRevisionId: string | null;
        }>>(tx, Prisma.sql`
            SELECT
                id AS "caseId",
                version AS "caseVersion",
                current_revision_id AS "currentRevisionId",
                current_usable_revision_id AS "currentUsableRevisionId"
            FROM "service_record_case"
            WHERE branch_id = ${branchId}::uuid
              AND client_id = ${clientId}
            LIMIT 1
        `);
        const ownerCase = cases[0];
        if (!ownerCase) return null;

        const revisions = await rawStateQuery<Array<{
            id: string;
            revisionNumber: number;
            confirmedAt: Date | string;
        }>>(tx, Prisma.sql`
            SELECT
                id,
                revision_number AS "revisionNumber",
                confirmed_at AS "confirmedAt"
            FROM "service_record_revision"
            WHERE branch_id = ${branchId}::uuid
              AND service_record_case_id = ${ownerCase.caseId}::uuid
            ORDER BY revision_number DESC, id DESC
        `);
        const states = await selectRevisionDocumentState(tx, {
            branchId,
            clientId,
            serviceRecordCaseId: ownerCase.caseId,
        });
        const documentsByRevision = new Map<string, ServiceRecordRevisionDocumentState[]>();
        for (const row of states) {
            const state = toRevisionDocumentState(row);
            const existing = documentsByRevision.get(state.revisionId) ?? [];
            existing.push(state);
            documentsByRevision.set(state.revisionId, existing);
        }

        return {
            caseId: ownerCase.caseId,
            caseVersion: ownerCase.caseVersion,
            currentRevisionId: ownerCase.currentRevisionId,
            currentUsableRevisionId: ownerCase.currentUsableRevisionId,
            revisions: revisions.map((revision) => ({
                id: revision.id,
                revisionNumber: revision.revisionNumber,
                confirmedAt: stateDate(revision.confirmedAt) ?? "",
                isCurrent: revision.id === ownerCase.currentRevisionId,
                documents: (documentsByRevision.get(revision.id) ?? [])
                    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
                    .map((state) => ({
                        id: state.id,
                        operation: state.operation,
                        generation: state.generation,
                        status: state.status,
                        documentVersion: state.documentVersion,
                        canRetry: canRetryRevisionDocumentState(state),
                        reasonCode: state.lastErrorCode,
                    })),
            })),
        };
    }

    async findRevisionDocumentState(
        branchId: string,
        clientId: number,
        revisionId: string,
        stateId: string,
    ): Promise<ServiceRecordRevisionDocumentState | null> {
        assertUuid(branchId, "branch");
        assertClientId(clientId);
        assertUuid(revisionId, "revision");
        assertUuid(stateId, "state");
        const rows = await selectRevisionDocumentState(this.prisma, {
            branchId,
            clientId,
            revisionId,
            stateId,
        });
        const row = rows[0];
        return row ? toRevisionDocumentState(row) : null;
    }

    async createRevisionDocumentState(
        input: CreateServiceRecordRevisionDocumentStateInput,
    ): Promise<ServiceRecordRevisionDocumentState> {
        assertStateInput(input);
        return this.prisma.$transaction((tx) => this.createRevisionDocumentStateInTransaction({ tx }, input));
    }

    async createRevisionDocumentStateInTransaction(
        context: ServiceRecordEditTransactionContext,
        input: CreateServiceRecordRevisionDocumentStateInput,
    ): Promise<ServiceRecordRevisionDocumentState> {
        assertStateInput(input);
        const status = input.status ?? "pending";
        const rows = await rawStateQuery<RevisionDocumentStateRow[]>(context.tx, Prisma.sql`
            INSERT INTO "service_record_revision_document_state" (
                branch_id,
                client_id,
                service_record_case_id,
                revision_id,
                operation,
                generation,
                immutable_input,
                input_fingerprint,
                document_version,
                source_document_id,
                target_document_id,
                template_id,
                template_version,
                workflow_scope,
                mirror_generation,
                output_proof,
                step,
                status,
                attempts,
                next_attempt_at,
                last_error_code
            ) VALUES (
                ${input.branchId}::uuid,
                ${input.clientId},
                ${input.serviceRecordCaseId}::uuid,
                ${input.revisionId}::uuid,
                ${input.operation},
                ${input.generation},
                ${jsonSql(input.immutableInput)},
                ${input.inputFingerprint},
                ${input.documentVersion ?? null},
                ${input.sourceDocumentId ?? null},
                ${input.targetDocumentId ?? null},
                ${input.templateId ?? null},
                ${input.templateVersion ?? null},
                ${jsonSql(input.workflowScope)},
                ${input.mirrorGeneration ?? null},
                ${jsonSql(input.outputProof)},
                ${input.step ?? "pending"},
                ${status},
                ${input.attempts ?? 0},
                ${input.nextAttemptAt ?? null},
                ${input.lastErrorCode ?? null}
            )
            ON CONFLICT DO NOTHING
            RETURNING ${revisionDocumentStateColumns}
        `);
        const row = rows[0];
        if (row) return toRevisionDocumentState(row);

        // A repeated generation is idempotent only when every server-owned
        // identity value matches.  The unique generation constraint also
        // protects against a different branch/client attempting to reuse it;
        // the scoped read deliberately returns no row for that case.
        const existingRows = await selectRevisionDocumentState(context.tx, {
            branchId: input.branchId,
            clientId: input.clientId,
            revisionId: input.revisionId,
            generation: input.generation,
        });
        const existing = existingRows[0];
        if (!existing) {
            throw new ServiceRecordEditConflictError("Revision document generation is already owned");
        }
        const existingState = toRevisionDocumentState(existing);
        if (existingState.serviceRecordCaseId !== input.serviceRecordCaseId
            || existingState.operation !== input.operation
            || existingState.inputFingerprint !== input.inputFingerprint.toLowerCase()
            || JSON.stringify(canonicalize(existingState.immutableInput))
                !== JSON.stringify(canonicalize(input.immutableInput))) {
            throw new ServiceRecordEditConflictError("Revision document generation was reused with different input");
        }
        return existingState;
    }

    async advanceRevisionDocumentState(
        input: AdvanceServiceRecordRevisionDocumentStateInput,
    ): Promise<ServiceRecordRevisionDocumentState | null> {
        assertUuid(input.branchId, "branch");
        assertClientId(input.clientId);
        assertUuid(input.stateId, "state");
        if (!input.expectedGeneration || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
            throw new ServiceRecordEditConflictError("Revision document CAS input is invalid");
        }
        revisionDocumentStatus(input.status);
        if (!input.step || input.step.length > 80) {
            throw new ServiceRecordEditConflictError("Revision document step is invalid");
        }
        return this.prisma.$transaction((tx) => this.advanceRevisionDocumentStateInTransaction({ tx }, input));
    }

    async advanceRevisionDocumentStateInTransaction(
        context: ServiceRecordEditTransactionContext,
        input: AdvanceServiceRecordRevisionDocumentStateInput,
    ): Promise<ServiceRecordRevisionDocumentState | null> {
        assertUuid(input.branchId, "branch");
        assertClientId(input.clientId);
        assertUuid(input.stateId, "state");
        if (!input.expectedGeneration || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
            throw new ServiceRecordEditConflictError("Revision document CAS input is invalid");
        }
        revisionDocumentStatus(input.status);
        if (!input.step || input.step.length > 80) {
            throw new ServiceRecordEditConflictError("Revision document step is invalid");
        }
        const rows = await selectRevisionDocumentState(context.tx, {
            branchId: input.branchId,
            clientId: input.clientId,
            stateId: input.stateId,
            generation: input.expectedGeneration,
            forUpdate: true,
        });
        const currentRow = rows[0];
        if (!currentRow || currentRow.version !== input.expectedVersion) return null;
        const current = toRevisionDocumentState(currentRow);

        const assertImmutableMatch = (
            supplied: unknown,
            existing: unknown,
            field: string,
        ): void => {
            if (supplied === undefined) return;
            if (JSON.stringify(canonicalize(supplied)) !== JSON.stringify(canonicalize(existing))) {
                throw new ServiceRecordEditConflictError(`Revision document ${field} is immutable`);
            }
        };
        assertImmutableMatch(input.sourceDocumentId, current.sourceDocumentId, "source document");
        assertImmutableMatch(input.templateId, current.templateId, "template");
        assertImmutableMatch(input.templateVersion, current.templateVersion, "template version");
        assertImmutableMatch(input.workflowScope, current.workflowScope, "workflow scope");

        if (input.expectedDocumentVersion !== undefined
            && current.documentVersion !== input.expectedDocumentVersion) return null;
        if (input.expectedTargetDocumentId !== undefined
            && current.targetDocumentId !== input.expectedTargetDocumentId) return null;
        if (input.expectedMirrorGeneration !== undefined
            && current.mirrorGeneration !== input.expectedMirrorGeneration) return null;

        const nextDocumentVersion = input.documentVersion === undefined
            ? current.documentVersion
            : input.documentVersion;
        if (input.documentVersion !== undefined
            && current.documentVersion !== null
            && input.documentVersion !== current.documentVersion) {
            throw new ServiceRecordEditConflictError("Revision document version is immutable");
        }
        const nextTargetDocumentId = input.targetDocumentId === undefined
            ? current.targetDocumentId
            : input.targetDocumentId;
        if (input.targetDocumentId !== undefined
            && current.targetDocumentId !== null
            && input.targetDocumentId !== current.targetDocumentId) {
            throw new ServiceRecordEditConflictError("Revision document target is immutable");
        }
        const nextMirrorGeneration = input.mirrorGeneration === undefined
            ? current.mirrorGeneration
            : input.mirrorGeneration;
        if (input.mirrorGeneration !== undefined
            && current.mirrorGeneration !== null
            && input.mirrorGeneration !== current.mirrorGeneration) {
            throw new ServiceRecordEditConflictError("Revision document mirror generation is immutable");
        }
        const nextOutputProof = input.outputProof === undefined
            ? current.outputProof
            : input.outputProof;
        if (input.outputProof !== undefined
            && current.outputProof !== null
            && JSON.stringify(canonicalize(input.outputProof))
                !== JSON.stringify(canonicalize(current.outputProof))) {
            throw new ServiceRecordEditConflictError("Revision document output proof is immutable");
        }
        const attempts = input.attempts ?? current.attempts;
        if (!Number.isInteger(attempts) || attempts < current.attempts) {
            throw new ServiceRecordEditConflictError("Revision document attempts cannot move backwards");
        }
        const nextAttemptAtSql = input.nextAttemptAt === undefined
            ? Prisma.sql`next_attempt_at`
            : input.nextAttemptAt === null
                ? Prisma.sql`NULL`
                : nullableDateSql(input.nextAttemptAt);
        const lastErrorSql = input.lastErrorCode === undefined
            ? Prisma.sql`last_error_code`
            : nullableSql(input.lastErrorCode);
        const documentVersionSql = nextDocumentVersion === null
            ? Prisma.sql`NULL`
            : Prisma.sql`${nextDocumentVersion}`;
        const targetDocumentIdSql = nextTargetDocumentId === null
            ? Prisma.sql`NULL`
            : Prisma.sql`${nextTargetDocumentId}`;
        const mirrorGenerationSql = nextMirrorGeneration === null
            ? Prisma.sql`NULL`
            : Prisma.sql`${nextMirrorGeneration}`;
        const outputProofSql = nextOutputProof === null
            ? Prisma.sql`NULL`
            : jsonSql(nextOutputProof as unknown as ServiceRecordEditJsonValue);
        const updated = await rawStateQuery<RevisionDocumentStateRow[]>(context.tx, Prisma.sql`
            UPDATE "service_record_revision_document_state"
            SET step = ${input.step},
                status = ${input.status},
                attempts = ${attempts},
                next_attempt_at = ${nextAttemptAtSql},
                last_error_code = ${lastErrorSql},
                document_version = ${documentVersionSql},
                target_document_id = ${targetDocumentIdSql},
                mirror_generation = ${mirrorGenerationSql},
                output_proof = ${outputProofSql},
                version = version + 1,
                updated_at = now()
            WHERE id = ${input.stateId}::uuid
              AND branch_id = ${input.branchId}::uuid
              AND client_id = ${input.clientId}
              AND generation = ${input.expectedGeneration}
              AND version = ${input.expectedVersion}
            RETURNING ${revisionDocumentStateColumns}
        `);
        const row = updated[0];
        return row ? toRevisionDocumentState(row) : null;
    }

    async retryRevisionDocumentState(
        input: RetryServiceRecordRevisionDocumentInput,
    ): Promise<ServiceRecordRevisionDocumentState | null> {
        assertUuid(input.branchId, "branch");
        assertClientId(input.clientId);
        assertUuid(input.revisionId, "revision");
        assertUuid(input.stateId, "state");
        if (!input.expectedGeneration) {
            throw new ServiceRecordEditConflictError("Revision document generation is required");
        }
        return this.prisma.$transaction((tx) => this.retryRevisionDocumentStateInTransaction({ tx }, input));
    }

    async retryRevisionDocumentStateInTransaction(
        context: ServiceRecordEditTransactionContext,
        input: RetryServiceRecordRevisionDocumentInput,
    ): Promise<ServiceRecordRevisionDocumentState | null> {
        assertUuid(input.branchId, "branch");
        assertClientId(input.clientId);
        assertUuid(input.revisionId, "revision");
        assertUuid(input.stateId, "state");
        if (!input.expectedGeneration) {
            throw new ServiceRecordEditConflictError("Revision document generation is required");
        }
        const rows = await selectRevisionDocumentState(context.tx, {
            branchId: input.branchId,
            clientId: input.clientId,
            revisionId: input.revisionId,
            stateId: input.stateId,
            generation: input.expectedGeneration,
            forUpdate: true,
        });
        const currentRow = rows[0];
        if (!currentRow) return null;
        const current = toRevisionDocumentState(currentRow);
        if (!canRetryRevisionDocumentState(currentRow)) return current;

        const updated = await rawStateQuery<RevisionDocumentStateRow[]>(context.tx, Prisma.sql`
            UPDATE "service_record_revision_document_state"
            SET step = 'retry_requested',
                status = 'pending',
                attempts = attempts + 1,
                next_attempt_at = NULL,
                last_error_code = NULL,
                version = version + 1,
                updated_at = now()
            WHERE id = ${input.stateId}::uuid
              AND branch_id = ${input.branchId}::uuid
              AND client_id = ${input.clientId}
              AND revision_id = ${input.revisionId}::uuid
              AND generation = ${input.expectedGeneration}
              AND version = ${current.version}
              AND status IN ('failed', 'manual_review')
              AND step NOT IN ('creating', 'sent', 'reconciling', 'unknown')
            RETURNING ${revisionDocumentStateColumns}
        `);
        const row = updated[0];
        return row ? toRevisionDocumentState(row) : current;
    }

    async confirmDraft(input: ServiceRecordEditConfirmInput): Promise<ServiceRecordEditConfirmResponse> {
        return this.prisma.$transaction((tx) => this.confirmDraftWithClient(tx, input));
    }

    private async confirmDraftWithClient(
        tx: Prisma.TransactionClient,
        input: ServiceRecordEditConfirmInput,
    ): Promise<ServiceRecordEditConfirmResponse> {
        // Discovery is branch-scoped and intentionally happens before the
        // common lock sequence. A confirmed row can replay without reading
        // mutable case/provider state at all.
        const discovered = await this.findDraftByIdWithClient(tx, input.branchId, input.draftId);
        if (!discovered) throw new ServiceRecordEditNotFoundError();
        if (discovered.status === "CONFIRMED") {
            if (discovered.confirmationIdempotencyKey !== input.idempotencyKey) {
                throw new ServiceRecordEditDraftConflictError("The service-record draft is already confirmed");
            }
            if (discovered.confirmationFingerprint !== input.requestFingerprint) {
                throw new ServiceRecordEditDraftConflictError("The confirmation idempotency key was reused with different input");
            }
            const replay = parseConfirmationResponse(discovered.confirmationResponse);
            if (!replay) throw new ServiceRecordEditConflictError("The stored confirmation result is invalid");
            return replay;
        }
        if (discovered.status !== "ACTIVE") {
            throw new ServiceRecordEditDraftConflictError("The service-record draft is already closed");
        }

        const discoveredSource = await this.loadSourceWithClient(
            tx,
            input.branchId,
            { caseId: discovered.serviceRecordCaseId },
        );
        if (!discoveredSource) throw new ServiceRecordEditNotFoundError();
        await this.lockConfirmTargets(tx, input.branchId, discoveredSource, input.draftId);

        // The parent/case/employee locks serialize all cooperating writers.
        // Re-read every business row after those locks and reject a writer
        // that changed ownership while it was waiting instead of acquiring a
        // second, potentially inverted lock set.
        const draft = await this.findDraftByIdWithClient(tx, input.branchId, input.draftId);
        if (!draft) throw new ServiceRecordEditNotFoundError();
        if (draft.status !== "ACTIVE") {
            if (
                draft.status === "CONFIRMED"
                && draft.confirmationIdempotencyKey === input.idempotencyKey
                && draft.confirmationFingerprint === input.requestFingerprint
            ) {
                const replay = parseConfirmationResponse(draft.confirmationResponse);
                if (replay) return replay;
            }
            throw new ServiceRecordEditDraftConflictError("The service-record draft is already closed");
        }
        if (draft.draftVersion !== input.expectedDraftVersion) {
            throw new ServiceRecordEditDraftConflictError();
        }
        const source = await this.loadSourceWithClient(tx, input.branchId, { caseId: draft.serviceRecordCaseId });
        if (!source) throw new ServiceRecordEditNotFoundError();
        if (
            source.client.id !== discoveredSource.client.id
            || source.caseId !== discoveredSource.caseId
            || !sameSortedNumbers(
                source.assignments.map((assignment) => assignment.scheduleId).filter((id): id is number => id !== null),
                discoveredSource.assignments.map((assignment) => assignment.scheduleId).filter((id): id is number => id !== null),
            )
            || !sameSortedNumbers(
                source.assignments.map((assignment) => assignment.employeeId).filter((id): id is number => id !== null),
                discoveredSource.assignments.map((assignment) => assignment.employeeId).filter((id): id is number => id !== null),
            )
        ) {
            throw new ServiceRecordEditConflictError("Service-record ownership changed while confirmation was waiting");
        }

        const snapshot: ServiceRecordEditConfirmSnapshot = { draft, source };
        const plan = await input.prepare(snapshot);
        if (plan.caseId !== source.caseId || plan.clientId !== source.client.id) {
            throw new ServiceRecordEditConflictError("Confirmation plan does not match the locked source");
        }
        if (!/^[0-9a-f]{64}$/i.test(plan.sourceFingerprint)) {
            throw new ServiceRecordEditConflictError("Confirmation plan source fingerprint is invalid");
        }
        assertFutureSessionPlan(plan, source);

        const now = new Date();
        let revision: ServiceRecordRevision | null = null;
        let caseVersion = source.caseVersion;
        const documentStatus = plan.status === "no_changes" ? "not_required" : plan.documentStatus;
        if (plan.status === "confirmed") {
            if (plan.revision) {
                revision = await this.appendRevisionWithClient(tx, plan.revision);
            }
            const caseUpdate = await tx.service_record_case.update({
                where: { id: source.caseId },
                data: {
                    startDate: dateValue(plan.startDate),
                    endDate: dateValue(plan.endDate),
                    requiredSessionCount: plan.requiredSessionCount,
                    plannedSessions: plan.plannedSessions === null ? Prisma.JsonNull : toPrismaJson(plan.plannedSessions),
                    momName: plan.header.momName,
                    momBirth: plan.header.momBirth,
                    babyName: plan.header.babyName,
                    babyBirth: plan.header.babyBirth,
                    deliveryType: plan.header.deliveryType,
                    babyWeight: plan.header.babyWeight,
                    ...(revision ? { currentRevisionId: revision.id } : {}),
                    version: { increment: 1 },
                },
                select: { version: true },
            });
            caseVersion = caseUpdate.version;

            await tx.client.updateMany({
                where: { id: source.client.id, branchId: input.branchId },
                data: {
                    startDate: dateValue(plan.startDate),
                    endDate: dateValue(plan.endDate),
                },
            });
            for (const session of plan.sessions) {
                await tx.service_record_day.updateMany({
                    where: { id: session.sourceRowId, branchId: input.branchId, serviceRecordCaseId: source.caseId },
                    data: {
                        serviceDate: dateValue(session.serviceDate) ?? undefined,
                        answers: toPrismaJson(session.answers),
                        etcService: session.etcService,
                        notes: session.notes,
                        paymentConfirmed: session.paymentConfirmed,
                    },
                });
            }
            for (const session of plan.newSessions) {
                const serviceDate = dateValue(session.serviceDate);
                if (!serviceDate) {
                    throw new ServiceRecordEditConflictError("Future session service date is invalid");
                }
                await tx.service_record_day.create({
                    data: {
                        id: session.sourceRowId,
                        branchId: input.branchId,
                        scheduleId: session.scheduleId,
                        serviceRecordCaseId: source.caseId,
                        caseSessionIndex: session.sessionIndex,
                        employeeId: session.employeeId,
                        employeeNameSnapshot: session.employeeNameSnapshot,
                        formVersion: session.formVersion,
                        sessionIndex: session.sessionIndex,
                        serviceDate,
                        answers: toPrismaJson(session.answers),
                        etcService: session.etcService,
                        notes: session.notes,
                        paymentConfirmed: session.paymentConfirmed,
                        momApproval: null,
                        clientSignature: null,
                        clientSignedAt: null,
                        locked: false,
                        submittedAt: null,
                    },
                });
            }
            for (const assignment of plan.assignments) {
                if (assignment.assignmentId) {
                    await tx.service_record_assignment.updateMany({
                        where: { id: assignment.assignmentId, branchId: input.branchId, serviceRecordCaseId: source.caseId },
                        data: {
                            ...(dateValue(assignment.startDate) ? { startDate: dateValue(assignment.startDate)! } : {}),
                            ...(dateValue(assignment.endDate) ? { endDate: dateValue(assignment.endDate)! } : {}),
                        },
                    });
                }
                if (assignment.scheduleId !== null) {
                    await tx.employee_schedule.updateMany({
                        where: { id: assignment.scheduleId, branchId: input.branchId },
                        data: {
                            ...(dateValue(assignment.startDate) ? { startDate: dateValue(assignment.startDate)! } : {}),
                            ...(dateValue(assignment.endDate) ? { endDate: dateValue(assignment.endDate)! } : {}),
                        },
                    });
                }
            }
            if (plan.endDate) {
                await tx.service_record_token.updateMany({
                    where: { branchId: input.branchId, serviceRecordCaseId: source.caseId, active: true, revokedAt: null },
                    data: { expiresAt: getServiceRecordTokenExpiresAt(dateValue(plan.endDate)!) },
                });
            }
            await this.invalidateSupersededJobs(tx, input.branchId, source.caseId, source.client.id);
            await this.persistReevaluationIntents(tx, input.branchId, source.client.id, plan.assignments, now);
            if (revision && plan.documentJob && plan.dispatchContext) {
                const generation = randomUUID();
                const documentState = await this.createRevisionDocumentStateInTransaction({ tx }, {
                    branchId: input.branchId,
                    clientId: source.client.id,
                    serviceRecordCaseId: source.caseId,
                    revisionId: revision.id,
                    operation: "record_snapshot",
                    generation,
                    immutableInput: revision.payload,
                    inputFingerprint: jsonFingerprint(revision.payload),
                    workflowScope: {
                        requestKey: plan.documentJob.requestKey,
                        activeKey: plan.documentJob.activeKey,
                        caseVersion,
                        formVersion: source.formVersion,
                    },
                    step: plan.documentStatus === "waiting_for_completion"
                        ? "waiting_for_completion"
                        : "capability_unverified",
                    status: plan.documentStatus === "waiting_for_completion"
                        ? "waiting_for_completion"
                        : "capability_unverified",
                    lastErrorCode: plan.documentStatus === "waiting_for_completion"
                        ? "SERVICE_RECORD_REVISION_WAITING_FOR_COMPLETION"
                        : "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
                });
                // Partial revisions are intentionally retained as waiting
                // operation state. They have no provider job to claim until
                // all N sessions are genuinely submitted; a queued partial
                // job would otherwise be mistaken for an executable provider
                // intent by older workers.
                if (plan.documentJob.payload["completeness"] !== "partial") {
                    await this.enqueueRevisionJob(
                        tx,
                        input,
                        plan,
                        revision,
                        caseVersion,
                        generation,
                        documentState.id,
                    );
                }
            }
        }

        const response: ServiceRecordEditConfirmResponse = {
            status: plan.status,
            caseId: source.caseId,
            clientId: source.client.id,
            draftId: input.draftId,
            draftVersion: draft.draftVersion + 1,
            caseVersion,
            revisionId: revision?.id ?? null,
            revisionNumber: revision?.revisionNumber ?? null,
            documentStatus,
            confirmedAt: now.toISOString(),
        };
        const persisted = await tx.service_record_edit_draft.updateMany({
            where: {
                id: input.draftId,
                branchId: input.branchId,
                serviceRecordCaseId: source.caseId,
                status: "ACTIVE",
                draftVersion: input.expectedDraftVersion,
            },
            data: {
                status: "CONFIRMED",
                confirmedByUserId: input.actorUserId,
                confirmedAt: now,
                confirmationIdempotencyKey: input.idempotencyKey,
                confirmationFingerprint: input.requestFingerprint,
                confirmationResponse: toPrismaJson(jsonValueForConfirmation(response)),
                updatedByUserId: input.actorUserId,
                draftVersion: { increment: 1 },
            },
        });
        if (persisted.count !== 1) throw new ServiceRecordEditDraftConflictError();
        return response;
    }

    /**
     * Confirmation invalidates old pending work and leaves a durable marker
     * for the existing automation reconciler to recalculate future jobs. The
     * marker is written in this transaction so any later failure rolls it back
     * with the case, day, revision, and draft writes.
     */
    private async persistReevaluationIntents(
        tx: Prisma.TransactionClient,
        branchId: string,
        clientId: number,
        assignments: ServiceRecordEditConfirmPlan["assignments"],
        intentAt: Date,
    ): Promise<void> {
        const transaction = tx as unknown as {
            message_trigger_rule?: { upsert?: unknown };
            message_trigger_job?: { upsert?: unknown };
        };
        // Narrow unit doubles used by older repository tests do not expose the
        // message delegates. A real Prisma transaction always does, and the
        // production path therefore remains durable and atomic.
        if (
            typeof transaction.message_trigger_rule?.upsert !== "function"
            || typeof transaction.message_trigger_job?.upsert !== "function"
        ) {
            return;
        }
        await persistClientMessageAutomationIntent(tx, {
            branchId,
            clientId,
            includePast: false,
            suppressGreeting: true,
            intentAt,
        });
        const scheduleIds = [...new Set(
            assignments
                .map((assignment) => assignment.scheduleId)
                .filter((scheduleId): scheduleId is number => (
                    typeof scheduleId === "number"
                    && Number.isInteger(scheduleId)
                    && scheduleId > 0
                )),
        )].sort((left, right) => left - right);
        for (const scheduleId of scheduleIds) {
            await persistScheduleMessageAutomationIntent(tx, {
                branchId,
                clientId,
                scheduleId,
                includePast: false,
                intentAt,
            });
        }
    }

    private async lockConfirmTargets(
        tx: Prisma.TransactionClient,
        branchId: string,
        source: ServiceRecordEditSource,
        draftId: string,
    ): Promise<void> {
        // Common order: client -> sorted employees -> case -> sorted child
        // schedules/assignments/days/docs -> draft -> revision/jobs.
        await lockRowsByBranchAndIds(tx, "client", "client", branchId, [source.client.id], false);
        const employeeIds = source.assignments.flatMap((assignment) => [
            assignment.employeeId,
            assignment.primaryEmployeeId,
            assignment.secondaryEmployeeId,
        ]).filter((id): id is number => id !== null).sort((left, right) => left - right);
        await lockRowsByBranchAndIds(tx, "employee", "employee", branchId, [...new Set(employeeIds)], false);
        await lockRowsByBranchAndIds(tx, "service_record_case", "service_record_case", branchId, [source.caseId], true);

        const scheduleIds = source.assignments
            .map((assignment) => assignment.scheduleId)
            .filter((id): id is number => id !== null)
            .sort((left, right) => left - right);
        await lockRowsByBranchAndIds(tx, "employee_schedule", "employee_schedule", branchId, [...new Set(scheduleIds)], false);
        await lockCaseChildren(tx, branchId, source.caseId, "service_record_assignment", "service_record_assignment", "service_record_case_id");
        await lockCaseChildren(tx, branchId, source.caseId, "service_record_day", "service_record_day", "service_record_case_id");
        await lockCaseChildren(tx, branchId, source.caseId, "eformsign_doc", "eformsign_doc", "service_record_case_id");
        await lockClientOwnedContractDocuments(tx, branchId, source.client.id);

        await lockRowsByBranchAndIds(tx, "service_record_edit_draft", "service_record_edit_draft", branchId, [draftId], true);
        await lockCaseChildren(tx, branchId, source.caseId, "service_record_revision", "service_record_revision", "service_record_case_id");

        const transaction = tx as OptionalQueryTransaction;
        if (typeof transaction.$queryRaw === "function") {
            await transaction.$queryRaw(Prisma.sql`
                SELECT job.id
                FROM "eformsign_document_job" AS job
                WHERE ${eformsignDocumentJobOwnershipPredicate(branchId, source.client.id)}
                FOR UPDATE
            `);
            await transaction.$queryRaw(Prisma.sql`
                SELECT id
                FROM "message_trigger_job"
                WHERE branch_id = ${branchId}::uuid
                  AND client_id = ${source.client.id}
                FOR UPDATE
            `);
        } else {
            const jobs = tx as unknown as {
                eformsign_document_job?: { findMany?: (args: unknown) => Promise<unknown> };
                message_trigger_job?: { findMany?: (args: unknown) => Promise<unknown> };
            };
            const ownedDocumentIds = await findClientOwnedLegacyDocumentIds(tx, branchId, source.client.id);
            await jobs.eformsign_document_job?.findMany?.({
                where: {
                    OR: [
                        { branchId, clientId: source.client.id },
                        ...(ownedDocumentIds.length > 0
                            ? [{ branchId, clientId: null, documentId: { in: ownedDocumentIds } }]
                            : []),
                    ],
                },
                select: { id: true },
            });
            await jobs.message_trigger_job?.findMany?.({
                where: { branchId, clientId: source.client.id },
                select: { id: true },
            });
        }
    }

    private async invalidateSupersededJobs(
        tx: Prisma.TransactionClient,
        branchId: string,
        caseId: string,
        clientId: number,
    ): Promise<void> {
        // Legacy create/finalize jobs do not carry a case id in their payload.
        // lockConfirmTargets already locked every eformsign job owned by this
        // branch/client, so use that durable ownership fence instead of a
        // payload-only case predicate that would let an active provider job
        // race confirmation. `caseId` remains part of the private seam for
        // callers/tests and the parent case is already locked above.
        void caseId;
        const transaction = tx as OptionalQueryTransaction;
        if (typeof transaction.$queryRaw === "function") {
            // Once a provider worker has crossed its irreversible boundary,
            // confirmation must not mark that work stale in the same
            // transaction.  The row lock makes the decision deterministic
            // against a worker that is claiming at the same time; the caller
            // receives a conflict and the draft/case writes roll back.
            const inFlightDocuments = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT job.id
                FROM "eformsign_document_job" AS job
                WHERE ${eformsignDocumentJobOwnershipPredicate(branchId, clientId)}
                  AND job.job_type IN ('create_document', 'finalize_document')
                  AND job.status IN ('processing', 'reconciling')
                  AND job.progress_step IN ('creating', 'sent')
                FOR UPDATE OF job
            `);
            if (inFlightDocuments.length > 0) {
                throw new ServiceRecordEditConflictError(
                    "A service-record document dispatch is already irreversible",
                );
            }
            const inFlightMessages = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT id
                FROM "message_trigger_job"
                WHERE branch_id = ${branchId}::uuid
                  AND client_id = ${clientId}
                  AND status = 'dispatching'
                FOR UPDATE
            `);
            if (inFlightMessages.length > 0) {
                throw new ServiceRecordEditConflictError(
                    "A service-record message dispatch is already irreversible",
                );
            }
            await transaction.$queryRaw(Prisma.sql`
                UPDATE "eformsign_document_job" AS job
                SET status = 'failed',
                    last_error_code = 'SERVICE_RECORD_REVISION_SUPERSEDED',
                    active_key = NULL,
                    payload = CASE
                        WHEN jsonb_typeof(job.payload) = 'object'
                            AND job.payload->>'kind' = 'service_record_revision' THEN job.payload
                        ELSE NULL
                    END,
                    heartbeat_at = NULL,
                    lease_token = NULL,
                    completed_at = now(),
                    updated_at = now()
                WHERE ${eformsignDocumentJobOwnershipPredicate(branchId, clientId)}
                  AND job.job_type IN ('create_document', 'finalize_document')
                  AND job.status IN ('queued', 'processing', 'reconciling')
            `);
            await transaction.$queryRaw(Prisma.sql`
                UPDATE "message_trigger_job"
                SET status = 'canceled',
                    canceled_at = now(),
                    cancel_reason = 'SERVICE_RECORD_REVISION_SUPERSEDED',
                    canceled_by_user = false,
                    claim_token = NULL,
                    updated_at = now()
                WHERE branch_id = ${branchId}::uuid
                  AND client_id = ${clientId}
                  AND status IN ('pending', 'processing')
            `);
            return;
        }
        const fallback = tx as unknown as {
            eformsign_document_job?: {
                findMany?: (args: unknown) => Promise<Array<{
                    id?: string;
                    progressStep?: string;
                    status?: string;
                    payload?: unknown;
                }>>;
                updateMany?: (args: unknown) => Promise<unknown>;
            };
            message_trigger_job?: {
                findMany?: (args: unknown) => Promise<Array<{ id?: string; status?: string }>>;
                updateMany?: (args: unknown) => Promise<unknown>;
            };
        };
        const ownedDocumentIds = await findClientOwnedLegacyDocumentIds(tx, branchId, clientId);
        const ownedDocumentPredicate = [
            { branchId, clientId },
            ...(ownedDocumentIds.length > 0
                ? [{ branchId, clientId: null, documentId: { in: ownedDocumentIds } }]
                : []),
        ];
        const inFlightDocuments = await fallback.eformsign_document_job?.findMany?.({
            where: {
                OR: ownedDocumentPredicate,
                jobType: { in: ["create_document", "finalize_document"] },
                status: { in: ["processing", "reconciling"] },
                progressStep: { in: ["creating", "sent"] },
            },
            select: { id: true, status: true, progressStep: true },
        }) ?? [];
        if (inFlightDocuments.length > 0) {
            throw new ServiceRecordEditConflictError(
                "A service-record document dispatch is already irreversible",
            );
        }
        const inFlightMessages = await fallback.message_trigger_job?.findMany?.({
            where: { branchId, clientId, status: "dispatching" },
            select: { id: true, status: true },
        }) ?? [];
        if (inFlightMessages.length > 0) {
            throw new ServiceRecordEditConflictError(
                "A service-record message dispatch is already irreversible",
            );
        }
        const cancellableDocuments = await fallback.eformsign_document_job?.findMany?.({
            where: {
                OR: ownedDocumentPredicate,
                status: { in: ["queued", "processing", "reconciling"] },
            },
            select: { id: true, payload: true },
        }) ?? [];
        const revisionDocumentIds = cancellableDocuments
            .filter((document): document is { id: string; payload?: unknown } => (
                typeof document.id === "string"
                && isRevisionDocumentJobPayload(document.payload)
            ))
            .map((document) => document.id);
        const legacyDocumentIds = cancellableDocuments
            .filter((document): document is { id: string; payload?: unknown } => (
                typeof document.id === "string"
                && !isRevisionDocumentJobPayload(document.payload)
            ))
            .map((document) => document.id);
        const cancellationData = {
            status: "failed",
            lastErrorCode: "SERVICE_RECORD_REVISION_SUPERSEDED",
            activeKey: null,
            heartbeatAt: null,
            leaseToken: null,
            completedAt: new Date(),
        };
        if (revisionDocumentIds.length > 0) {
            await fallback.eformsign_document_job?.updateMany?.({
                where: { id: { in: revisionDocumentIds } },
                data: cancellationData,
            });
        }
        if (legacyDocumentIds.length > 0) {
            await fallback.eformsign_document_job?.updateMany?.({
                where: { id: { in: legacyDocumentIds } },
                data: { ...cancellationData, payload: null },
            });
        }
        await fallback.message_trigger_job?.updateMany?.({
            where: { branchId, clientId, status: { in: ["pending", "processing"] } },
            data: {
                status: "canceled",
                canceledAt: new Date(),
                cancelReason: "SERVICE_RECORD_REVISION_SUPERSEDED",
                canceledByUser: false,
                claimToken: null,
            },
        });
    }

    private async enqueueRevisionJob(
        tx: Prisma.TransactionClient,
        input: ServiceRecordEditConfirmInput,
        plan: ServiceRecordEditConfirmPlan,
        revision: ServiceRecordRevision,
        caseVersion: number,
        generation: string,
        documentStateId: string,
    ): Promise<void> {
        if (!plan.documentJob || !plan.dispatchContext) return;
        const context = {
            ...plan.dispatchContext,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
        } satisfies ServiceRecordRevisionDispatchContext;
        const payload = {
            ...plan.documentJob.payload,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
            caseVersion,
            generation,
            documentStateId,
            context,
        };
        const payloadFingerprint = jsonFingerprint(payload);
        const transaction = tx as OptionalQueryTransaction;
        if (typeof transaction.$queryRaw === "function") {
            const inserted = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                INSERT INTO "eformsign_document_job" (
                    branch_id, client_id, job_type, source, status, request_key,
                    active_key, payload, payload_fingerprint, created_by_user_id
                ) VALUES (
                    ${input.branchId}::uuid, ${plan.clientId}, 'create_document', 'staff', 'queued',
                    ${plan.documentJob.requestKey}, ${plan.documentJob.activeKey},
                    ${JSON.stringify(payload)}::jsonb, ${payloadFingerprint}, ${input.actorUserId}::uuid
                )
                ON CONFLICT DO NOTHING
                RETURNING id
            `);
            if (inserted.length > 0) return;
            const existing = await transaction.$queryRaw<Array<{ id: string; request_key: string; payload_fingerprint: string | null }>>(Prisma.sql`
                SELECT id, request_key, payload_fingerprint
                FROM "eformsign_document_job"
                WHERE request_key = ${plan.documentJob.requestKey}
                   OR active_key = ${plan.documentJob.activeKey}
                ORDER BY CASE WHEN request_key = ${plan.documentJob.requestKey} THEN 0 ELSE 1 END
                LIMIT 1
            `);
            if (!existing[0]
                || existing[0].request_key !== plan.documentJob.requestKey
                || existing[0].payload_fingerprint !== payloadFingerprint) {
                throw new ServiceRecordEditConflictError("The revision document job key was reused with different input");
            }
            return;
        }
        const delegate = tx.eformsign_document_job;
        const existing = await delegate.findFirst({
            where: {
                OR: [
                    { requestKey: plan.documentJob.requestKey },
                    { activeKey: plan.documentJob.activeKey },
                ],
            },
        });
        if (existing) {
            if (existing.requestKey !== plan.documentJob.requestKey
                || existing.payloadFingerprint !== payloadFingerprint) {
                throw new ServiceRecordEditConflictError("The revision document job key was reused with different input");
            }
            return;
        }
        await delegate.create({
            data: {
                branchId: input.branchId,
                clientId: plan.clientId,
                documentId: null,
                jobType: "create_document",
                source: "staff",
                status: "queued",
                requestKey: plan.documentJob.requestKey,
                activeKey: plan.documentJob.activeKey,
                payload: payload as unknown as Prisma.InputJsonValue,
                payloadFingerprint,
                createdByUserId: input.actorUserId,
            },
        });
    }

    private async assertCaseBelongsToBranchWithClient(
        client: DraftLockClient,
        branchId: string,
        serviceRecordCaseId: string,
    ): Promise<void> {
        const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT id
            FROM service_record_case
            WHERE id = ${serviceRecordCaseId}::uuid
              AND branch_id = ${branchId}::uuid
            FOR UPDATE
        `);
        if (rows.length !== 1) throw new ServiceRecordEditNotFoundError();
    }
}
