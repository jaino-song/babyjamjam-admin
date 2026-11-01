import { ClientEntity } from "domain/entities/client.entity";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import type { IClientRepository } from "domain/repositories/client.repository.interface";
import type {
    EformsignApiDocumentResponse,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";
import type { IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import type { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";
import { SbEformsignWebhookEventRepository } from "infrastructure/database/repositories/sb.eformsign-webhook-event.repository";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { ServiceRecordLifecycleService } from "application/services/service-record-lifecycle.service";
import { LinkDocumentToClientUsecase } from "application/usecases/eformsign-doc/link-document-to-client.usecase";
import { SyncClientEndDateUsecase } from "application/usecases/eformsign-doc/sync-client-end-date.usecase";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import type { HolidayCalendarService } from "application/services/holiday-calendar.service";

import type { IntegrityPrisma } from "../helpers/real-db";
import type { RowTracker } from "../helpers/tracker";

/**
 * Area-local wiring for the contracts integrity specs. Everything that reaches
 * the database is the REAL production class over the real throwaway database;
 * only external vendors (eformsign API, credentials) and pure caches/event
 * sinks (event bus, snapshot bump, notifications) are stubbed. Helpers here may
 * not touch `../helpers/**` — the harness is owned by the merged p1 unit.
 */

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export const calendarStub = {
    forBranch: async () => KR_BUILTIN_CALENDAR,
} as unknown as HolidayCalendarService;

export interface ContractClientFixture {
    id: number;
    phone: string;
}

/** A client with the date/duration columns the contract end-date path reads. */
export async function createContractClient(
    handle: IntegrityPrisma,
    tracker: RowTracker,
    branchId: string,
    overrides: Partial<{ startDate: Date; endDate: Date; duration: number; eDocId: string | null }> = {},
): Promise<ContractClientFixture> {
    const suffix = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)}`;
    let digits = "";
    for (let index = 0; index < 8; index += 1) {
        digits += Math.floor(Math.random() * 10).toString();
    }
    const phone = `010${digits}`;
    const row = await handle.raw.client.create({
        data: {
            name: `무결성 계약고객 ${suffix}`,
            phone: `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}`,
            phoneNormalized: phone,
            voucherClient: false,
            branchId,
            startDate: overrides.startDate ?? d("2026-10-01"),
            endDate: overrides.endDate ?? d("2026-10-16"),
            duration: overrides.duration ?? 12,
            ...(overrides.eDocId !== undefined ? { eDocId: overrides.eDocId } : {}),
        },
    });
    tracker.track("client", row.id);
    return { id: row.id, phone };
}

export interface ContractDocOverrides {
    documentId?: string;
    statusType?: string;
    statusDetail?: string;
    updatedDate?: Date;
    createdDate?: Date;
    clientId?: number | null;
    documentKind?: string | null;
    templateId?: string | null;
    voided?: boolean;
    stepType?: string;
    stepName?: string;
    syncStatus?: string;
    detailReady?: boolean;
}

/** A branch-owned contract document row, registered for cleanup. */
export async function createContractDoc(
    handle: IntegrityPrisma,
    tracker: RowTracker,
    branchId: string,
    overrides: ContractDocOverrides = {},
) {
    const documentId = overrides.documentId ?? `si-con-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9)}`;
    const createdDate = overrides.createdDate ?? d("2026-10-01");
    const updatedDate = overrides.updatedDate ?? createdDate;
    const row = await handle.raw.eformsign_doc.create({
        data: {
            documentId,
            createdDate,
            updatedDate,
            statusType: overrides.statusType ?? "060",
            statusDetail: overrides.statusDetail ?? "서명 요청됨",
            stepType: overrides.stepType ?? "05",
            stepIndex: "1",
            stepName: overrides.stepName ?? "이용자 서명",
            stepRecipientType: "02",
            stepRecipientName: "무결성 계약자",
            stepRecipientSms: "01000000000",
            expiredDate: d("2099-01-01"),
            clientId: overrides.clientId ?? null,
            branchId,
            documentKind: overrides.documentKind === undefined ? EFORMSIGN_DOCUMENT_KIND.CONTRACT : overrides.documentKind,
            templateId: overrides.templateId ?? "tpl-si-contract",
            ...(overrides.voided ? { voidedAt: new Date(), voidedBy: "22222222-2222-4222-8222-222222222222" } : {}),
            ...(overrides.syncStatus ? { syncStatus: overrides.syncStatus } : {}),
            ...(overrides.detailReady
                ? {
                    detailPayload: { document: { id: documentId } },
                    detailSourceUpdatedDate: updatedDate,
                    detailSyncedAt: updatedDate,
                }
                : {}),
        },
    });
    tracker.track("eformsign_doc", row.id);
    return { id: row.id, documentId: row.documentId };
}

/**
 * Deletes the webhook delivery-ledger rows a spec produced. The ledger is NOT
 * swept by the shared tracker (the harness does not own the model), so every
 * spec that wires the real `EformsignWebhookEventWriter` must call this before
 * `tracker.cleanup`.
 */
export async function deleteWebhookLedgerRows(handle: IntegrityPrisma, documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;
    await handle.raw.eformsign_webhook_event.deleteMany({ where: { documentId: { in: documentIds } } });
}

/** A raw-Prisma `IClientRepository` adapter, so real usecases resolve clients without a Nest DI container. */
export function clientRepositoryAdapter(handle: IntegrityPrisma): IClientRepository {
    return {
        findById: async (branchId: string, id: number) => {
            const row = await handle.raw.client.findFirst({ where: { id, branchId } });
            return row ? ClientMapper.toDomain(row) : null;
        },
        update: async (branchId: string, client: ClientEntity) => {
            const row = await handle.raw.client.update({
                where: { id: client.id },
                data: {
                    endDate: client.endDate,
                    duration: client.duration,
                    startDate: client.startDate,
                },
            });
            return ClientMapper.toDomain(row);
        },
        updateServiceStatusIfCurrent: async () => "skipped" as const,
    } as unknown as IClientRepository;
}

export interface WebhookSinkCounts {
    eventBusEmits: { branchId: string; documentId: string; reason: string }[];
    snapshotBumps: number;
    notifications: number;
}

export interface WebhookHarness {
    service: EformsignWebhookService;
    docRepository: IEformsignDocRepository;
    lifecycle: ServiceRecordLifecycleService;
    counts: WebhookSinkCounts;
}

/**
 * The nearly-real webhook service: real usecases, real repositories, real
 * lifecycle service and real delivery ledger over one `PrismaService`; vendors
 * and pure sinks stubbed. `docRepository` may be swapped for an instrumented
 * wrapper by passing `docRepositoryOverride`.
 */
export function buildWebhookHarness(
    handle: IntegrityPrisma,
    options: {
        docRepositoryOverride?: IEformsignDocRepository;
        eformsignApiClient?: IEformsignClientRepository;
    } = {},
): WebhookHarness {
    const prisma = handle.service;
    const docRepository = options.docRepositoryOverride ?? new SbEformsignDocRepository(prisma);
    const lifecycle = new ServiceRecordLifecycleService(prisma, calendarStub);
    const counts: WebhookSinkCounts = { eventBusEmits: [], snapshotBumps: 0, notifications: 0 };
    const eventBus = { emit: (event: { branchId: string; documentId: string; reason: string }) => counts.eventBusEmits.push(event) };
    const notificationService = {
        sendToBranchUsers: async () => {
            counts.notifications += 1;
            return { sent: 0, failed: 0 };
        },
    };
    const eformsignApiClient = options.eformsignApiClient ?? {
        getDocument: async () => ({
            current_status: {
                status_type: "060",
                step_type: "05",
                step_name: "이용자 서명",
                step_recipients: [{ recipient_type: "02" }],
            },
        }),
    } as unknown as IEformsignClientRepository;
    const credentialBoundary = {
        withCredentials: async (_principal: unknown, _scope: string, fn: (t: { accessToken: string }) => Promise<unknown>) =>
            fn({ accessToken: "si-integrity-token" }),
    };
    const mirrorUnassignedDocUsecase = { execute: async () => undefined, mirrorRemoteDocument: async () => undefined };
    const documentSnapshotService = {
        bumpVersion: async () => {
            counts.snapshotBumps += 1;
        },
        bumpCompanyEpoch: async () => undefined,
    };
    const clientRepository = clientRepositoryAdapter(handle);
    const service = new EformsignWebhookService(
        new UpdateEformsignDocStatusUsecase(docRepository),
        new LinkDocumentToClientUsecase(docRepository, clientRepository, calendarStub),
        new SyncClientEndDateUsecase(eformsignApiClient, docRepository, clientRepository, calendarStub),
        eventBus as never,
        notificationService as never,
        eformsignApiClient,
        credentialBoundary as never,
        clientRepository,
        docRepository,
        { findByClientId: async () => [] } as never,
        { findById: async () => null } as never,
        mirrorUnassignedDocUsecase as never,
        prisma,
        lifecycle,
        documentSnapshotService as never,
        undefined,
        undefined,
        new EformsignWebhookEventWriter(new SbEformsignWebhookEventRepository(prisma)),
    );
    return { service, docRepository, lifecycle, counts };
}

/** Re-reads a client row for assertions. */
export async function clientRow(handle: IntegrityPrisma, clientId: number) {
    return handle.raw.client.findUniqueOrThrow({ where: { id: clientId } });
}

export async function docRow(handle: IntegrityPrisma, documentId: string) {
    return handle.raw.eformsign_doc.findUniqueOrThrow({ where: { documentId } });
}

export interface MirrorDetailOptions {
    documentId: string;
    statusType: string;
    updatedDate: Date;
    stepType?: string;
    stepName?: string;
    endDate?: { year: string; month: string; day: string };
    templateId?: string;
    templateName?: string;
}

/** The stored-detail shape the controller/`EformsignApiDocumentResponse` carries. */
export function mirrorDetail(options: MirrorDetailOptions): EformsignApiDocumentResponse {
    const end = options.endDate ?? { year: "2026", month: "10", day: "30" };
    return {
        id: options.documentId,
        document_number: "SI-1",
        template: { id: options.templateId ?? "tpl-si-contract", name: options.templateName ?? "산모신생아 계약서" },
        document_name: "산모신생아건강관리서비스 계약서",
        creator: { recipient_type: "01", id: "issuer", name: "발행자" },
        created_date: options.updatedDate.getTime(),
        updated_date: options.updatedDate.getTime(),
        current_status: {
            status_type: options.statusType,
            step_type: options.stepType ?? "06",
            step_index: "2",
            step_name: options.stepName ?? "제공기관 확인",
            step_recipients: [],
            step_group: 2,
        },
        fields: [
            { id: "계약 종료 년도", value: end.year, type: "text" },
            { id: "계약 종료 월", value: end.month, type: "text" },
            { id: "계약 종료 일", value: end.day, type: "text" },
        ],
    } as unknown as EformsignApiDocumentResponse;
}

export interface DocumentEventOptions {
    webhookId: string;
    documentId: string;
    status: string;
    updatedDate?: Date;
    templateId?: string;
    templateName?: string;
    action?: string;
}

export function documentEventPayload(options: DocumentEventOptions): EformsignWebhookPayloadDto {
    return {
        webhook_id: options.webhookId,
        webhook_name: "si-integrity",
        company_id: "si-company",
        event_type: "document",
        document: {
            id: options.documentId,
            document_title: "산모신생아건강관리서비스 계약서",
            template_id: options.templateId ?? "tpl-si-contract",
            template_name: options.templateName ?? "산모신생아 계약서",
            workflow_seq: 2,
            workflow_name: "직원 확정",
            status: options.status,
            ...(options.updatedDate ? { updated_date: options.updatedDate.getTime() } : {}),
        },
    } as EformsignWebhookPayloadDto;
}

export { d };
