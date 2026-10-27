import { BadRequestException, ConflictException, Injectable, Inject, Logger, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
    eformsignCustomerPhone,
    extractEformsignContractEndDate,
    extractEformsignContractClientCandidate,
    toEformsignDocumentDetail,
} from "application/utils/eformsign-contract-client-candidate";
import { compareEformsignClientIdentity } from "application/utils/eformsign-client-identity";
import {
    CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD,
    findLatestContractSignalsByClientId,
    isActiveContractSignal,
    isVoidedContractSignal,
    isContractSendRequired,
    type LatestContractSignal,
} from "application/utils/current-contract-document";
import { resolveEformsignDocDisplayStatus } from "application/utils/eformsign-doc-display-status";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import {
    configuredServiceRecordTemplateIds,
    isServiceRecordEformsignDocument,
} from "application/utils/eformsign-document-kind";
import { extractPhoneCandidates, normalizePhone } from "application/utils/normalize-phone";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    ListClientsPaginatedUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc";
import {
    assertAllowedClientArea,
    assertAllowedServiceStatus,
    assertClientDurationMatchesDates,
    assertClientPhoneInput,
    clientCodeOnlyProblemBody,
    clientProblemBody,
    deriveClientDuration,
    findClientByNormalizedPhone,
    mergeAndValidateClientServicePeriod,
    parseClientDate,
    PRE_BOOKING_REPLACEMENT_REFUSAL_DETAIL,
    resolveSavedServiceStatus,
} from "application/usecases/client/client-write-validation";
import {
    assertEmployeeAssignmentEligibility,
    assertEmployeeAssignmentShape,
    type EmployeeAssignmentCandidate,
} from "application/policies/employee-assignment-eligibility.policy";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import {
    assertNoActiveEmployeeScheduleOverlap,
    employeeScheduleHandoverPeriod,
    employeeScheduleReplacementEndDate,
    lockEmployeesForScheduleWrite,
} from "application/policies/employee-schedule-invariants.policy";
import {
    lockServiceRecordWriteSet,
} from "application/policies/service-record-write-lock.policy";
import {
    ClientEntity,
    clientDurationOutOfRangeMessage,
    CLIENT_DURATION_NEEDS_SERVICE_PERIOD_MESSAGE,
    mergeServiceDayPolicy,
    serviceDayPolicyOf,
} from "domain/entities/client.entity";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import {
    CLIENT_REPOSITORY,
    ClientListSummary,
    ClientListTab,
    getClientListDateRanges,
    getEffectiveClientServiceStatus,
    IClientRepository,
} from "domain/repositories/client.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { normalizeClientPricing } from "domain/services/client-pricing";
import { isoDateInKorea, type KrBusinessDayCalendar } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    computeServiceStatus,
    isAutomaticServiceStatusTransitionAllowed,
    SERVICE_STATUS,
    ServiceStatusType,
} from "domain/value-objects/service-status.vo";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { isRevokeRequestedStatus } from "domain/constants/eformsign-doc-status.constants";
import {
    EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES,
    isEformsignAutoLinkEligibleStatus,
} from "domain/constants/eformsign-auto-link-status";
import {
    COMPLETED_DOCUMENT_STATUS_TYPES,
    CREATED_DOCUMENT_STATUS_TYPES,
    hasCustomerSigned,
    OPENED_DOCUMENT_STATUS_TYPES,
    REQUESTED_DOCUMENT_STATUS_TYPES,
} from "domain/utils/eformsign-customer-signature";
import { MessageTriggerService } from "./message-trigger.service";
import { MessageAutomationIntentService } from "./message-automation-intent.service";
import { ServiceRecordLinkService } from "./service-record-link.service";
import { IMMUTABLE_FINALIZATION_STATUSES, ServiceRecordLifecycleService } from "./service-record-lifecycle.service";
import { SystemSettingService } from "./system-setting.service";
import { MessageAutomationBranchLockService } from "./message-automation-branch-lock.service";
import { AgentAutomationRecordStoreService } from "../agent/agent-automation-record-store.service";
import { CLIENT_AUTOMATION_IMPACT, type ClientAutomationImpactPort } from "domain/ports/client-automation-impact.port";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { HolidayCalendarService } from "application/services/holiday-calendar.service";
import { getKstCalendarDate } from "application/services/message-trigger-recipes";

const FILTER_DAYS_THRESHOLD = 7;
// 071 (a reviewer rejection, 계약-04) is deliberately absent: the document is live — a later 070/072
// follows and the customer's signature is valid — so it reads "requested" like 070.
const REJECTED_DOCUMENT_STATUS_TYPES = new Set(["011", "021", "031", "061", "080"]);
// 040/045 (cancellation REQUESTED, not done) are deliberately absent: they are their own
// non-terminal "revoke_requested" status (see isRevokeRequestedStatus).
const REVOKED_DOCUMENT_STATUS_TYPES = new Set(["042", "090"]);
// Exported so repository/provider filters exclude the same stored deletion codes
// (the stored value is never the literal "deleted").
export const DELETED_DOCUMENT_STATUS_TYPES = new Set(["047", "049", "099"]);
const CONTRACT_AUTO_REGISTRATION_SOURCE = "contract_auto_registration";
const DEFAULT_SERVICE_PERIOD_MS = 365 * 24 * 60 * 60 * 1000;
const PHONE_LOOKUP_SUFFIX_LENGTH = 4;
const PHONE_LINK_LOCK_RETRY_LIMIT = 3;
/** Returned by a phone-link attempt whose locked client set no longer matches the document owners. */
const PHONE_LINK_LOCK_SET_CHANGED = Symbol("PHONE_LINK_LOCK_SET_CHANGED");

// Document status type for eformsign documents
// Maps to eformsign_doc.statusType values:
// - 003/050: completed (완료)
// - 010: created (문서 생성됨)
// - 020: opened (서명 페이지 열림)
// - 060: requested (서명 요청됨/진행중)
// - 080: rejected (거부됨)
// - 060/041: requested (041 = a refused revoke; the document continues exactly like 060)
// - 040/045: revoke_requested (철회 요청됨 — cancellation requested, not done; eformsign may
//   still refuse it and the signer may continue, so it is non-terminal)
// - 042/090: revoked (철회됨)
// - 099: deleted (삭제됨)
export type DocumentStatusType = 'created' | 'opened' | 'completed' | 'requested' | 'revoke_requested' | 'rejected' | 'revoked' | 'deleted' | 'voided' | null;
// A document in one of these states is still "alive" — the client already has
// a contract in flight (or finished), so the "계약서 필요" signal must not fire
// even if it is unsigned. A pending cancellation (revoke_requested) is still a live
// contract until eformsign actually revokes it. Everything else (rejected/revoked/
// deleted/no document at all) is a dead document and falls back to the "발송 필요" check.
// `voided` (계약 파기) is dead too: it is deliberately absent from this set.
const ACTIVE_DOCUMENT_STATUSES = new Set<DocumentStatusType>(["created", "requested", "revoke_requested", "opened", "completed"]);
export type ClientBadgeKey = "contract_required" | "contract_status" | "breast_pump" | "service_status" | "care_center";
export type ClientBadgeTone = "danger" | "success" | "primary" | "warning" | "neutral";
export type ClientBadgeStatus =
    | "active"
    | "preBooking"
    | "pending"
    | "review"
    | "terminated"
    | "expired"
    | "completed"
    | "signed"
    | "breastPump"
    | "careCenter";

export interface ClientBadge {
    key: ClientBadgeKey;
    status: ClientBadgeStatus;
    label: string;
    tone: ClientBadgeTone;
    priority: number;
}

export interface PendingScheduleChange {
    id: string;
    sessionIndex: number;
    fromDate: string;
    toDate: string;
    oldEndDate: string;
    newEndDate: string;
}

// Response type that includes employee information
export interface ClientWithEmployees {
    id: number;
    name: string;
    createdAt: Date | null;
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
    bookingConfirmedAt: string | null;
    breastPump: boolean;
    allowSaturdayService: boolean;
    allowSundayService: boolean;
    allowHolidayService: boolean;
    eDocId: string | null;
    areaId: string | null;
    smsAutomationEnabled: boolean;
    hasSigned: boolean;
    documentStatus: DocumentStatusType;
    /** ID of the same latest contract used for documentStatus. */
    latestContractDocumentId?: string | null;
    badges: ClientBadge[];
    actionRequired: ClientActionRequired | null;
    /** 서비스 기록이 확정 단계라 시작일·종료일·서비스 기간을 바꿀 수 없어요. */
    serviceRecordPeriodLocked?: boolean;
    primaryEmployee: { id: number; name: string; phone: string | null } | null;
    secondaryEmployee: { id: number; name: string; phone: string | null } | null;
    pendingScheduleChange?: PendingScheduleChange | null;
}

export interface PaginatedClientWithEmployees {
    data: ClientWithEmployees[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export type ActionRequiredReason = "교체 요청" | "서명 필요" | "발송 필요";

export interface ClientActionRequired {
    reason: ActionRequiredReason;
    priority: 1 | 2 | 3;
}

export interface ClientActionRequiredAlert extends ClientActionRequired {
    id: number;
    name: string;
    createdAt: Date | null;
}

export interface DashboardOverview {
    stats: {
        activeClients: number;
        contractsNotSent: number;
        contractsPendingSignature: number;
        upcomingThisMonth: number;
        upcomingNextMonth: number;
    };
    clients: PaginatedClientWithEmployees;
}

@Injectable()
export class ClientService {
    private readonly logger = new Logger(ClientService.name);

    constructor(
        private readonly createClientUsecase: CreateClientUsecase,
        private readonly findClientByIdUsecase: FindClientByIdUsecase,
        private readonly listClientsUsecase: ListClientsUsecase,
        private readonly listClientsPaginatedUsecase: ListClientsPaginatedUsecase,
        private readonly updateClientUsecase: UpdateClientUsecase,
        private readonly deleteClientUsecase: DeleteClientUsecase,
        private readonly prismaService: PrismaService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        private readonly systemSettingService: SystemSettingService,
        private readonly documentSnapshotService: EformsignDocumentSnapshotService,
        private readonly messageAutomationIntentService: MessageAutomationIntentService,
        private readonly holidayCalendar: HolidayCalendarService,
        @Optional() private readonly triggerService?: MessageTriggerService,
        @Optional() private readonly serviceRecordLinkService?: ServiceRecordLinkService,
        @Optional() private readonly serviceRecordLifecycleService?: ServiceRecordLifecycleService,
        @Optional() private readonly configService?: ConfigService,
        @Optional() private readonly linkMirroredDocumentByPhoneUsecase?: LinkMirroredEformsignDocByPhoneUsecase,
        @Optional() @Inject(CLIENT_AUTOMATION_IMPACT)
        private readonly clientAutomationImpact?: ClientAutomationImpactPort,
        @Optional() private readonly agentAutomationRecordStore?: AgentAutomationRecordStoreService,
        @Optional() private readonly messageAutomationBranchLockService?: MessageAutomationBranchLockService,
    ) {}

    /**
     * The Korean calendar day of an instant, as the date-only value (midnight UTC)
     * that `@db.Date` columns store and read back. A handover is dated by the day
     * it happens in Korea, not by the UTC date of the instant, which lags KST by
     * up to nine hours.
     */
    private kstCalendarDay(instant: Date): Date {
        return new Date(getKstCalendarDate(instant, 0));
    }

    private async transactionNow(transaction: Prisma.TransactionClient): Promise<Date> {
        if (typeof transaction.$queryRaw === "function") {
            const rows = await transaction.$queryRaw<Array<{ now?: Date }>>(Prisma.sql`
                SELECT CURRENT_TIMESTAMP AS "now"
            `);
            const now = rows[0]?.now;
            if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
        }
        return new Date();
    }

    private async revokeServiceRecordLinkAfterCommit(clientId: number, scheduleId: number): Promise<void> {
        try {
            await this.serviceRecordLinkService?.revoke(scheduleId);
        } catch (error) {
            this.logger.error(
                `[SERVICE_RECORD_LINK_REVOKE_FAILED] 제공기록지 링크 폐기 실패 — 고객 ${clientId}, ` +
                `스케줄 ${scheduleId} 수동 확인 필요: ${error}`,
            );
        }
    }

    /**
     * Runs one phone-link transaction attempt, starting over (each attempt is its own
     * transaction that re-reads the owners) while the locked client set turned out stale.
     * Running out of attempts throws into the caller's failure path.
     */
    private async retryWhilePhoneLinkLockSetChanges(
        runAttempt: () => Promise<unknown>,
    ): Promise<void> {
        for (let attempt = 0; attempt < PHONE_LINK_LOCK_RETRY_LIMIT; attempt += 1) {
            if (await runAttempt() !== PHONE_LINK_LOCK_SET_CHANGED) return;
        }
        throw new Error("Contract document owner kept changing while linking by phone");
    }

    /**
     * Clients that must be locked before any of the documents: those that own one of them and
     * those whose eDocId points at one of them (same branch). Read without a lock; it only
     * chooses which client rows to lock and is re-read once the document locks are held.
     */
    private async findPhoneLinkClientIds(
        transaction: Prisma.TransactionClient,
        branchId: string,
        documentIds: number[],
    ): Promise<number[]> {
        const rows = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
            SELECT doc.client_id AS id
            FROM eformsign_doc AS doc
            WHERE doc.id IN (${Prisma.join(documentIds)})
              AND doc.client_id IS NOT NULL
            UNION
            SELECT pointer_client.id
            FROM client AS pointer_client
            JOIN eformsign_doc AS pointed_doc
              ON pointed_doc.document_id = pointer_client.e_doc_id
            WHERE pointed_doc.id IN (${Prisma.join(documentIds)})
              AND pointer_client.branch_id = ${branchId}::uuid
        `);
        return (rows ?? []).map((row) => row.id);
    }

    /** Locks the target client and every owner/pointer client of the documents, in id order. */
    private async lockPhoneLinkClients(
        transaction: Prisma.TransactionClient,
        branchId: string,
        targetClientId: number,
        documentIds: number[],
    ): Promise<Set<number>> {
        const peekedClientIds = await this.findPhoneLinkClientIds(transaction, branchId, documentIds);
        const clientIdsToLock = Array.from(new Set([targetClientId, ...peekedClientIds]))
            .sort((left, right) => left - right);
        await transaction.$queryRaw(Prisma.sql`
            SELECT id
            FROM client
            WHERE id IN (${Prisma.join(clientIdsToLock)})
            ORDER BY id
            FOR UPDATE
        `);
        return new Set(clientIdsToLock);
    }

    private async linkContractDocumentsByPhone(
        branchid: string,
        client: ClientEntity,
        normalizedPhone: string,
    ): Promise<void> {
        const phoneLookupSuffix = normalizedPhone.slice(-PHONE_LOOKUP_SUFFIX_LENGTH);

        try {
            const candidateDocs = await this.prismaService.eformsign_doc.findMany({
                where: {
                    serviceRecordCaseId: null,
                    permanentPurgeRequestedAt: null,
                    statusType: { notIn: [...DELETED_DOCUMENT_STATUS_TYPES] },
                    syncStatus: "ready",
                    detailSourceUpdatedDate: { not: null },
                    detailSyncedAt: { not: null },
                    OR: [
                        { customerPhone: normalizedPhone },
                        {
                            customerPhone: null,
                            stepRecipientSms: { contains: phoneLookupSuffix },
                        },
                    ],
                    AND: [
                        {
                            OR: [
                                { branchId: branchid },
                                { branchId: null, clientId: null },
                            ],
                        },
                        {
                            OR: [
                                { documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT },
                                { documentKind: null },
                            ],
                        },
                    ],
                },
                orderBy: [
                    { createdDate: "desc" },
                    { id: "desc" },
                ],
                select: {
                    id: true,
                    documentId: true,
                    clientId: true,
                    branchId: true,
                    documentKind: true,
                    createdDate: true,
                    serviceRecordCaseId: true,
                    templateId: true,
                    stepRecipientSms: true,
                    customerPhone: true,
                    detailPayload: true,
                    detailSourceUpdatedDate: true,
                    detailSyncedAt: true,
                    statusType: true,
                    voidedAt: true,
                },
            });
            const serviceRecordTemplateIds =
                configuredServiceRecordTemplateIds(this.configService);
            let matchingDocs = candidateDocs.filter((doc) =>
                isMatchingContractPhoneCandidate(
                    doc,
                    normalizedPhone,
                    serviceRecordTemplateIds,
                ));
            if (matchingDocs.some((doc) => doc.branchId === null)) {
                const samePhoneClients = await this.prismaService.client.findMany({
                    where: {
                        deletedAt: null,
                        phone: { not: null },
                        branchId: { not: null },
                        OR: [{ phone: { endsWith: phoneLookupSuffix } }],
                    },
                    select: {
                        id: true,
                        branchId: true,
                        phone: true,
                    },
                });
                const exactMatches = samePhoneClients.filter((candidate) =>
                    candidate.branchId !== null
                    && normalizePhone(candidate.phone) === normalizedPhone,
                );
                const uniquelyIdentifiesCurrentClient = exactMatches.length === 1
                    && exactMatches[0]!.id === client.id
                    && exactMatches[0]!.branchId === branchid;
                if (!uniquelyIdentifiesCurrentClient) {
                    matchingDocs = matchingDocs.filter((doc) => doc.branchId === branchid);
                }
            }
            matchingDocs = matchingDocs.filter((doc) => {
                if (doc.clientId !== null && doc.clientId !== client.id) return false;
                if (doc.clientId === client.id) return true;
                // 계약-05: a document not yet linked to this client is linked only in an
                // allowed status. Rows already linked to it are kept in any non-deleted one.
                if (!isEformsignAutoLinkEligibleStatus(doc.statusType)) return false;
                const detail = toEformsignDocumentDetail(doc.detailPayload);
                const candidate = detail
                    ? extractEformsignContractClientCandidate(detail)
                    : null;
                return detail !== null
                    && compareEformsignClientIdentity(candidate, client, new Date()).length === 0;
            });
            const documentIdsToReassign = matchingDocs
                .filter((doc) => doc.clientId !== client.id && doc.voidedAt === null)
                .map((doc) => doc.id);
            const latestContract = matchingDocs[0];
            // 최신 계약이 파기되었으면 기존 포인터를 유지하고 이전 계약으로 대체하지 않는다.
            const shouldUpdateClientDocument = latestContract !== undefined
                && latestContract.voidedAt === null
                && client.eDocId !== latestContract.documentId;

            if (documentIdsToReassign.length === 0 && !shouldUpdateClientDocument) {
                await this.linkNotReadyContractDocumentsByPhone(
                    branchid,
                    client,
                    normalizedPhone,
                    phoneLookupSuffix,
                );
                return;
            }

            // Owned by the attempt: reset when an attempt starts, set only once the pointer
            // update ran, so the in-memory entity below follows what was actually written.
            let pointerWritten = false;
            await this.retryWhilePhoneLinkLockSetChanges(() => this.prismaService.$transaction(async (transaction) => {
                pointerWritten = false;
                const documentIdsToLock = Array.from(new Set([
                    ...documentIdsToReassign,
                    ...(shouldUpdateClientDocument && latestContract ? [latestContract.id] : []),
                ])).sort((left, right) => left - right);
                // Lock order (project-wide): client row(s) -> eformsign_doc rows (id order) ->
                // case rows. The client rows come first so this link serialises with
                // `linkClientIfActive`, permanent purge and service-record confirmation
                // instead of deadlocking (40P01) against them.
                const lockedClientIds = await this.lockPhoneLinkClients(
                    transaction,
                    branchid,
                    client.id,
                    documentIdsToLock,
                );
                const lockedDocuments = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
                    SELECT doc.id
                    FROM eformsign_doc AS doc
                    WHERE doc.id IN (${Prisma.join(documentIdsToLock)})
                      AND (
                          doc.branch_id = ${branchid}::uuid
                          OR (doc.branch_id IS NULL AND doc.client_id IS NULL)
                      )
                      AND doc.status_type NOT IN ('047', '049', '099')
                      AND doc.permanent_purge_requested_at IS NULL
                      AND doc.sync_status = 'ready'
                      AND doc.detail_payload IS NOT NULL
                      AND doc.detail_source_updated_date IS NOT NULL
                      AND doc.detail_synced_at IS NOT NULL
                      AND EXISTS (
                          SELECT 1
                          FROM eformsign_doc_file AS document_file
                          WHERE document_file.eformsign_doc_id = doc.id
                            AND document_file.file_type = 'document'
                            AND document_file.source_updated_date = doc.detail_source_updated_date
                      )
                      AND EXISTS (
                          SELECT 1
                          FROM eformsign_doc_file AS audit_trail_file
                          WHERE audit_trail_file.eformsign_doc_id = doc.id
                            AND audit_trail_file.file_type = 'audit_trail'
                            AND audit_trail_file.source_updated_date = doc.detail_source_updated_date
                      )
                    ORDER BY doc.id
                    FOR UPDATE
                `);
                // The documents are locked, so their owners are stable now. An owner (or a
                // client pointing at one of them) that was not locked above moved between the
                // unlocked read and the document lock; locking it now would invert the order.
                // Nothing has been written yet: start the attempt over.
                const currentClientIds = await this.findPhoneLinkClientIds(
                    transaction,
                    branchid,
                    documentIdsToLock,
                );
                if (currentClientIds.some((id) => !lockedClientIds.has(id))) {
                    return PHONE_LINK_LOCK_SET_CHANGED;
                }
                const lockedDocumentIds = new Set(lockedDocuments.map(({ id }) => id));
                if (documentIdsToLock.some((id) => !lockedDocumentIds.has(id))) {
                    throw new Error("Contract document mirror generation changed");
                }

                // The row lock protects the re-read below from a concurrent mirror
                // write. Do not act on the pre-lock phone projection: a recipient
                // update may have moved this document to another client or branch.
                const lockedCandidates = await transaction.eformsign_doc.findMany({
                    where: { id: { in: documentIdsToLock } },
                    select: {
                        id: true,
                        clientId: true,
                        documentKind: true,
                        serviceRecordCaseId: true,
                        templateId: true,
                        stepRecipientSms: true,
                        customerPhone: true,
                        detailPayload: true,
                        detailSourceUpdatedDate: true,
                        detailSyncedAt: true,
                        statusType: true,
                        voidedAt: true,
                    },
                });
                const lockedCandidateById = new Map(
                    lockedCandidates.map((candidate) => [candidate.id, candidate]),
                );
                const initialCandidateById = new Map(
                    matchingDocs.map((candidate) => [candidate.id, candidate]),
                );
                const reassignIds = new Set(documentIdsToReassign);
                const changedCandidate = documentIdsToLock.some((id) => {
                    const initial = initialCandidateById.get(id);
                    const locked = lockedCandidateById.get(id);
                    return !initial
                        || !locked
                        || locked.voidedAt !== null
                        || (locked.clientId !== null && locked.clientId !== client.id)
                        // Only a document about to be newly linked must be in an allowed
                        // status; the pointer document may already be this client's.
                        || (
                            reassignIds.has(id)
                            && !isEformsignAutoLinkEligibleStatus(locked.statusType)
                        )
                        || !isMatchingContractPhoneCandidate(
                            locked,
                            normalizedPhone,
                            serviceRecordTemplateIds,
                        )
                        || !sameMirrorGeneration(
                            initial.detailSourceUpdatedDate,
                            initial.detailSyncedAt,
                            locked.detailSourceUpdatedDate,
                            locked.detailSyncedAt,
                        );
                });
                if (changedCandidate) {
                    throw new Error("Contract document candidate changed while locking");
                }

                // The client row is locked, so its identity is stable now. The caller's
                // entity was read before the lock: re-read the locked row and compare every
                // document about to be newly linked against what is stored, not against the
                // earlier snapshot.
                if (documentIdsToReassign.length > 0) {
                    const lockedClient = await transaction.client.findUnique({
                        where: { id: client.id },
                        select: { phone: true, name: true, birthday: true },
                    });
                    if (!lockedClient || normalizePhone(lockedClient.phone) !== normalizedPhone) {
                        throw new Error("Contract document candidate changed while locking");
                    }
                    const now = new Date();
                    for (const id of documentIdsToReassign) {
                        const lockedDetail = toEformsignDocumentDetail(
                            lockedCandidateById.get(id)?.detailPayload ?? null,
                        );
                        const lockedContract = lockedDetail
                            ? extractEformsignContractClientCandidate(lockedDetail)
                            : null;
                        if (
                            lockedDetail === null
                            || compareEformsignClientIdentity(lockedContract, lockedClient, now).length > 0
                        ) {
                            throw new Error("Contract document candidate changed while locking");
                        }
                    }
                }

                if (documentIdsToReassign.length > 0) {
                    const reassigned = await transaction.eformsign_doc.updateMany({
                        where: {
                            id: { in: documentIdsToReassign },
                            permanentPurgeRequestedAt: null,
                            statusType: { in: [...EFORMSIGN_AUTO_LINK_ELIGIBLE_STATUS_CODES] },
                            syncStatus: "ready",
                            detailSourceUpdatedDate: { not: null },
                            detailSyncedAt: { not: null },
                            OR: [
                                { branchId: branchid },
                                { branchId: null, clientId: null },
                            ],
                        },
                        data: {
                            branchId: branchid,
                            clientId: client.id,
                            documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                        },
                    });
                    if (reassigned.count !== documentIdsToReassign.length) {
                        throw new Error("Contract document reassignment was incomplete");
                    }
                }

                // `client.e_doc_id` is unique: another client still pointing at a document that
                // is moving to (or becoming the pointer of) the target would raise P2002 and
                // leave the link undone. Release exactly those pointers, only on clients that
                // are in the locked set (every pointer client of these documents was verified
                // to be above), and only for documents this link hands to the target.
                // D3: a voided contract newer than the pointer candidate means the client has no
                // live contract, so an older document must not take the pointer. Only the
                // pointer is skipped; ownership and the other reassignments proceed.
                const pointerBlockedByVoid = shouldUpdateClientDocument && latestContract !== undefined
                    && await this.hasNewerVoidedContract(transaction, client.id, latestContract);
                const takesPointer = shouldUpdateClientDocument && !pointerBlockedByVoid;
                const releasedDocumentIds = [
                    ...matchingDocs
                        .filter((doc) => documentIdsToReassign.includes(doc.id))
                        .map((doc) => doc.documentId),
                    ...(takesPointer && latestContract ? [latestContract.documentId] : []),
                ];
                const otherLockedClientIds = [...lockedClientIds].filter((id) => id !== client.id);
                if (releasedDocumentIds.length > 0 && otherLockedClientIds.length > 0) {
                    await transaction.client.updateMany({
                        where: {
                            id: { in: otherLockedClientIds },
                            branchId: branchid,
                            eDocId: { in: Array.from(new Set(releasedDocumentIds)) },
                        },
                        data: { eDocId: null },
                    });
                }

                if (takesPointer) {
                    const updated = await transaction.client.updateMany({
                        where: {
                            id: client.id,
                            branchId: branchid,
                        },
                        data: { eDocId: latestContract.documentId },
                    });
                    if (updated.count !== 1) {
                        throw new Error("Client contract pointer update failed");
                    }
                    pointerWritten = true;
                }
                return undefined;
            }));

            if (pointerWritten && latestContract) {
                // SAVED computation: update() re-derives the client's duration.
                const calendar = await this.holidayCalendar.forBranch(branchid, { fresh: true });
                client.update({ eDocId: latestContract.documentId }, calendar);
            }
            if (documentIdsToReassign.length > 0) {
                await this.invalidateContractDocumentSnapshots(
                    branchid,
                    matchingDocs.some((doc) => doc.branchId === null),
                );
            }
            await this.linkNotReadyContractDocumentsByPhone(
                branchid,
                client,
                normalizedPhone,
                phoneLookupSuffix,
            );
        } catch (error) {
            const errorType = error instanceof Error ? error.name : "UnknownError";
            this.logger.error(
                `[CLIENT_CONTRACT_PHONE_LINK_FAILED] 고객 ${client.id} 계약서 자동 연결 실패 (${errorType})`,
            );
        }
    }

    /**
     * D3 fence, read under the client/document locks: whether this client owns a voided
     * contract document newer than `document` ("newer" = later created date, larger id on a
     * tie). Status and purge flags are deliberately ignored - a voided unsigned contract is
     * cancelled in eformsign and later commonly mirrored as deleted; it must keep blocking.
     */
    private async hasNewerVoidedContract(
        transaction: Prisma.TransactionClient,
        clientId: number,
        document: { id: number; createdDate: Date },
    ): Promise<boolean> {
        const blocker = await transaction.eformsign_doc.findFirst({
            where: {
                clientId,
                voidedAt: { not: null },
                AND: [
                    {
                        OR: [
                            { documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT },
                            { documentKind: null },
                        ],
                    },
                    {
                        OR: [
                            { createdDate: { gt: document.createdDate } },
                            { createdDate: document.createdDate, id: { gt: document.id } },
                        ],
                    },
                ],
            },
            select: { id: true },
        });
        return blocker !== null;
    }

    private async linkNotReadyContractDocumentsByPhone(
        branchId: string,
        client: ClientEntity,
        normalizedPhone: string,
        phoneLookupSuffix: string,
    ): Promise<void> {
        if (!this.linkMirroredDocumentByPhoneUsecase) return;

        const candidates = await this.prismaService.eformsign_doc.findMany({
            where: {
                serviceRecordCaseId: null,
                permanentPurgeRequestedAt: null,
                statusType: { notIn: [...DELETED_DOCUMENT_STATUS_TYPES] },
                syncStatus: { not: "ready" },
                OR: [
                    { customerPhone: normalizedPhone },
                    {
                        customerPhone: null,
                        stepRecipientSms: { contains: phoneLookupSuffix },
                    },
                ],
                AND: [
                    {
                        OR: [
                            { branchId },
                            { branchId: null, clientId: null },
                        ],
                    },
                    {
                        OR: [
                            { documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT },
                            { documentKind: null },
                        ],
                    },
                ],
            },
            orderBy: [
                { createdDate: "desc" },
                { id: "desc" },
            ],
            select: {
                documentId: true,
                branchId: true,
            },
        });

        let ownershipChanged = false;
        let includesUnassignedDocument = false;
        for (const candidate of candidates) {
            const result = await this.linkMirroredDocumentByPhoneUsecase.execute(
                candidate.documentId,
                {
                    linkExistingOnly: true,
                    existingClientId: client.id,
                    existingClientBranchId: branchId,
                },
            );
            if (result === "linked") {
                ownershipChanged = true;
                includesUnassignedDocument ||= candidate.branchId === null;
            }
        }
        if (!ownershipChanged) return;

        const persistedClient = await this.prismaService.client.findUnique({
            where: { id: client.id },
            select: { eDocId: true },
        });
        if (persistedClient) {
            // SAVED computation: update() re-derives the client's duration.
            const calendar = await this.holidayCalendar.forBranch(branchId, { fresh: true });
            client.update({ eDocId: persistedClient.eDocId }, calendar);
        }
        await this.invalidateContractDocumentSnapshots(
            branchId,
            includesUnassignedDocument,
        );
    }

    private async invalidateContractDocumentSnapshots(
        branchId: string,
        includesUnassignedDocument: boolean,
    ): Promise<void> {
        await Promise.all([
            this.documentSnapshotService.bumpVersion(branchId).catch(() => {
                this.logger.warn(
                    `Failed to invalidate eformsign snapshots for branch ${branchId}`,
                );
            }),
            ...(includesUnassignedDocument
                ? [this.documentSnapshotService.bumpCompanyEpoch().catch(() => {
                    this.logger.warn(
                        "Failed to invalidate headquarters eformsign snapshots",
                    );
                })]
                : []),
        ]);
    }

    private mapServiceStatusToBadge(status: string | null): {
        status: ClientBadgeStatus;
        label: string;
        tone: ClientBadgeTone;
    } {
        switch (status) {
            case SERVICE_STATUS.PRE_BOOKING:
                return { status: "preBooking", label: "예약 전", tone: "neutral" };
            case SERVICE_STATUS.ACTIVE:
                return { status: "active", label: "진행중", tone: "primary" };
            case SERVICE_STATUS.WAITING:
                return { status: "pending", label: "대기", tone: "warning" };
            case SERVICE_STATUS.REPLACEMENT_REQUESTED:
                return { status: "terminated", label: "교체 요청", tone: "danger" };
            case SERVICE_STATUS.TERMINATED:
                return { status: "terminated", label: "중단", tone: "danger" };
            case SERVICE_STATUS.COMPLETED:
                return { status: "completed", label: "완료", tone: "success" };
            default:
                return { status: "pending", label: "-", tone: "warning" };
        }
    }

    /**
     * Latest non-service-record contract document per client. The selection rule lives in
     * `selectCurrentContractDocument`, shared with the receipt-link automatic path and the
     * repository's digest/filter lookups, so every screen and message judges the same "current"
     * contract.
     */
    private async findLatestContractByClientId(
        clientIds: number[],
    ): Promise<Map<number, LatestContractSignal>> {
        return findLatestContractSignalsByClientId(
            this.prismaService,
            configuredServiceRecordTemplateIds(this.configService),
            clientIds,
        );
    }

    /** Whether a client's latest contract document is still active (see `isActiveContractSignal`). */
    private isActiveContractDocument(contract: LatestContractSignal | undefined): boolean {
        return isActiveContractSignal(contract);
    }

    private async findHasActiveContractDocumentByClientId(
        clientIds: number[],
    ): Promise<Map<number, boolean>> {
        const latestContractMap = await this.findLatestContractByClientId(clientIds);

        return new Map(
            [...latestContractMap].map(([clientId, contract]) => [
                clientId,
                this.isActiveContractDocument(contract),
            ]),
        );
    }

    /**
     * Single source of truth for "this client's contract needs attention".
     * The `contract_required` badge, the dashboard list and the
     * `/clients/alerts` sidebar feed all read this, so every surface agrees.
     *
     * An active document (created/requested/opened/completed — see
     * `ACTIVE_DOCUMENT_STATUSES`) already means a contract exists, so no action
     * is required even if the customer has not signed yet. Only a client with
     * no active document — none at all, or the latest one rejected/revoked/
     * deleted — needs a contract sent, and only within the send window. Windows
     * are counted in KR business days, so a weekend or holiday does not
     * silently eat the warning time.
     *
     * Deliberately excludes 교체 요청: a replacement is unrelated to whether a
     * contract exists, so it must not suppress the contract badge.
     */
    private computeContractActionRequired(params: {
        clientId?: number;
        serviceStatus: string | null;
        startDate: Date | null;
        hasActiveContractDocument: boolean;
        now?: Date;
    }, calendar: KrBusinessDayCalendar): ClientActionRequired | null {
        return isContractSendRequired(params, calendar, (clientId) => this.warnCalendarSkip(clientId))
            ? { reason: "발송 필요", priority: 3 }
            : null;
    }

    /**
     * A client whose dates fall outside the supported/synced holiday-calendar range cannot be
     * judged by business days. It is skipped from those counts instead of failing the request.
     * Logs the client id only (no PII).
     */
    private warnCalendarSkip(clientId: number | undefined): void {
        this.logger.warn(
            `Skipping business-day contract check for client ${clientId ?? "unknown"}: a date is outside the supported holiday calendar range`,
        );
    }

    /** Contract attention plus the non-contract 교체 요청 alert, which outranks it. */
    private computeActionRequired(params: {
        clientId?: number;
        serviceStatus: string | null;
        startDate: Date | null;
        hasActiveContractDocument: boolean;
    }, calendar: KrBusinessDayCalendar): ClientActionRequired | null {
        if (params.serviceStatus === SERVICE_STATUS.REPLACEMENT_REQUESTED) {
            return { reason: "교체 요청", priority: 1 };
        }

        return this.computeContractActionRequired(params, calendar);
    }

    private buildClientBadges(params: {
        contractActionRequired: ClientActionRequired | null;
        /** The current contract is 040/045 (철회 요청됨): still live, cancellation only requested. */
        contractRevokeRequested: boolean;
        serviceStatus: string | null;
        breastPump: boolean;
        careCenter: boolean | null;
    }): ClientBadge[] {
        const badges: ClientBadge[] = [];

        if (params.contractActionRequired) {
            badges.push({
                key: "contract_required",
                status: "terminated",
                label: "계약서 필요",
                tone: "danger",
                priority: 10,
            });
        }

        // Same condition and order as the shared fallback (`legacyClientBadges`): an active
        // service whose live contract has a pending cancellation gets a warning-toned
        // contract_status badge right after (never instead of) the contract_required slot.
        if (params.contractRevokeRequested && params.serviceStatus === SERVICE_STATUS.ACTIVE) {
            badges.push({
                key: "contract_status",
                status: "review",
                label: "철회 요청됨",
                tone: "warning",
                priority: 15,
            });
        }

        if (params.breastPump) {
            badges.push({
                key: "breast_pump",
                status: "breastPump",
                label: "유축기 대여",
                tone: "primary",
                priority: 20,
            });
        }

        const serviceBadge = this.mapServiceStatusToBadge(params.serviceStatus);
        badges.push({
            key: "service_status",
            status: serviceBadge.status,
            label: serviceBadge.label,
            tone: serviceBadge.tone,
            priority: 30,
        });

        if (params.careCenter) {
            badges.push({
                key: "care_center",
                status: "careCenter",
                label: "조리원 이용",
                tone: "primary",
                priority: 40,
            });
        }

        return badges.sort((left, right) => left.priority - right.priority);
    }

    private async assertAllowedEmployees(
        branchid: string,
        primaryEmployeeId: number | null,
        secondaryEmployeeId: number | null,
        transaction: Prisma.TransactionClient,
        retainedEmployeeIds?: ReadonlySet<number>,
        employeesAlreadyLocked = false,
    ): Promise<void> {
        assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);
        if (primaryEmployeeId === null) return;

        const employeeIds = [primaryEmployeeId, secondaryEmployeeId].filter(
            (employeeId): employeeId is number => employeeId !== null,
        );
        if (!employeesAlreadyLocked) {
            await lockEmployeesForScheduleWrite(
                transaction,
                branchid,
                [...employeeIds, ...(retainedEmployeeIds ? [...retainedEmployeeIds] : [])],
            );
        }
        const employees: EmployeeAssignmentCandidate[] = await transaction.employee.findMany({
            where: {
                id: { in: employeeIds },
                branchId: branchid,
            },
            select: {
                id: true,
                branchId: true,
                deletedAt: true,
                openToNextWork: true,
            },
        });
        assertEmployeeAssignmentEligibility(
            branchid,
            primaryEmployeeId,
            secondaryEmployeeId,
            employees,
            retainedEmployeeIds,
        );
    }

    private async syncEmployeeAssignment(branchid: string, params: {
        clientId: number;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        workAddress: string;
        startDate: Date;
        endDate: Date;
        applyMessageAutomation: boolean;
        /** The branch calendar, read fresh before the caller opened this transaction. */
        calendar: KrBusinessDayCalendar;
    }): Promise<{ createdScheduleId: number | null; replacedScheduleId: number | null }> {
        const intentAt = new Date();
        const ordinaryMutationId = randomUUID();
        const newSchedule = await this.prismaService.$transaction(async (transaction) => {
            // The common policy rereads every historical schedule after the
            // client lock and locks the complete employee union (including the
            // requested providers) before any case or schedule write. This
            // prevents ensureForClient from discovering a lower-id historical
            // employee after the case lock and creating a cross-client cycle.
            await lockServiceRecordWriteSet(transaction, {
                branchId: branchid,
                clientId: params.clientId,
                employeeIds: [params.primaryEmployeeId, params.secondaryEmployeeId],
            });
            const currentSchedule = await transaction.employee_schedule.findFirst({
                where: { clientId: params.clientId, branchId: branchid, replaced: false },
                orderBy: { id: "desc" },
            });
            const currentPrimaryEmployeeId = currentSchedule?.primaryEmployeeId ?? null;
            const currentSecondaryEmployeeId = currentSchedule?.secondaryEmployeeId ?? null;
            const newPrimaryEmployeeId = params.primaryEmployeeId ?? currentPrimaryEmployeeId;
            const newSecondaryEmployeeId = params.secondaryEmployeeId !== undefined
                ? params.secondaryEmployeeId
                : currentSecondaryEmployeeId;

            if (
                newPrimaryEmployeeId === currentPrimaryEmployeeId &&
                newSecondaryEmployeeId === currentSecondaryEmployeeId
            ) {
                return null;
            }

            assertEmployeeAssignmentShape(newPrimaryEmployeeId, newSecondaryEmployeeId);
            if (newPrimaryEmployeeId === null) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/primaryEmployeeId",
                    code: "REQUIRED",
                    detail: "배정을 만들려면 주 담당 인력이 필요해요.",
                    location: "body",
                }));
            }

            const retainedEmployeeIds = new Set(
                [currentPrimaryEmployeeId, currentSecondaryEmployeeId]
                    .filter((employeeId): employeeId is number => employeeId !== null),
            );
            await this.assertAllowedEmployees(
                branchid,
                newPrimaryEmployeeId,
                newSecondaryEmployeeId,
                transaction,
                retainedEmployeeIds,
                true,
            );
            // One handover instant for the whole transaction. The outgoing row has to
            // end on exactly the day the incoming row starts, so the clock is read
            // once here rather than per write, where the two could straddle midnight.
            const handover = currentSchedule
                ? ((): { outgoingEndDate: Date; startDate: Date; endDate: Date } => {
                    const outgoingEndDate = employeeScheduleReplacementEndDate(
                        this.kstCalendarDay(new Date()),
                        currentSchedule.startDate,
                    );
                    return {
                        outgoingEndDate,
                        ...employeeScheduleHandoverPeriod({
                            replacementAt: outgoingEndDate,
                            contractStartDate: params.startDate,
                            contractEndDate: params.endDate,
                        }),
                    };
                })()
                : null;
            // A first assignment keeps the contract period; only a handover moves the start.
            const incomingStartDate = handover?.startDate ?? params.startDate;
            const incomingEndDate = handover?.endDate ?? params.endDate;
            await assertNoActiveEmployeeScheduleOverlap(transaction, {
                branchId: branchid,
                clientId: params.clientId,
                primaryEmployeeId: newPrimaryEmployeeId,
                secondaryEmployeeId: newSecondaryEmployeeId,
                startDate: incomingStartDate,
                endDate: incomingEndDate,
                replaced: false,
                excludeScheduleId: currentSchedule?.id,
            });
            if (currentSchedule && handover) {
                await this.agentAutomationRecordStore?.appendScheduleWriteFence(transaction, {
                    branchId: branchid,
                    clientId: params.clientId,
                    mutationId: ordinaryMutationId,
                    scheduleIds: [currentSchedule.id],
                });
                await transaction.employee_schedule.update({
                    where: { id: currentSchedule.id },
                    data: {
                        replaced: true,
                        endDate: handover.outgoingEndDate,
                    },
                });
            }
            const newSchedule = await transaction.employee_schedule.create({
                data: {
                    clientId: params.clientId,
                    branchId: branchid,
                    primaryEmployeeId: newPrimaryEmployeeId,
                    secondaryEmployeeId: newSecondaryEmployeeId,
                    workAddress: params.workAddress,
                    startDate: incomingStartDate,
                    endDate: incomingEndDate,
                    replaced: false,
                },
            });
            if (params.applyMessageAutomation) {
                await this.messageAutomationIntentService.persistScheduleIntent(transaction, {
                    branchId: branchid,
                    clientId: params.clientId,
                    scheduleId: newSchedule.id,
                    includePast: true,
                    intentAt,
                });
            }
            await this.serviceRecordLifecycleService?.ensureForClient(
                params.clientId,
                transaction,
                params.calendar,
            );
            return {
                schedule: newSchedule,
                replacedScheduleId: currentSchedule?.id ?? null,
            };
        });

        if (newSchedule === null) {
            return { createdScheduleId: null, replacedScheduleId: null };
        }

        return {
            createdScheduleId: newSchedule.schedule.id,
            replacedScheduleId: newSchedule.replacedScheduleId,
        };
    }

    async create(branchid: string, params: {
        name: string;
        primaryEmployeeId?: number | null;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        allowBusinessDayMismatch?: boolean;
        confirmedUnavailableEmployeeIds?: readonly number[];
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter: boolean | null;
        voucherClient: boolean;
        birthday?: string | null;
        dueDate?: string | null;
        birthDate?: string | null;
        serviceStatus?: string | null;
        breastPump: boolean;
        /** Per-client service-day policy; omitted means weekday-only. */
        allowSaturdayService?: boolean;
        allowSundayService?: boolean;
        allowHolidayService?: boolean;
        eDocId?: string | null;
        areaId?: string | null;
        suppressGreetingSms?: boolean;
        applyMessageAutomation?: boolean;
        /** Persisted per-client SMS switch; an explicit value wins over `applyMessageAutomation`. */
        smsAutomationEnabled?: boolean;
        reuseExistingClient?: boolean;
        source?: string;
    }): Promise<ClientEntity> {
        // Reject malformed identity input before settings lookups, duplicate
        // checks, automation, or any other write/provider side effect.
        assertClientPhoneInput(params.phone);
        const startDate = parseClientDate(params.startDate, "startDate") ?? null;
        const endDate = parseClientDate(params.endDate, "endDate") ?? null;
        const dueDate = parseClientDate(params.dueDate, "dueDate") ?? null;
        const birthDate = parseClientDate(params.birthDate, "birthDate") ?? null;
        mergeAndValidateClientServicePeriod(null, { startDate, endDate });
        // SAVED computation: the derived duration is persisted.
        const calendar = await this.holidayCalendar.forBranch(branchid, { fresh: true });
        // The client's own service days decide which days count toward the
        // duration; the plain branch calendar still serves the lifecycle calls below.
        const derivedDuration = deriveClientDuration(
            startDate,
            endDate,
            calendar.withServiceDays(serviceDayPolicyOf(params)),
        );
        // On create there is no prior duration to clear, so an explicit null
        // carries the same "no opinion" as an omitted field and the count is
        // derived from the dates. Only a supplied number is checked against
        // them. Update keeps null's distinct explicit-clear meaning.
        assertClientDurationMatchesDates(params.duration ?? undefined, derivedDuration, params.allowBusinessDayMismatch);
        // A supplied duration is authoritative; the date-derived count is
        // only a fallback when the caller does not supply one.
        const duration = params.duration ?? derivedDuration ?? null;
        assertAllowedServiceStatus(params.serviceStatus);
        // A new client may start in any status. 대기/진행/완료 are date-derived
        // and only hold for a confirmed booking, so choosing one at creation
        // confirms the booking in the same create transaction. Contract
        // auto-registration sends a date-derived hint, not an admin's choice,
        // so it stays unconfirmed.
        const confirmBookingOnCreate = params.source !== CONTRACT_AUTO_REGISTRATION_SOURCE
            && (params.serviceStatus === SERVICE_STATUS.WAITING
                || params.serviceStatus === SERVICE_STATUS.ACTIVE
                || params.serviceStatus === SERVICE_STATUS.COMPLETED);
        if (confirmBookingOnCreate && (!startDate || !endDate)) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/serviceStatus",
                code: "INVALID_VALUE",
                detail: "대기·진행·완료로 등록하려면 서비스 시작일과 종료일을 먼저 입력해 주세요.",
                location: "body",
            }));
        }
        await assertAllowedClientArea(this.prismaService, branchid, params.areaId);

        let suppressGreetingSms = params.suppressGreetingSms ?? false;
        const applyMessageAutomation = params.applyMessageAutomation ?? true;
        // The create-time intent gating above stays keyed to applyMessageAutomation;
        // the persisted flag prefers the explicit field.
        const smsAutomationEnabled = params.smsAutomationEnabled ?? params.applyMessageAutomation ?? true;
        if (params.source === CONTRACT_AUTO_REGISTRATION_SOURCE) {
            const autoRegistrationEnabled = await this.systemSettingService
                .getClientAutoRegistrationEnabled(branchid);
            if (!autoRegistrationEnabled) {
                throw new ConflictException({ ...codeOnlyProblemBody("REQUEST_CONFLICT"), message: "자동 고객 등록이 꺼져 있습니다. 고객을 먼저 등록한 뒤 계약서를 생성해 주세요." });
            }
            const greetingEnabled = await this.systemSettingService
                .getGreetingOnAutoRegistrationEnabled(branchid);
            suppressGreetingSms = !greetingEnabled;
        }

        const { normalizedPhone, existingClient: existing } = await findClientByNormalizedPhone(
            this.clientRepository,
            branchid,
            params.phone,
        );
        if (existing && normalizedPhone) {
            if (params.reuseExistingClient !== true) {
                // 소비자는 공개 코드로 중복을 식별한다. 재사용 대상 id 페이로드는
                // 의도적으로 제거된다(서버 재사용 분기는 그대로 유지).
                throw new ConflictException(clientProblemBody("CLIENT_PHONE_ALREADY_REGISTERED", {
                    pointer: "/phone",
                    code: "INVALID_VALUE",
                    detail: "같은 전화번호의 고객이 이미 등록되어 있습니다.",
                    location: "body",
                }));
            }
            this.logger.log(`[Client] Reusing existing client ${existing.id} for duplicate phone in branch ${branchid}`);
            if (params.smsAutomationEnabled !== undefined) {
                // Only an explicitly supplied value touches a reused client's flag.
                await this.prismaService.client.updateMany({
                    where: { id: existing.id, branchId: branchid },
                    data: { smsAutomationEnabled: params.smsAutomationEnabled },
                });
                existing.smsAutomationEnabled = params.smsAutomationEnabled;
            }
            if (params.primaryEmployeeId !== undefined || params.secondaryEmployeeId !== undefined) {
                const assignment = await this.syncEmployeeAssignment(branchid, {
                    clientId: existing.id,
                    primaryEmployeeId: params.primaryEmployeeId ?? undefined,
                    secondaryEmployeeId: params.secondaryEmployeeId,
                    workAddress: params.address ?? existing.address ?? "",
                    startDate: startDate ?? existing.startDate ?? new Date(),
                    endDate: endDate ?? existing.endDate ?? new Date(Date.now() + DEFAULT_SERVICE_PERIOD_MS),
                    applyMessageAutomation,
                    calendar,
                });
                if (assignment.replacedScheduleId !== null) {
                    await this.revokeServiceRecordLinkAfterCommit(
                        existing.id,
                        assignment.replacedScheduleId,
                    );
                }
                if (assignment.createdScheduleId !== null) {
                    if (applyMessageAutomation) {
                        await this.messageAutomationIntentService.fulfillScheduleIntent({
                            branchId: branchid,
                            scheduleId: assignment.createdScheduleId,
                            includePast: true,
                        }).catch((error) => {
                            this.logger.error(`Failed to fulfill assignment message intent: ${error}`);
                        });
                    }
                }
            } else {
                // A duplicate-phone reuse without an assignment still needs a
                // service-record case. Keep lifecycle initialization inside its
                // own owning transaction so the lifecycle service can lock and
                // reread the client/schedule set before any case repair.
                await this.prismaService.$transaction(async (transaction) => {
                    await this.serviceRecordLifecycleService?.ensureForClient(existing.id, transaction, calendar);
                });
            }
            await this.linkContractDocumentsByPhone(branchid, existing, normalizedPhone);
            return existing;
        }

        const normalizedPricing = normalizeClientPricing({
            voucherClient: params.voucherClient,
            type: params.type ?? null,
            fullPrice: params.fullPrice ?? null,
            grant: params.grant ?? null,
            actualPrice: params.actualPrice ?? null,
        });

        const createParams = {
            name: params.name,
            address: params.address ?? null,
            phone: params.phone ?? null,
            type: normalizedPricing.type,
            duration,
            allowBusinessDayMismatch: params.allowBusinessDayMismatch,
            fullPrice: normalizedPricing.fullPrice,
            grant: normalizedPricing.grant,
            actualPrice: normalizedPricing.actualPrice,
            startDate: startDate,
            endDate: endDate,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
            birthday: params.birthday ?? null,
            dueDate,
            birthDate,
            serviceStatus: params.serviceStatus ?? null,
            bookingConfirmedAt: confirmBookingOnCreate ? new Date() : null,
            breastPump: params.breastPump,
            allowSaturdayService: params.allowSaturdayService ?? false,
            allowSundayService: params.allowSundayService ?? false,
            allowHolidayService: params.allowHolidayService ?? false,
            eDocId: params.eDocId ?? null,
            areaId: params.areaId ?? null,
            suppressGreetingSms,
            smsAutomationEnabled,
        };

        const primaryEmployeeId = params.primaryEmployeeId ?? null;
        const secondaryEmployeeId = params.secondaryEmployeeId ?? null;
        assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);

        let client: ClientEntity;
        let createdScheduleId: number | null = null;
        const automationIntentAt = new Date();
        if (primaryEmployeeId !== null) {
            const result = await this.prismaService.$transaction(async (transaction) => {
                const employeeIds = [primaryEmployeeId, secondaryEmployeeId]
                    .filter((employeeId): employeeId is number => employeeId !== null);
                await lockEmployeesForScheduleWrite(transaction, branchid, employeeIds);
                const selectedEmployees = await transaction.employee.findMany({
                    where: {
                        id: { in: employeeIds },
                        branchId: branchid,
                    },
                    select: {
                        id: true,
                        name: true,
                        branchId: true,
                        deletedAt: true,
                        openToNextWork: true,
                    },
                });
                const uniqueEmployeeIds = new Set(employeeIds);
                if (
                    selectedEmployees.length !== uniqueEmployeeIds.size
                    || selectedEmployees.some((employee) => employee.deletedAt !== null)
                ) {
                    assertEmployeeAssignmentEligibility(
                        branchid,
                        primaryEmployeeId,
                        secondaryEmployeeId,
                        selectedEmployees,
                    );
                }
                const unavailableEmployees = selectedEmployees
                    .filter((employee) => employee.openToNextWork === false)
                    .map((employee) => ({ id: employee.id, name: employee.name }))
                    .sort((left, right) => left.id - right.id);
                const confirmedIds = params.confirmedUnavailableEmployeeIds === undefined
                    ? null
                    : [...params.confirmedUnavailableEmployeeIds].sort((left, right) => left - right);
                const currentUnavailableIds = unavailableEmployees.map((employee) => employee.id);
                const confirmationMatches = confirmedIds !== null
                    && confirmedIds.length === currentUnavailableIds.length
                    && confirmedIds.every((employeeId, index) => employeeId === currentUnavailableIds[index]);

                if (unavailableEmployees.length > 0 && !confirmationMatches) {
                    throw new ConflictException({
                        code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
                        unavailableEmployees,
                    });
                }
                if (confirmationMatches && currentUnavailableIds.length > 0) {
                    await transaction.employee.updateMany({
                        where: {
                            id: { in: currentUnavailableIds },
                            branchId: branchid,
                            deletedAt: null,
                            openToNextWork: false,
                        },
                        data: { openToNextWork: true },
                    });
                }
                await this.assertAllowedEmployees(
                    branchid,
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    transaction,
                    undefined,
                    true,
                );
                const initialScheduleStartDate = startDate ?? new Date();
                const initialScheduleEndDate = endDate ?? new Date(Date.now() + DEFAULT_SERVICE_PERIOD_MS);
                await assertNoActiveEmployeeScheduleOverlap(transaction, {
                    branchId: branchid,
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    startDate: initialScheduleStartDate,
                    endDate: initialScheduleEndDate,
                    replaced: false,
                });
                const created = await this.createClientUsecase.executeWithInitialSchedule(branchid, createParams, {
                    primaryEmployeeId,
                    secondaryEmployeeId,
                    workAddress: params.address ?? "",
                    startDate: initialScheduleStartDate,
                    endDate: initialScheduleEndDate,
                }, transaction, calendar);
                if (applyMessageAutomation) {
                    await this.messageAutomationIntentService.persistClientIntent(transaction, {
                        branchId: branchid,
                        clientId: created.client.id,
                        includePast: true,
                        suppressGreeting: suppressGreetingSms,
                        intentAt: automationIntentAt,
                    });
                    await this.messageAutomationIntentService.persistScheduleIntent(transaction, {
                        branchId: branchid,
                        clientId: created.client.id,
                        scheduleId: created.scheduleId,
                        includePast: true,
                        intentAt: automationIntentAt,
                    });
                }
                await this.serviceRecordLifecycleService?.ensureForClient(
                    created.client.id,
                    transaction,
                    calendar,
                );
                return created;
            });
            client = result.client;
            createdScheduleId = result.scheduleId;
        } else {
            client = await this.prismaService.$transaction(async (transaction) => {
                const created = await this.createClientUsecase.execute(
                    branchid,
                    createParams,
                    transaction,
                    calendar,
                );
                if (applyMessageAutomation) {
                    await this.messageAutomationIntentService.persistClientIntent(transaction, {
                        branchId: branchid,
                        clientId: created.id,
                        includePast: true,
                        suppressGreeting: suppressGreetingSms,
                        intentAt: automationIntentAt,
                    });
                }
                await this.serviceRecordLifecycleService?.ensureForClient(
                    created.id,
                    transaction,
                    calendar,
                );
                return created;
            });
        }

        if (normalizedPhone) {
            await this.linkContractDocumentsByPhone(branchid, client, normalizedPhone);
        }

        if (applyMessageAutomation) {
            await this.messageAutomationIntentService.fulfillClientIntent({
                branchId: branchid,
                clientId: client.id,
                includePast: true,
                suppressGreeting: suppressGreetingSms,
            }).catch((error) => {
                this.logger.error(`Failed to fulfill client message intent: ${error}`);
            });
        }
        if (createdScheduleId !== null && applyMessageAutomation) {
            await this.messageAutomationIntentService.fulfillScheduleIntent({
                branchId: branchid,
                scheduleId: createdScheduleId,
                includePast: true,
            }).catch((error) => {
                this.logger.error(`Failed to fulfill assignment message intent: ${error}`);
            });
        }
        // A booking confirmed at creation gets the same service-record link
        // SMS that [예약 확정] schedules, whatever the automation choice.
        if (confirmBookingOnCreate) {
            await this.scheduleServiceRecordLinksAfterLeavingPreBooking(
                branchid,
                client.id,
                { serviceStatus: SERVICE_STATUS.PRE_BOOKING, startDate: client.startDate, endDate: client.endDate, bookingConfirmedAt: null },
                client,
                applyMessageAutomation ? createdScheduleId : null,
            );
        }

        return client;
    }

    async findAll(branchid: string): Promise<ClientWithEmployees[]> {
        const clients = await this.listClientsUsecase.execute(branchid);
        return this.attachEmployeesToClients(clients, branchid);
    }

    async findAllPaginated(
        branchid: string,
        page: number,
        limit: number,
        search?: string,
        tab?: ClientListTab,
    ): Promise<PaginatedClientWithEmployees> {
        const result = tab === undefined
            ? await this.listClientsPaginatedUsecase.execute(branchid, page, limit, search)
            : await this.listClientsPaginatedUsecase.execute(branchid, page, limit, search, tab);
        const clientsWithEmployees = await this.attachEmployeesToClients(result.data, branchid);
        return {
            data: clientsWithEmployees,
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
        };
    }

    async getListSummary(branchid: string, search?: string): Promise<ClientListSummary> {
        if (!this.clientRepository.getListSummary) {
            throw new Error("Client list summary repository capability is not configured");
        }
        return this.clientRepository.getListSummary(branchid, search);
    }

    async checkPhoneExists(branchid: string, phone: string | null | undefined): Promise<boolean> {
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) return false;

        const existing = await this.clientRepository.findByPhone(branchid, normalizedPhone);
        return existing !== null;
    }

    async findById(branchid: string, id: number): Promise<ClientWithEmployees | null> {
        const client = await this.findClientByIdUsecase.execute(branchid, id);
        if (!client) return null;

        const [withEmployees] = await this.attachEmployeesToClients([client], branchid);
        return withEmployees ?? null;
    }

    async findByFilter(branchid: string, filter: string): Promise<ClientWithEmployees[]> {
        let clients: ClientEntity[];

        switch (filter) {
            case 'starting-soon':
                clients = await this.clientRepository.findStartingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'ending-soon':
                clients = await this.clientRepository.findEndingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'incomplete-contracts':
                clients = await this.clientRepository.findWithIncompleteContractsStartingWithinDays(
                    branchid,
                    FILTER_DAYS_THRESHOLD
                );
                break;
            case 'no-contract':
                // Exactly the dashboard's contractsNotSent / the list's 발송 필요 badge.
                clients = await this.clientRepository.findWithoutContractSentStartingWithinDays(
                    branchid,
                    await this.holidayCalendar.forBranch(branchid),
                );
                break;
            default:
                this.logger.warn(`Unknown filter: ${filter}`);
                clients = [];
        }

        return this.attachEmployeesToClients(clients, branchid);
    }

    /**
     * Helper method to attach employee info to clients and compute service status
     * Implements lazy update: computes status on access and updates DB if changed
     */
    private async attachEmployeesToClients(
        clients: ClientEntity[],
        branchid: string,
    ): Promise<ClientWithEmployees[]> {
        if (clients.length === 0) return [];

        const clientIds = clients.map(c => c.id);

        // Get all active schedules for these clients with employee info
        const schedules = await this.prismaService.employee_schedule.findMany({
            where: {
                clientId: { in: clientIds },
                replaced: false,
            },
            include: {
                primaryEmployee: true,
                secondaryEmployee: true,
            },
        });

        // Create a map of clientId to schedule
        const scheduleMap = new Map(schedules.map(s => [s.clientId, s]));

        const pendingScheduleChanges = await this.prismaService.schedule_change_request.findMany({
            where: { clientId: { in: clientIds }, status: "pending" },
            select: {
                id: true,
                clientId: true,
                sessionIndex: true,
                fromDate: true,
                toDate: true,
                oldEndDate: true,
                newEndDate: true,
            },
        });
        const pendingScheduleChangeMap = new Map(pendingScheduleChanges.map(change => [change.clientId, change]));

        // 확정 단계 서비스 기록은 계약 기간을 바꿀 수 없으니 고객 목록과 같은 조회 범위에서 한 번에 확인해요.
        const finalizedServiceRecordCases = await this.prismaService.service_record_case.findMany({
            where: { clientId: { in: clientIds }, status: { in: [...IMMUTABLE_FINALIZATION_STATUSES] } },
            select: { clientId: true },
        });
        const periodLockedClientIds = new Set(finalizedServiceRecordCases.map(record => record.clientId));

        // 현재 페이지 고객의 계약 문서만 한 번에 조회하고, 고객별 최신 상태를 사용한다.
        const latestContractMap = await this.findLatestContractByClientId(clientIds);

        // Display-only: the cached branch calendar is enough for the badges.
        const calendar = await this.holidayCalendar.forBranch(branchid);

        // Compute and update service status for each client (lazy update strategy)
        const clientsNeedingUpdate: {
            id: number;
            expectedServiceStatus: string | null;
            newStatus: ServiceStatusType;
        }[] = [];

        const result = clients.map(client => {
            const schedule = scheduleMap.get(client.id);
            const pendingScheduleChange = pendingScheduleChangeMap.get(client.id);

            // Compute current service status based on dates
            const computedStatus = getEffectiveClientServiceStatus(
                client.serviceStatus,
                client.startDate,
                client.endDate,
                client.bookingConfirmedAt,
            );

            // Track clients that need status update in DB
            if (isAutomaticServiceStatusTransitionAllowed(client.serviceStatus, computedStatus)) {
                clientsNeedingUpdate.push({
                    id: client.id,
                    expectedServiceStatus: client.serviceStatus,
                    newStatus: computedStatus,
                });
            }
            const latestContract = latestContractMap.get(client.id);
            // Purge-requested wins ("deleted"); else a voided newest contract is "voided" whatever its
            // eformsign code says (the code keeps moving after a void); else the code decides.
            const documentStatus = latestContract?.permanentPurgeRequestedAt != null
                ? "deleted"
                : isVoidedContractSignal(latestContract)
                    ? "voided"
                    : this.mapStatusTypeToDocumentStatus(latestContract?.statusType);
            const hasActiveContractDocument = ACTIVE_DOCUMENT_STATUSES.has(documentStatus);
            const contractSignals = {
                clientId: client.id,
                serviceStatus: computedStatus,
                startDate: client.startDate,
                hasActiveContractDocument,
            };
            const badges = this.buildClientBadges({
                contractActionRequired: this.computeContractActionRequired(contractSignals, calendar),
                contractRevokeRequested: documentStatus === "revoke_requested",
                serviceStatus: computedStatus,
                breastPump: client.breastPump,
                careCenter: client.careCenter,
            });
            const actionRequired = this.computeActionRequired(contractSignals, calendar);

                return {
                    id: client.id,
                    name: client.name,
                    createdAt: client.createdAt,
                    address: client.address,
                    phone: client.phone,
                    type: client.type,
                    duration: client.duration,
                    fullPrice: client.fullPrice,
                    grant: client.grant,
                    actualPrice: client.actualPrice,
                    startDate: client.startDate,
                    endDate: client.endDate,
                    careCenter: client.careCenter,
                    voucherClient: client.voucherClient,
                    birthday: client.birthday,
                    dueDate: client.dueDate,
                    birthDate: client.birthDate,
                    serviceStatus: computedStatus, // Return computed status, not stored one
                    bookingConfirmedAt: client.bookingConfirmedAt?.toISOString() ?? null,
                    breastPump: client.breastPump,
                    allowSaturdayService: client.allowSaturdayService,
                    allowSundayService: client.allowSundayService,
                    allowHolidayService: client.allowHolidayService,
                    eDocId: client.eDocId,
                    areaId: client.areaId,
                    smsAutomationEnabled: client.smsAutomationEnabled,
                    hasSigned: latestContract?.permanentPurgeRequestedAt == null
                        && !isVoidedContractSignal(latestContract)
                        && hasCustomerSigned(latestContract),
                    documentStatus,
                    latestContractDocumentId: latestContract?.documentId ?? null,
                    badges,
                    actionRequired,
                    serviceRecordPeriodLocked: periodLockedClientIds.has(client.id),
                    primaryEmployee: schedule?.primaryEmployee
                        ? {
                            id: schedule.primaryEmployee.id,
                            name: schedule.primaryEmployee.name,
                            phone: schedule.primaryEmployee.phone ?? null,
                        }
                        : null,
                    secondaryEmployee: schedule?.secondaryEmployee
                        ? {
                            id: schedule.secondaryEmployee.id,
                            name: schedule.secondaryEmployee.name,
                            phone: schedule.secondaryEmployee.phone ?? null,
                        }
                        : null,
                    // Guard against legacy rows whose date columns are null at the DB
                    // level even though the schema now types them non-null — calling
                    // toISOString() on such a null throws and 500s the whole overview.
                    pendingScheduleChange:
                        pendingScheduleChange
                        && pendingScheduleChange.fromDate
                        && pendingScheduleChange.toDate
                        && pendingScheduleChange.oldEndDate
                        && pendingScheduleChange.newEndDate
                        ? {
                            id: pendingScheduleChange.id,
                            sessionIndex: pendingScheduleChange.sessionIndex,
                            fromDate: pendingScheduleChange.fromDate.toISOString().slice(0, 10),
                            toDate: pendingScheduleChange.toDate.toISOString().slice(0, 10),
                            oldEndDate: pendingScheduleChange.oldEndDate.toISOString().slice(0, 10),
                            newEndDate: pendingScheduleChange.newEndDate.toISOString().slice(0, 10),
                        }
                        : null,
                };
            });

        // Batch update clients whose status changed (non-blocking)
        if (clientsNeedingUpdate.length > 0) {
            this.updateServiceStatusesInBackground(branchid, clientsNeedingUpdate);
        }

        return result;
    }

    /**
     * Background update of service statuses (fire-and-forget)
     * Does not block the main response
     */
    private updateServiceStatusesInBackground(
        branchid: string,
        updates: {
            id: number;
            expectedServiceStatus: string | null;
            newStatus: ServiceStatusType;
        }[],
    ): void {
        // Use Promise.allSettled to handle each update independently
        Promise.allSettled(
            updates.map(async ({ id, expectedServiceStatus, newStatus }) => {
                try {
                    const result = await this.clientRepository.updateServiceStatusIfCurrent(
                        branchid,
                        id,
                        expectedServiceStatus,
                        newStatus,
                    );
                    if (result === "updated") {
                        this.logger.debug(`Updated client ${id} service status to ${newStatus}`);
                    } else {
                        this.logger.debug(`Skipped stale client ${id} service status update`);
                    }
                } catch (error) {
                    this.logger.warn(`Failed to update client ${id} service status: ${error}`);
                }
            })
        ).catch(error => {
            this.logger.error(`Error in background status updates: ${error}`);
        });
    }

    /**
     * Keep client-name assignment refreshes durable when the immediate rebuild
     * cannot complete. The intent writer owns branch/schedule deduplication;
     * this helper only selects the active schedules in the caller's branch and
     * persists their existing schedule intents in one transaction.
     */
    private async persistEmployeeAssignmentRefreshIntents(
        branchId: string,
        clientId: number,
    ): Promise<void> {
        try {
            const activeSchedules = await this.prismaService.employee_schedule.findMany({
                where: { branchId, clientId, replaced: false },
                select: { id: true },
                orderBy: { id: "asc" },
            });
            const scheduleIds = [...new Set(activeSchedules.map(({ id }) => id))]
                .sort((left, right) => left - right);
            if (scheduleIds.length === 0) return;

            const intentAt = new Date();
            await this.prismaService.$transaction(async (transaction) => {
                for (const scheduleId of scheduleIds) {
                    await this.messageAutomationIntentService.persistScheduleIntent(transaction, {
                        branchId,
                        clientId,
                        scheduleId,
                        includePast: true,
                        intentAt,
                        replaceExisting: true,
                    });
                }
            });
        } catch (error) {
            this.logger.error(
                `Failed to persist employee assignment refresh retries for client ${clientId}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private mapStatusTypeToDocumentStatus(statusType?: string): DocumentStatusType {
        const normalized = normalizeEformsignStatusCode(statusType);
        if (normalized === "000") return null;

        if (COMPLETED_DOCUMENT_STATUS_TYPES.has(normalized)) return "completed";
        if (isRevokeRequestedStatus(normalized)) return "revoke_requested";
        if (REJECTED_DOCUMENT_STATUS_TYPES.has(normalized)) return "rejected";
        if (REVOKED_DOCUMENT_STATUS_TYPES.has(normalized)) return "revoked";
        if (DELETED_DOCUMENT_STATUS_TYPES.has(normalized)) return "deleted";
        if (OPENED_DOCUMENT_STATUS_TYPES.has(normalized)) return "opened";
        if (CREATED_DOCUMENT_STATUS_TYPES.has(normalized)) return "created";
        if (REQUESTED_DOCUMENT_STATUS_TYPES.has(normalized)) return "requested";
        return null;
    }

    async update(branchid: string, id: number, params: {
        name?: string;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        allowBusinessDayMismatch?: boolean;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter?: boolean | null;
        voucherClient?: boolean;
        birthday?: string | null;
        dueDate?: string | null;
        birthDate?: string | null;
        serviceStatus?: string | null;
        breastPump?: boolean;
        allowSaturdayService?: boolean;
        allowSundayService?: boolean;
        allowHolidayService?: boolean;
        eDocId?: string | null;
        areaId?: string | null;
        smsAutomationEnabled?: boolean;
        /**
         * Optimistic guard for callers that compute a change from a snapshot
         * (the holiday review fix). When supplied, the locked client row's end
         * date (`YYYY-MM-DD`, or null) must still equal it; otherwise the write
         * is rejected with 409 SERVICE_RECORD_WRITE_TARGET_CHANGED. Not a field
         * to update.
         */
        expectedEndDate?: string | null;
    }, beforeWrite?: (transaction: Prisma.TransactionClient) => Promise<void>): Promise<ClientEntity> {
        // Keep invalid phone input from reaching lifecycle/provider work or a
        // transaction that could partially mutate schedule state.
        assertClientPhoneInput(params.phone);
        // Get existing client
        const existingClient = await this.findClientByIdUsecase.execute(branchid, id);
        if (!existingClient) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }

        for (const field of [
            "name",
            "voucherClient",
            "breastPump",
            "allowSaturdayService",
            "allowSundayService",
            "allowHolidayService",
        ] as const) {
            if (Object.prototype.hasOwnProperty.call(params, field) && params[field] === null) {
                throw new BadRequestException(clientProblemBody("VALIDATION_FAILED", {
                    pointer: `/${field}`,
                    code: "REQUIRED",
                    detail: `${field} 항목은 비울 수 없습니다.`,
                    location: "body",
                }));
            }
        }

        const hasRequestedUpdate = Object.entries(params).some(
            ([field, value]) => field !== "expectedEndDate" && value !== undefined,
        );
        if (!hasRequestedUpdate) {
            const existingPhone = normalizePhone(existingClient.phone);
            if (existingPhone) {
                await this.linkContractDocumentsByPhone(branchid, existingClient, existingPhone);
            }
            return existingClient;
        }

        const hasPricingUpdate = params.voucherClient !== undefined
            || params.type !== undefined
            || params.duration !== undefined
            || params.fullPrice !== undefined
            || params.grant !== undefined
            || params.actualPrice !== undefined;
        const normalizedPricing = hasPricingUpdate
            ? normalizeClientPricing({
                voucherClient: params.voucherClient ?? existingClient.voucherClient,
                type: params.type === undefined ? existingClient.type : params.type,
                fullPrice: params.fullPrice === undefined ? existingClient.fullPrice : params.fullPrice,
                grant: params.grant === undefined ? existingClient.grant : params.grant,
                actualPrice: params.actualPrice === undefined ? existingClient.actualPrice : params.actualPrice,
            })
            : null;
        assertAllowedServiceStatus(params.serviceStatus);
        await assertAllowedClientArea(this.prismaService, branchid, params.areaId);
        const startDateUpdate = params.startDate === undefined ? undefined : parseClientDate(params.startDate, "startDate");
        const endDateUpdate = params.endDate === undefined ? undefined : parseClientDate(params.endDate, "endDate");
        // Parsed the same way as the service period above and as create() does,
        // rather than with a raw `new Date`: that reads "2026-08" as 1 August
        // and hands anything it cannot parse to Prisma as an Invalid Date. Both
        // become a 400 here instead, and before the transaction opens.
        const dueDateUpdate = params.dueDate === undefined ? undefined : parseClientDate(params.dueDate, "dueDate");
        const birthDateUpdate = params.birthDate === undefined ? undefined : parseClientDate(params.birthDate, "birthDate");
        const { existingClient: clientWithPhone } = await findClientByNormalizedPhone(
            this.clientRepository,
            branchid,
            params.phone,
        );
        if (clientWithPhone && clientWithPhone.id !== id) {
            throw new ConflictException(clientProblemBody("CLIENT_PHONE_ALREADY_REGISTERED", {
                pointer: "/phone",
                code: "INVALID_VALUE",
                detail: "같은 전화번호의 고객이 이미 등록되어 있습니다.",
                location: "body",
            }));
        }

        // Keep the display value untouched while persisting the canonical
        // identity key used by branch-scoped uniqueness and lookups.
        const normalizedPhoneUpdate = params.phone === undefined
            ? undefined
            : normalizePhone(params.phone);

        const mergedServicePeriod = mergeAndValidateClientServicePeriod(existingClient, {
            startDate: startDateUpdate,
            endDate: endDateUpdate,
        });
        const hasDateUpdate = params.startDate !== undefined || params.endDate !== undefined;
        // SAVED computation: validates and persists the duration. The same
        // calendar instance is reused for the locked re-check below.
        const calendar = await this.holidayCalendar.forBranch(branchid, { fresh: true });
        // Duration is judged on the client's effective service days (current
        // flags with this patch applied); `calendar` itself stays the plain
        // branch calendar for the lifecycle calls.
        const derivedDuration = deriveClientDuration(
            mergedServicePeriod.startDate,
            mergedServicePeriod.endDate,
            calendar.withServiceDays(mergeServiceDayPolicy(existingClient, params)),
        );
        assertClientDurationMatchesDates(params.duration, derivedDuration, params.allowBusinessDayMismatch);
        if (hasDateUpdate && params.duration === null && derivedDuration !== null) {
            throw new BadRequestException(clientProblemBody("CLIENT_DURATION_OUT_OF_RANGE", {
                pointer: "/duration",
                code: "OUT_OF_RANGE",
                detail: clientDurationOutOfRangeMessage(derivedDuration),
                location: "body",
            }));
        }
        if (hasDateUpdate && derivedDuration === null && params.duration !== undefined && params.duration !== null) {
            throw new BadRequestException(clientProblemBody("CLIENT_DURATION_NEEDS_SERVICE_PERIOD", {
                pointer: "/duration",
                code: "REQUIRED",
                detail: CLIENT_DURATION_NEEDS_SERVICE_PERIOD_MESSAGE,
                location: "body",
            }));
        }
        // duration is the contracted session count and is authoritative once
        // set: a supplied value always wins and is never overwritten by the
        // date-derived count. When the caller omits duration it is left
        // untouched (undefined => no column update), except to fill a null
        // duration once the service period becomes complete, so a client
        // created without dates still ends up with a persisted count.
        // Check if employee assignment is being changed
        const employeeChanged = params.primaryEmployeeId !== undefined || params.secondaryEmployeeId !== undefined;
        const clientNameSupplied = params.name !== undefined;

        let createdScheduleId: number | null = null;
        let replacedScheduleId: number | null = null;
        // Status inputs of the locked row the write is based on, kept to tell
        // after commit whether this save took the client out of 예약 전.
        let priorStatusInputs: {
            serviceStatus: string | null;
            bookingConfirmedAt: Date | null;
            startDate: Date | null;
            endDate: Date | null;
        } | null = null;
        const ordinaryMutationId = randomUUID();

        const writeTransaction = async (transaction: Prisma.TransactionClient): Promise<void> => {
            // Internal callers can claim their source decision atomically with this write.
            await beforeWrite?.(transaction);
            // Always serialize client-owned service-record state before any
            // update write. The policy rereads historical schedules after the
            // client lock and locks their complete employee union, plus any
            // newly requested providers, so nested lifecycle reconciliation
            // cannot expand the lock set after the case lock.
            await lockServiceRecordWriteSet(transaction, {
                branchId: branchid,
                clientId: id,
                employeeIds: employeeChanged
                    ? [params.primaryEmployeeId, params.secondaryEmployeeId]
                    : [],
            });

            const completeWriteSurface = typeof transaction.$queryRaw === "function"
                && typeof transaction.employee_schedule?.findMany === "function"
                && typeof transaction.service_record_case?.findUnique === "function";
            const lockedClient = typeof transaction.client.findUnique === "function"
                ? await transaction.client.findUnique({
                    where: { id },
                    select: {
                        id: true,
                        branchId: true,
                        name: true,
                        address: true,
                        phone: true,
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
                        birthDate: true,
                        serviceStatus: true,
                        bookingConfirmedAt: true,
                        breastPump: true,
                        allowSaturdayService: true,
                        allowSundayService: true,
                        allowHolidayService: true,
                        eDocId: true,
                        areaId: true,
                    },
                })
                : null;
            if (
                completeWriteSurface
                && (!lockedClient || (
                    lockedClient.branchId !== null
                    && lockedClient.branchId !== branchid
                ))
            ) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            // Narrow unit doubles do not expose the complete service-record
            // delegates. Production always takes the locked reread above;
            // retaining the preflight entity here keeps those doubles focused
            // on the client repository seam.
            const currentClient = lockedClient ?? existingClient;
            priorStatusInputs = {
                serviceStatus: currentClient.serviceStatus ?? null,
                bookingConfirmedAt: currentClient.bookingConfirmedAt,
                startDate: currentClient.startDate ?? null,
                endDate: currentClient.endDate ?? null,
            };
            if (
                params.expectedEndDate !== undefined
                && (currentClient.endDate?.toISOString().slice(0, 10) ?? null) !== params.expectedEndDate
            ) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            const lockedMergedServicePeriod = mergeAndValidateClientServicePeriod(currentClient, {
                startDate: startDateUpdate,
                endDate: endDateUpdate,
            });
            // Rule 고객-04: a save cannot move the client into or out of 예약 전;
            // judged on the locked row with the dates as they will be after this
            // save. Throws (nothing is written yet) or yields what to store.
            const savedServiceStatus = resolveSavedServiceStatus({
                currentServiceStatus: currentClient.serviceStatus ?? null,
                bookingConfirmedAt: currentClient.bookingConfirmedAt ?? null,
                startDate: lockedMergedServicePeriod.startDate,
                endDate: lockedMergedServicePeriod.endDate,
                suppliedServiceStatus: params.serviceStatus,
            });
            const lockedHasDateUpdate = params.startDate !== undefined || params.endDate !== undefined;
            const lockedDerivedDuration = deriveClientDuration(
                lockedMergedServicePeriod.startDate,
                lockedMergedServicePeriod.endDate,
                calendar.withServiceDays(mergeServiceDayPolicy(currentClient, params)),
            );
            assertClientDurationMatchesDates(
                params.duration,
                lockedDerivedDuration,
                params.allowBusinessDayMismatch,
            );
            if (lockedHasDateUpdate && params.duration === null && lockedDerivedDuration !== null) {
                throw new BadRequestException(clientProblemBody("CLIENT_DURATION_OUT_OF_RANGE", {
                    pointer: "/duration",
                    code: "OUT_OF_RANGE",
                    detail: clientDurationOutOfRangeMessage(lockedDerivedDuration),
                    location: "body",
                }));
            }
            if (
                lockedHasDateUpdate
                && lockedDerivedDuration === null
                && params.duration !== undefined
                && params.duration !== null
            ) {
                throw new BadRequestException(clientProblemBody("CLIENT_DURATION_NEEDS_SERVICE_PERIOD", {
                    pointer: "/duration",
                    code: "REQUIRED",
                    detail: CLIENT_DURATION_NEEDS_SERVICE_PERIOD_MESSAGE,
                    location: "body",
                }));
            }
            const duration = params.duration !== undefined
                ? params.duration
                : currentClient.duration === null && lockedDerivedDuration !== null
                    ? lockedDerivedDuration
                    : undefined;
            await this.serviceRecordLifecycleService?.validatePeriodChange({
                clientId: id,
                startDate: startDateUpdate,
                endDate: endDateUpdate,
                duration,
            }, transaction);
            const lockedPricing = hasPricingUpdate
                ? normalizeClientPricing({
                    voucherClient: params.voucherClient ?? currentClient.voucherClient,
                    type: params.type === undefined ? currentClient.type : params.type,
                    fullPrice: params.fullPrice === undefined ? currentClient.fullPrice : params.fullPrice,
                    grant: params.grant === undefined ? currentClient.grant : params.grant,
                    actualPrice: params.actualPrice === undefined ? currentClient.actualPrice : params.actualPrice,
                })
                : normalizedPricing;
            const startDate = lockedMergedServicePeriod.startDate ?? new Date();
            const endDate = lockedMergedServicePeriod.endDate
                ?? new Date(startDate.getTime() + DEFAULT_SERVICE_PERIOD_MS);

            // Read the current automation source while the service-record and
            // branch locks are held. The planner is advisory for ordinary
            // writes: only a complete, available result can append an
            // ordinary successor; an unavailable read leaves the existing
            // task lineage in place and the materializer fails closed.
            const automationImpact = this.clientAutomationImpact?.planClientWriteInTransaction && this.agentAutomationRecordStore
                ? await this.clientAutomationImpact.planClientWriteInTransaction(transaction, branchid, {
                    kind: "update",
                    clientId: id,
                    values: {
                        name: params.name,
                        phone: params.phone === undefined ? undefined : normalizedPhoneUpdate,
                        type: lockedPricing?.type,
                        startDate: startDateUpdate,
                        endDate: endDateUpdate,
                        duration,
                        fullPrice: lockedPricing?.fullPrice,
                        grant: lockedPricing?.grant,
                        actualPrice: lockedPricing?.actualPrice,
                        areaId: params.areaId,
                    },
                })
                : null;

            if (employeeChanged) {
                const currentSchedule = await transaction.employee_schedule.findFirst({
                    where: { clientId: id, branchId: branchid, replaced: false },
                    orderBy: { id: "desc" },
                });
                const currentPrimaryEmployeeId = currentSchedule?.primaryEmployeeId ?? null;
                const currentSecondaryEmployeeId = currentSchedule?.secondaryEmployeeId ?? null;
                const primaryEmployeeId = params.primaryEmployeeId ?? currentPrimaryEmployeeId;
                const secondaryEmployeeId = params.secondaryEmployeeId !== undefined
                    ? params.secondaryEmployeeId
                    : currentSecondaryEmployeeId;
                assertEmployeeAssignmentShape(primaryEmployeeId, secondaryEmployeeId);
                const assignmentChanged = primaryEmployeeId !== currentPrimaryEmployeeId
                    || secondaryEmployeeId !== currentSecondaryEmployeeId;
                if (assignmentChanged) {
                    if (primaryEmployeeId === null) {
                        throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                            pointer: "/primaryEmployeeId",
                            code: "REQUIRED",
                            detail: "배정을 만들려면 주 담당 인력이 필요해요.",
                            location: "body",
                        }));
                    }
                    const retainedEmployeeIds = new Set(
                        [currentPrimaryEmployeeId, currentSecondaryEmployeeId]
                            .filter((employeeId): employeeId is number => employeeId !== null),
                    );
                    await this.assertAllowedEmployees(
                        branchid,
                        primaryEmployeeId,
                        secondaryEmployeeId,
                        transaction,
                        retainedEmployeeIds,
                        true,
                    );
                    // One handover instant for the whole transaction. The outgoing row has to
                    // end on exactly the day the incoming row starts, so the clock is read
                    // once here rather than per write, where the two could straddle midnight.
                    const handover = currentSchedule
                        ? ((): { outgoingEndDate: Date; startDate: Date; endDate: Date } => {
                            const outgoingEndDate = employeeScheduleReplacementEndDate(
                                this.kstCalendarDay(new Date()),
                                currentSchedule.startDate,
                            );
                            return {
                                outgoingEndDate,
                                ...employeeScheduleHandoverPeriod({
                                    replacementAt: outgoingEndDate,
                                    contractStartDate: startDate,
                                    contractEndDate: endDate,
                                }),
                            };
                        })()
                        : null;
                    // A first assignment keeps the contract period; only a handover moves the start.
                    const incomingStartDate = handover?.startDate ?? startDate;
                    const incomingEndDate = handover?.endDate ?? endDate;
                    await assertNoActiveEmployeeScheduleOverlap(transaction, {
                        branchId: branchid,
                        clientId: id,
                        primaryEmployeeId,
                        secondaryEmployeeId,
                        startDate: incomingStartDate,
                        endDate: incomingEndDate,
                        replaced: false,
                        excludeScheduleId: currentSchedule?.id,
                    });
                    if (currentSchedule && handover) {
                        await this.agentAutomationRecordStore?.appendScheduleWriteFence(transaction, {
                            branchId: branchid,
                            clientId: id,
                            mutationId: ordinaryMutationId,
                            scheduleIds: [currentSchedule.id],
                        });
                        await transaction.employee_schedule.update({
                            where: { id: currentSchedule.id },
                            data: {
                                replaced: true,
                                endDate: handover.outgoingEndDate,
                            },
                        });
                        replacedScheduleId = currentSchedule.id;
                    }
                    const schedule = await transaction.employee_schedule.create({
                        data: {
                            clientId: id,
                            branchId: branchid,
                            primaryEmployeeId,
                            secondaryEmployeeId,
                            workAddress: params.address ?? currentClient.address ?? "",
                            startDate: incomingStartDate,
                            endDate: incomingEndDate,
                            replaced: false,
                        },
                    });
                    createdScheduleId = schedule.id;
                }
            }

            const clientUpdateData = {
                name: params.name,
                address: params.address === undefined ? undefined : params.address,
                phone: params.phone === undefined ? undefined : params.phone,
                phoneNormalized: normalizedPhoneUpdate,
                type: lockedPricing?.type,
                duration: duration === undefined ? undefined : duration,
                fullPrice: lockedPricing?.fullPrice,
                grant: lockedPricing?.grant,
                actualPrice: lockedPricing?.actualPrice,
                startDate: startDateUpdate,
                endDate: endDateUpdate,
                careCenter: params.careCenter === undefined ? undefined : params.careCenter,
                voucherClient: params.voucherClient,
                birthday: params.birthday === undefined ? undefined : params.birthday,
                dueDate: dueDateUpdate,
                birthDate: birthDateUpdate,
                serviceStatus: savedServiceStatus,
                breastPump: params.breastPump,
                allowSaturdayService: params.allowSaturdayService,
                allowSundayService: params.allowSundayService,
                allowHolidayService: params.allowHolidayService,
                eDocId: params.eDocId === undefined ? undefined : params.eDocId,
                areaId: params.areaId === undefined ? undefined : params.areaId,
                smsAutomationEnabled: params.smsAutomationEnabled,
            };
            // An employee-only edit still owns the client lock and may create
            // a replacement schedule, but Prisma reports zero rows for an
            // updateMany whose data is entirely undefined. Keep the target
            // existence guard while avoiding a false NotFound after the
            // schedule write.
            if (Object.values(clientUpdateData).some((value) => value !== undefined)) {
                const result = await transaction.client.updateMany({
                    where: { id, branchId: branchid },
                    data: clientUpdateData,
                });
                if (result.count === 0) {
                    throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
                }
            } else if (!currentClient) {
                throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
            }
            await this.serviceRecordLifecycleService?.ensureForClient(id, transaction, calendar);
            if (
                automationImpact
                && automationImpact.availability === "available"
                && automationImpact.complete
                && automationImpact.effects.length > 0
            ) {
                const clientEffects = automationImpact.effects.filter(
                    (effect): effect is AgentAutomationEffect => effect.kind === "client-rule",
                );
                if (clientEffects.length > 0) {
                    await this.agentAutomationRecordStore!.appendOrdinarySuccessors(transaction, {
                        branchId: branchid,
                        clientId: id,
                        mutationId: ordinaryMutationId,
                        operation: "client-write",
                        effects: clientEffects,
                    });
                }
            }
        };

        if (this.messageAutomationBranchLockService) {
            await this.messageAutomationBranchLockService.runExclusive(branchid, writeTransaction);
        } else {
            await this.prismaService.$transaction(writeTransaction);
        }

        if (replacedScheduleId !== null) {
            await this.revokeServiceRecordLinkAfterCommit(id, replacedScheduleId);
        }
        const updatedClient = await this.findClientByIdUsecase.execute(branchid, id);
        if (!updatedClient) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }
        const updatedPhone = normalizePhone(updatedClient.phone);
        if (updatedPhone) {
            await this.linkContractDocumentsByPhone(branchid, updatedClient, updatedPhone);
        }
        if (this.triggerService) {
            await this.triggerService.syncClientRulesForClient(branchid, id, false).catch((error) => {
                this.logger.error(`Failed to sync client trigger rules: ${error}`);
            });
            if (clientNameSupplied) {
                try {
                    const refreshed = await this.triggerService.syncEmployeeAssignmentRulesForClient(branchid, id);
                    if (refreshed === false) {
                        await this.persistEmployeeAssignmentRefreshIntents(branchid, id);
                    }
                } catch (error) {
                    this.logger.error(`Failed to sync employee assignment triggers for client ${id}: ${error}`);
                    await this.persistEmployeeAssignmentRefreshIntents(branchid, id);
                }
            }
        }
        if (createdScheduleId !== null) {
            if (!clientNameSupplied) {
                await this.triggerService
                    ?.syncEmployeeAssignmentRulesForSchedule(branchid, createdScheduleId, true)
                    ?.catch((error) => {
                        this.logger.error(`Failed to sync employee assignment triggers: ${error}`);
                    });
            }
            await this.serviceRecordLinkService
                ?.scheduleForServiceStart(createdScheduleId)
                ?.catch((error) => {
                    this.logger.error(`Failed to schedule service-record link SMS: ${error}`);
                });
        }
        await this.scheduleServiceRecordLinksAfterLeavingPreBooking(
            branchid,
            id,
            priorStatusInputs,
            updatedClient,
            createdScheduleId,
        );
        return updatedClient;
    }

    /**
     * A provider assigned while the client was 예약 전 never got the service-record
     * link SMS (the gates skip a pre-booking client). When a save takes the client
     * out of 예약 전, schedule the link for every active schedule the save did not
     * already schedule. `scheduleForServiceStart` owns the timing (the day before
     * service start at 12:00 KST, or immediately when that has passed), the
     * dedupe and the completed/terminated/expired refusals. A failure here never
     * fails the save.
     */
    private async scheduleServiceRecordLinksAfterLeavingPreBooking(
        branchId: string,
        clientId: number,
        before: { serviceStatus: string | null; startDate: Date | null; endDate: Date | null; bookingConfirmedAt: Date | null } | null,
        after: { serviceStatus?: string | null; startDate?: Date | null; endDate?: Date | null; bookingConfirmedAt: Date | null },
        alreadyScheduledScheduleId: number | null,
    ): Promise<void> {
        if (!before || !this.serviceRecordLinkService) return;
        const wasPreBooking = getEffectiveClientServiceStatus(
            before.serviceStatus,
            before.startDate,
            before.endDate,
            before.bookingConfirmedAt,
        ) === SERVICE_STATUS.PRE_BOOKING;
        if (!wasPreBooking) return;
        const isPreBooking = getEffectiveClientServiceStatus(
            after.serviceStatus ?? null,
            after.startDate ?? null,
            after.endDate ?? null,
            after.bookingConfirmedAt,
        ) === SERVICE_STATUS.PRE_BOOKING;
        if (isPreBooking) return;

        try {
            const activeSchedules = await this.prismaService.employee_schedule.findMany({
                where: { branchId, clientId, replaced: false, terminatedAt: null },
                select: { id: true },
                orderBy: { id: "asc" },
            });
            const scheduleIds = [...new Set(activeSchedules.map(({ id }) => id))]
                .filter((scheduleId) => scheduleId !== alreadyScheduledScheduleId)
                .sort((left, right) => left - right);
            for (const scheduleId of scheduleIds) {
                await this.serviceRecordLinkService.scheduleForServiceStart(scheduleId).catch((error) => {
                    this.logger.error(`Failed to schedule service-record link SMS: ${error}`);
                });
            }
        } catch (error) {
            this.logger.error(
                `Failed to schedule service-record link SMS after client ${clientId} left pre-booking: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Terminate a client's service (manual status change)
     * Sets serviceStatus to 'terminated' and ends the service immediately
     * @param clientId - The client ID
     * @param reason - Optional termination reason for logging
     */
    async terminateService(
        branchid: string,
        clientId: number,
        reason?: string
    ): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }
        this.logger.log(
            `Terminating service for client ${clientId}` +
            (reason ? `: ${reason}` : "")
        );

        // Update the client, mark schedules, and advance the service-record
        // case in one owning transaction. Passing the transaction through the
        // update usecase avoids a nested root transaction while locks are held.
        const terminationAt = new Date();
        const kstToday = getKstCalendarDate(terminationAt, 0);
        const startDate = client.startDate?.toISOString().slice(0, 10);
        const terminationEndDate = new Date(startDate && startDate > kstToday ? startDate : kstToday);
        const ordinaryMutationId = randomUUID();
        // SAVED computation (the update re-derives the persisted duration):
        // read the branch calendar before the transaction opens, never inside
        // it, so the locked client row does not wait on a second pooled
        // connection.
        const calendar = await this.holidayCalendar.forBranch(branchid, { fresh: true });
        const updatedClient = await this.prismaService.$transaction(async (transaction) => {
            const existingCase = transaction.service_record_case?.findUnique
                ? await transaction.service_record_case.findUnique({
                    where: { clientId },
                    select: { id: true, branchId: true, clientId: true },
                })
                : null;
            const schedules = transaction.employee_schedule?.findMany
                ? await transaction.employee_schedule.findMany({
                    where: { clientId, branchId: branchid },
                    select: {
                        id: true,
                        primaryEmployeeId: true,
                        secondaryEmployeeId: true,
                    },
                    orderBy: { id: "asc" },
                })
                : [];
            await lockServiceRecordWriteSet(transaction, {
                branchId: branchid,
                clientId,
                caseId: existingCase?.branchId === branchid && existingCase.clientId === clientId
                    ? existingCase.id
                    : undefined,
                expectedScheduleIds: schedules.map((schedule) => schedule.id),
                scheduleIds: schedules.map((schedule) => schedule.id),
                employeeIds: schedules.flatMap((schedule) => [
                    schedule.primaryEmployeeId,
                    schedule.secondaryEmployeeId,
                ]),
            });
            await this.agentAutomationRecordStore?.appendScheduleWriteFence(transaction, {
                branchId: branchid,
                clientId,
                mutationId: ordinaryMutationId,
                scheduleIds: schedules.map((schedule) => schedule.id),
            });
            // Revalidate after the client and dependent rows are locked. The
            // initial existence lookup is only a fast preflight.
            await this.serviceRecordLifecycleService?.validatePeriodChange({
                clientId,
                endDate: terminationEndDate,
            }, transaction);
            const updated = await this.updateClientUsecase.execute(branchid, clientId, {
                serviceStatus: SERVICE_STATUS.TERMINATED,
                endDate: terminationEndDate,
            }, transaction, calendar);
            await transaction.employee_schedule.updateMany({
                where: { clientId, branchId: branchid, replaced: false, terminatedAt: null },
                data: { terminatedAt: terminationAt },
            });
            await this.serviceRecordLifecycleService?.markTerminated(clientId, transaction);
            return updated;
        });
        if (this.triggerService) {
            await this.triggerService.syncClientRulesForClient(branchid, clientId, false).catch((error) => {
                this.logger.error(`Failed to sync client trigger rules: ${error}`);
            });
        }

        // Also mark the current schedules as terminated. This records the termination
        // on its own column rather than overwriting end_date: the contracted period
        // stays readable, and a service terminated before it started can no longer
        // produce start_date > end_date. Readers that ask "is this assignment live"
        // filter on terminatedAt, not on the dates.
        // Revoke any outstanding service-record links for this client's active assignments
        const activeSchedules = await this.prismaService.employee_schedule.findMany({
            where: { clientId, branchId: branchid, replaced: false },
            select: { id: true },
        });
        for (const activeSchedule of activeSchedules) {
            await this.revokeServiceRecordLinkAfterCommit(clientId, activeSchedule.id);
        }
        return updatedClient;
    }

    /**
     * Request a provider replacement for a client
     * Sets serviceStatus to 'replacement_requested' to indicate pending change
     * @param clientId - The client ID
     * @param newPrimaryEmployeeId - The new primary employee to assign
     * @param newSecondaryEmployeeId - Optional new secondary employee
     */
    async requestReplacement(
        branchid: string,
        clientId: number,
        newPrimaryEmployeeId: number,
        newSecondaryEmployeeId?: number | null,
    ): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }
        // The replacement DTO spells its request-body fields with the `new`
        // prefix, so the shape problems must carry those pointers for UIs.
        assertEmployeeAssignmentShape(newPrimaryEmployeeId, newSecondaryEmployeeId ?? null, {
            primary: "/newPrimaryEmployeeId",
            secondary: "/newSecondaryEmployeeId",
        });

        // This preflight only validates the caller's snapshot. The actual
        // replacement period is derived again from the locked client below.
        mergeAndValidateClientServicePeriod(client, {});

        this.logger.log(
            `Replacement requested for client ${clientId}: ` +
            `new primary=${newPrimaryEmployeeId}, secondary=${newSecondaryEmployeeId ?? "none"}`
        );

        let replacedScheduleId: number | null = null;
        const ordinaryMutationId = randomUUID();
        // The lifecycle sync reads the branch calendar through the root client,
        // so it is resolved before the owning transaction takes a connection.
        const calendar = await this.serviceRecordLifecycleService
            ?.resolveCalendarBeforeTransaction(clientId);
        const replacementSchedule = await this.prismaService.$transaction(async (transaction) => {
            // Lock the full historical schedule/employee union before any
            // case or schedule write. The requested providers are part of the
            // same deterministic employee lock set.
            await lockServiceRecordWriteSet(transaction, {
                branchId: branchid,
                clientId,
                employeeIds: [newPrimaryEmployeeId, newSecondaryEmployeeId],
            });

            const completeWriteSurface = typeof transaction.$queryRaw === "function"
                && typeof transaction.employee_schedule?.findMany === "function"
                && typeof transaction.service_record_case?.findUnique === "function";
            const lockedClient = typeof transaction.client.findUnique === "function"
                ? await transaction.client.findUnique({
                    where: { id: clientId },
                    select: {
                        id: true,
                        branchId: true,
                        address: true,
                        startDate: true,
                        endDate: true,
                        duration: true,
                        serviceStatus: true,
                        bookingConfirmedAt: true,
                    },
                })
                : null;
            if (
                completeWriteSurface
                && (!lockedClient || (
                    lockedClient.branchId !== null
                    && lockedClient.branchId !== branchid
                ))
            ) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            const currentClient = lockedClient ?? client;
            // Rule 기록-09: a 예약 전 client has no service-record case and no
            // provider link. A replacement would write replacement_requested,
            // which makes ensureForClient create the case and lets the link
            // gate pass, so it is refused before anything is written.
            if (getEffectiveClientServiceStatus(
                currentClient.serviceStatus ?? null,
                currentClient.startDate ?? null,
                currentClient.endDate ?? null,
                currentClient.bookingConfirmedAt,
            ) === SERVICE_STATUS.PRE_BOOKING) {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/id",
                    code: "INVALID_VALUE",
                    detail: PRE_BOOKING_REPLACEMENT_REFUSAL_DETAIL,
                    location: "path",
                }));
            }
            mergeAndValidateClientServicePeriod(currentClient, {});
            // Use the owning transaction's timestamp so a client edit that
            // waited on this lock cannot derive a replacement from a stale
            // preflight clock or an invented value.
            // The handover is dated by the Korean calendar day of that instant.
            const replacementStartDate = this.kstCalendarDay(await this.transactionNow(transaction));
            const replacementEndDate = currentClient.endDate
                && currentClient.endDate.getTime() >= replacementStartDate.getTime()
                ? currentClient.endDate
                : new Date(replacementStartDate.getTime() + DEFAULT_SERVICE_PERIOD_MS);
            const currentSchedule = await transaction.employee_schedule.findFirst({
                where: { clientId, branchId: branchid, replaced: false },
                orderBy: { id: "desc" },
            });
            const retainedEmployeeIds = new Set(
                [currentSchedule?.primaryEmployeeId ?? null, currentSchedule?.secondaryEmployeeId ?? null]
                    .filter((employeeId): employeeId is number => employeeId !== null),
            );
            await this.assertAllowedEmployees(
                branchid,
                newPrimaryEmployeeId,
                newSecondaryEmployeeId ?? null,
                transaction,
                retainedEmployeeIds,
                true,
            );
            await assertNoActiveEmployeeScheduleOverlap(transaction, {
                branchId: branchid,
                clientId,
                primaryEmployeeId: newPrimaryEmployeeId,
                secondaryEmployeeId: newSecondaryEmployeeId ?? null,
                startDate: replacementStartDate,
                endDate: replacementEndDate,
                replaced: false,
                excludeScheduleId: currentSchedule?.id,
            });
            const updateResult = await transaction.client.updateMany({
                where: { id: clientId, branchId: branchid },
                data: { serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED },
            });
            if (updateResult.count === 0) {
                throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
            }

            if (currentSchedule) {
                await this.agentAutomationRecordStore?.appendScheduleWriteFence(transaction, {
                    branchId: branchid,
                    clientId,
                    mutationId: ordinaryMutationId,
                    scheduleIds: [currentSchedule.id],
                });
                await transaction.employee_schedule.update({
                    where: { id: currentSchedule.id },
                    data: {
                        replaced: true,
                        endDate: employeeScheduleReplacementEndDate(replacementStartDate, currentSchedule.startDate),
                    },
                });
                replacedScheduleId = currentSchedule.id;
            }

            const createdSchedule = await transaction.employee_schedule.create({
                data: {
                    clientId,
                    branchId: branchid,
                    primaryEmployeeId: newPrimaryEmployeeId,
                    secondaryEmployeeId: newSecondaryEmployeeId ?? null,
                    workAddress: currentClient.address ?? "",
                    startDate: replacementStartDate,
                    endDate: replacementEndDate,
                    replaced: false,
                },
            });
            await this.serviceRecordLifecycleService?.ensureForClient(clientId, transaction, calendar);
            return createdSchedule;
        });
        if (replacedScheduleId !== null) {
            await this.revokeServiceRecordLinkAfterCommit(clientId, replacedScheduleId);
        }
        await this.triggerService
            ?.syncEmployeeAssignmentRulesForSchedule(branchid, replacementSchedule.id, true)
            ?.catch((error) => {
                this.logger.error(`Failed to sync replacement assignment triggers: ${error}`);
            });
        await this.serviceRecordLinkService
            ?.scheduleForServiceStart(replacementSchedule.id)
            ?.catch((error) => {
                this.logger.error(`Failed to schedule replacement service-record link SMS: ${error}`);
            });

        const updatedClient = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!updatedClient) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }
        return updatedClient;
    }

    /**
     * Complete a replacement and restore service to active status
     * Call this after the replacement has been processed
     * @param clientId - The client ID
     */
    async completeReplacement(branchid: string, clientId: number): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }

        if (client.serviceStatus !== SERVICE_STATUS.REPLACEMENT_REQUESTED) {
            this.logger.warn(
                `Client ${clientId} is not in replacement_requested status, ` +
                `current status: ${client.serviceStatus}`
            );
        }

        this.logger.log(`Completing replacement for client ${clientId}`);

        // SAVED computation: loaded before the transaction opens (see
        // terminateService).
        const calendar = await this.holidayCalendar.forBranch(branchid, { fresh: true });
        const { updatedClient, priorStatusInputs } = await this.prismaService.$transaction(async (transaction) => {
            const existingCase = transaction.service_record_case?.findUnique
                ? await transaction.service_record_case.findUnique({
                    where: { clientId },
                    select: { id: true, branchId: true, clientId: true },
                })
                : null;
            const schedules = transaction.employee_schedule?.findMany
                ? await transaction.employee_schedule.findMany({
                    where: { clientId, branchId: branchid },
                    select: {
                        id: true,
                        primaryEmployeeId: true,
                        secondaryEmployeeId: true,
                    },
                    orderBy: { id: "asc" },
                })
                : [];
            await lockServiceRecordWriteSet(transaction, {
                branchId: branchid,
                clientId,
                caseId: existingCase?.branchId === branchid && existingCase.clientId === clientId
                    ? existingCase.id
                    : undefined,
                expectedScheduleIds: schedules.map((schedule) => schedule.id),
                scheduleIds: schedules.map((schedule) => schedule.id),
                employeeIds: schedules.flatMap((schedule) => [
                    schedule.primaryEmployeeId,
                    schedule.secondaryEmployeeId,
                ]),
            });
            // Re-read the locked client before deriving the replacement status;
            // the pre-transaction snapshot can be stale after a concurrent
            // date edit.
            const lockedClient = await this.clientRepository.findByIdForUpdate(
                branchid,
                clientId,
                transaction,
            );
            if (!lockedClient) {
                throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
            }
            const computedStatus = computeServiceStatus(
                null,
                lockedClient.startDate,
                lockedClient.endDate,
                lockedClient.bookingConfirmedAt,
            );
            const updated = await this.updateClientUsecase.execute(branchid, clientId, {
                serviceStatus: computedStatus,
            }, transaction, calendar);
            await this.serviceRecordLifecycleService?.ensureForClient(clientId, transaction, calendar);
            return {
                updatedClient: updated,
                priorStatusInputs: {
                    serviceStatus: lockedClient.serviceStatus ?? null,
                    bookingConfirmedAt: lockedClient.bookingConfirmedAt,
                    startDate: lockedClient.startDate ?? null,
                    endDate: lockedClient.endDate ?? null,
                },
            };
        });
        // 예약확정 상태는 여기서 바뀌지 않으므로 예약 전 이탈 여부를 확인하는
        // 공통 후처리는 교체 완료만으로 제공인력 링크 SMS를 예약하지 않는다.
        await this.scheduleServiceRecordLinksAfterLeavingPreBooking(
            branchid,
            clientId,
            priorStatusInputs,
            updatedClient,
            null,
        );
        return updatedClient;
    }

    /**
     * Confirm a booking (rule 고객-04): the only way a client leaves 예약 전.
     * Stores `bookingConfirmedAt` and the date-derived status in one direct
     * write under the client row lock, then repairs the service-record
     * lifecycle in the same transaction. A client that is already confirmed is
     * returned untouched and no follow-up runs, so a double click is safe.
     */
    async confirmBooking(branchid: string, clientId: number): Promise<ClientEntity> {
        const client = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!client) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }

        this.logger.log(`Confirming booking for client ${clientId}`);

        // SAVED computation: loaded before the transaction opens (see
        // completeReplacement).
        const calendar = await this.holidayCalendar.forBranch(branchid, { fresh: true });
        const refuse = (detail: string): never => {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/id",
                code: "INVALID_VALUE",
                detail,
                location: "path",
            }));
        };
        const priorStatusInputs = await this.prismaService.$transaction(async (transaction) => {
            const existingCase = transaction.service_record_case?.findUnique
                ? await transaction.service_record_case.findUnique({
                    where: { clientId },
                    select: { id: true, branchId: true, clientId: true },
                })
                : null;
            const schedules = transaction.employee_schedule?.findMany
                ? await transaction.employee_schedule.findMany({
                    where: { clientId, branchId: branchid },
                    select: {
                        id: true,
                        primaryEmployeeId: true,
                        secondaryEmployeeId: true,
                    },
                    orderBy: { id: "asc" },
                })
                : [];
            // Every outcome is judged on the locked row, never on the
            // pre-transaction snapshot. The write-set helper takes the client
            // row lock first, so locking the same row here keeps the lock
            // order unchanged and lets a client deleted before the lock answer
            // not-found instead of the helper's write-target-changed conflict.
            const lockedClient = await this.clientRepository.findByIdForUpdate(
                branchid,
                clientId,
                transaction,
            );
            if (!lockedClient) {
                throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
            }
            await lockServiceRecordWriteSet(transaction, {
                branchId: branchid,
                clientId,
                caseId: existingCase?.branchId === branchid && existingCase.clientId === clientId
                    ? existingCase.id
                    : undefined,
                expectedScheduleIds: schedules.map((schedule) => schedule.id),
                scheduleIds: schedules.map((schedule) => schedule.id),
                employeeIds: schedules.flatMap((schedule) => [
                    schedule.primaryEmployeeId,
                    schedule.secondaryEmployeeId,
                ]),
            });
            if (
                lockedClient.serviceStatus === SERVICE_STATUS.TERMINATED
                || lockedClient.serviceStatus === SERVICE_STATUS.REPLACEMENT_REQUESTED
            ) {
                return refuse("종료되었거나 교체 요청 중인 고객은 예약을 확정할 수 없습니다.");
            }
            if (lockedClient.bookingConfirmedAt) {
                return null;
            }
            if (!lockedClient.startDate || !lockedClient.endDate) {
                return refuse("서비스 시작일과 종료일을 먼저 입력해 주세요.");
            }
            const now = new Date();
            const updateResult = await transaction.client.updateMany({
                where: { id: clientId, branchId: branchid },
                data: {
                    bookingConfirmedAt: now,
                    serviceStatus: computeServiceStatus(null, lockedClient.startDate, lockedClient.endDate, now, now),
                },
            });
            if (updateResult.count === 0) {
                throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
            }
            await this.serviceRecordLifecycleService?.ensureForClient(clientId, transaction, calendar);
            return {
                serviceStatus: lockedClient.serviceStatus ?? null,
                bookingConfirmedAt: lockedClient.bookingConfirmedAt ?? null,
                startDate: lockedClient.startDate,
                endDate: lockedClient.endDate,
            };
        });

        const updatedClient = await this.findClientByIdUsecase.execute(branchid, clientId);
        if (!updatedClient) {
            throw new NotFoundException(clientCodeOnlyProblemBody("RESOURCE_NOT_FOUND", "고객을 찾을 수 없습니다."));
        }
        // Already confirmed: nothing was written, so no follow-up may run.
        if (!priorStatusInputs) return updatedClient;

        await this.triggerService?.syncClientRulesForClient(branchid, clientId, false).catch((error) => {
            this.logger.error(`Failed to sync client trigger rules: ${error}`);
        });
        await this.scheduleServiceRecordLinksAfterLeavingPreBooking(
            branchid,
            clientId,
            priorStatusInputs,
            updatedClient,
            null,
        );
        return updatedClient;
    }

    async delete(branchid: string, id: number): Promise<void> {
        const outcome = await this.deleteClientUsecase.execute(branchid, id);
        // A client with history is tombstoned in the delete transaction, which also ends
        // its open assignments and cancels its pending messages. Outstanding service-record
        // links die with those assignments, as in terminateService.
        if (outcome === "tombstoned") {
            const schedules = await this.prismaService.employee_schedule.findMany({
                where: { clientId: id, branchId: branchid, replaced: false },
                select: { id: true },
            });
            for (const schedule of schedules) {
                await this.revokeServiceRecordLinkAfterCommit(id, schedule.id);
            }
        }
        // Keep this legacy cleanup hook after a successful delete.
        await this.triggerService?.cancelPendingJobsForClientDeletion(branchid, id);
    }

    async getStats(branchid: string): Promise<{
        activeClients: number;
        contractsNotSent: number;
        contractsPendingSignature: number;
        upcomingThisMonth: number;
        upcomingNextMonth: number;
    }> {
        const now = new Date();
        // Month boundaries follow the Korean calendar date, as UTC-midnight dates
        // like the stored @db.Date start dates (the server runs in UTC).
        const { thisMonthStart, nextMonthStart, nextMonthEndExclusive } =
            getClientListDateRanges(now);

        const branchClients = await this.prismaService.client.findMany({
            where: { branchId: branchid, deletedAt: null },
            select: { id: true, startDate: true, endDate: true, serviceStatus: true, bookingConfirmedAt: true },
        });

        // Every figure below counts the DERIVED service status the client list shows
        // (getEffectiveClientServiceStatus), never the stored column, which lags until the
        // lazy update runs. Month boundaries are the KST ones from getClientListDateRanges.
        const effectiveStatusByClientId = new Map<number, ServiceStatusType>();
        let activeClients = 0;
        let upcomingThisMonth = 0;
        let upcomingNextMonth = 0;
        for (const client of branchClients) {
            const effectiveStatus = getEffectiveClientServiceStatus(
                client.serviceStatus ?? null,
                client.startDate ?? null,
                client.endDate ?? null,
                client.bookingConfirmedAt,
                now,
            );
            effectiveStatusByClientId.set(client.id, effectiveStatus);
            if (effectiveStatus === SERVICE_STATUS.ACTIVE) {
                activeClients++;
            } else if (effectiveStatus === SERVICE_STATUS.WAITING && client.startDate) {
                const startTime = client.startDate.getTime();
                if (startTime >= thisMonthStart.getTime() && startTime < nextMonthStart.getTime()) {
                    upcomingThisMonth++;
                } else if (startTime >= nextMonthStart.getTime() && startTime < nextMonthEndExclusive.getTime()) {
                    upcomingNextMonth++;
                }
            }
        }

        // 대시보드의 "검토 필요 문서"는 계약서 목록과 같은 규칙으로 센다: 제공기관
        // 검토 단계에 있고 검토 창(계약 종료 영업일 1일 전~)이 열린 문서만.
        const latestContracts = await this.findLatestContractByClientId(
            branchClients.map((client) => client.id),
        );
        const calendar = await this.holidayCalendar.forBranch(branchid);

        // "계약서 발송 필요": exactly the clients whose list row carries the "발송 필요"
        // contract badge — same effective service status, same latest-contract lookup
        // and the same business-day send window as the list (computeContractActionRequired).
        const contractsNotSent = branchClients.filter((client) =>
            this.computeContractActionRequired({
                clientId: client.id,
                now,
                serviceStatus: effectiveStatusByClientId.get(client.id) ?? null,
                startDate: client.startDate ?? null,
                hasActiveContractDocument: this.isActiveContractDocument(latestContracts.get(client.id)),
            }, calendar)?.reason === "발송 필요",
        ).length;

        const contractsPendingSignature = [...latestContracts].filter(([clientId, doc]) => {
            if (
                doc.permanentPurgeRequestedAt != null
                || isVoidedContractSignal(doc)
                || DELETED_DOCUMENT_STATUS_TYPES.has(doc.statusType.trim().padStart(3, "0"))
            ) {
                return false;
            }
            const endDate = doc.detailPayload && typeof doc.detailPayload === "object"
                ? extractEformsignContractEndDate(doc.detailPayload as unknown as EformsignApiDocumentResponse)
                : null;
            try {
                return resolveEformsignDocDisplayStatus({
                    id: doc.documentId,
                    current_status: {
                        status_type: doc.statusType,
                        step_type: doc.stepType,
                        step_name: doc.stepName,
                    },
                    ...(endDate ? { contract_end_date: endDate.toISOString().slice(0, 10) } : {}),
                }, now, calendar) === "review";
            } catch {
                // A contract end date outside the calendar's supported range must not fail the
                // whole dashboard request: leave this client out of the review-window count.
                this.warnCalendarSkip(clientId);
                return false;
            }
        }).length;

        return { activeClients, contractsNotSent, contractsPendingSignature, upcomingThisMonth, upcomingNextMonth };
    }

    async getDashboardOverview(
        branchid: string,
        limit = 50,
    ): Promise<DashboardOverview> {
        const [stats, clients] = await Promise.all([
            this.getStats(branchid),
            this.findAllPaginated(branchid, 1, limit),
        ]);

        return { stats, clients };
    }

    async getActionRequiredAlerts(
        branchid: string,
        limit = 3,
    ): Promise<ClientActionRequiredAlert[]> {
        const today = isoDateInKorea(new Date());

        // Display-only: one cached calendar instance serves both the cutoff
        // pre-filter and the per-client decision below.
        const calendar = await this.holidayCalendar.forBranch(branchid);

        // The window is business days, which spans more calendar days than its
        // count. computeActionRequired counts the business days in (today, start],
        // so a start inside the window is any date before the business day just past
        // it — including a weekend or holiday after the last one. Translate that into
        // an exclusive calendar bound so this pre-filter only narrows the scan;
        // computeActionRequired still decides (it alone knows whether the latest
        // document is active).
        // The bound is only an optimisation: when its horizon runs past the supported holiday
        // years (late December) scan without it; computeActionRequired still decides per client.
        let startDateBound: Prisma.clientWhereInput["startDate"] = { not: null };
        try {
            startDateBound = {
                lt: new Date(
                    `${calendar.addBusinessDays(today, CONTRACT_SEND_BUSINESS_DAYS_THRESHOLD + 1)}T00:00:00.000Z`,
                ),
            };
        } catch {
            this.logger.warn(
                "Action-required scan lookahead is outside the supported holiday calendar range; scanning without the start-date bound",
            );
        }

        const clients = await this.prismaService.client.findMany({
            where: {
                branchId: branchid,
                deletedAt: null,
                OR: [
                    { serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED },
                    {
                        OR: [
                            { serviceStatus: null },
                            { serviceStatus: { notIn: [SERVICE_STATUS.COMPLETED, SERVICE_STATUS.TERMINATED, SERVICE_STATUS.REPLACEMENT_REQUESTED] } },
                        ],
                        bookingConfirmedAt: { not: null },
                        startDate: startDateBound,
                    },
                ],
            },
            select: {
                id: true,
                name: true,
                createdAt: true,
                startDate: true,
                endDate: true,
                serviceStatus: true,
                bookingConfirmedAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: Math.max(limit * 4, 12),
        });

        // Reads the latest contract, matching the badge — not the document
        // pinned by eDocId, which can lag behind a re-issued contract.
        const hasActiveDocumentByClientId = await this.findHasActiveContractDocumentByClientId(
            clients.map((client) => client.id),
        );

        return clients
            .map((client): ClientActionRequiredAlert | null => {
                const serviceStatus = computeServiceStatus(
                    client.serviceStatus,
                    client.startDate,
                    client.endDate,
                    client.bookingConfirmedAt,
                );

                const actionRequired = this.computeActionRequired({
                    clientId: client.id,
                    serviceStatus,
                    startDate: client.startDate,
                    hasActiveContractDocument: hasActiveDocumentByClientId.get(client.id) ?? false,
                }, calendar);

                if (!actionRequired) {
                    return null;
                }

                return {
                    id: client.id,
                    name: client.name,
                    createdAt: client.createdAt ?? null,
                    ...actionRequired,
                };
            })
            .filter((alert): alert is ClientActionRequiredAlert => alert !== null)
            .sort((a, b) => a.priority - b.priority)
            .slice(0, limit);
    }
}

type ContractPhoneCandidate = {
    documentKind?: string | null;
    serviceRecordCaseId?: string | null;
    templateId?: string | null;
    stepRecipientSms?: string | null;
    customerPhone?: string | null;
    detailPayload?: Prisma.JsonValue | null;
};

function isMatchingContractPhoneCandidate(
    document: ContractPhoneCandidate,
    normalizedPhone: string,
    serviceRecordTemplateIds: ReadonlySet<string>,
): boolean {
    if (isServiceRecordEformsignDocument(document, serviceRecordTemplateIds)) {
        return false;
    }
    if (document.customerPhone) {
        return document.customerPhone === normalizedPhone;
    }
    if (
        typeof document.detailPayload === "object"
        && document.detailPayload !== null
        && !Array.isArray(document.detailPayload)
    ) {
        return eformsignCustomerPhone(
            document.detailPayload as unknown as EformsignApiDocumentResponse,
        ) === normalizedPhone;
    }
    return extractPhoneCandidates(document.stepRecipientSms).includes(normalizedPhone);
}

function sameMirrorGeneration(
    initialSourceUpdatedAt: Date | null | undefined,
    initialSyncedAt: Date | null | undefined,
    lockedSourceUpdatedAt: Date | null | undefined,
    lockedSyncedAt: Date | null | undefined,
): boolean {
    return initialSourceUpdatedAt?.getTime() === lockedSourceUpdatedAt?.getTime()
        && initialSyncedAt?.getTime() === lockedSyncedAt?.getTime();
}
