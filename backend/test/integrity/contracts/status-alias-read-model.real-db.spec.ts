import { PrismaClient } from "@prisma/client";

import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { ClientService, type DocumentStatusType } from "application/services/client.service";
import { UpdateEformsignDocStatusUsecase } from "application/usecases/eformsign-doc/update-eformsign-doc-status.usecase";
import { SbEformsignDocRepository } from "infrastructure/database/repositories/sb.eformsign-doc.repository";

import { buildWebhookHarness, createContractClient, createContractDoc, d, deleteWebhookLedgerRows, documentEventPayload, docRow, mirrorDetail, type ContractDocOverrides } from "./contracts-fixture";
import { applyStatusMigration } from "./status-migration-fixture";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, assertThrowawayTarget, type IntegrityPrisma } from "../helpers/real-db";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

/**
 * SI-CONTRACT-07 — known aliases are backfilled, but unknown provider status
 * names remain writable (operator decision 2026-10-31). No DB CHECK is intended.
 * The read-model half is REFUTED: `documentStatus` / `hasSigned` normalize every
 * stored alias consistently. SI-CONTRACT-09 adds the fence side: a completed
 * row stored as an alias must keep the webhook terminal-downgrade protection,
 * with the canonical-form control inlined below.
 */

describeReal("eformsign status alias normalization (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let raw: PrismaClient;
    let tracker: RowTracker;
    let branchId: string;
    let clientService: ClientService;

    async function createLegacyDoc(overrides: ContractDocOverrides & { statusType: string }) {
        return createContractDoc(handle, tracker, branchId, overrides);
    }

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        raw = handle.raw;
        tracker = new RowTracker();
        const branchRow = await raw.branch.create({
            data: { name: "무결성 별칭 지점", slug: `throwaway-si-contracts-alias-${Date.now().toString(36)}` },
        });
        tracker.track("branch", branchRow.id);
        branchId = branchRow.id;
        const prisma = handle.service;
        const listPaginatedUsecase = {
            execute: async (branch: string, page: number, limit: number) => {
                const rows = await raw.client.findMany({
                    where: { branchId: branch },
                    orderBy: { id: "asc" },
                });
                const start = (page - 1) * limit;
                const slice = rows.slice(start, start + limit);
                return {
                    data: slice.map((row) => ClientMapper.toDomain(row as never)),
                    total: rows.length,
                    page,
                    limit,
                    totalPages: 1,
                };
            },
        };
        clientService = new ClientService(
            {} as never,
            {} as never,
            {} as never,
            listPaginatedUsecase as never,
            {} as never,
            {} as never,
            prisma,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { forBranch: async () => ({}) } as never,
            undefined,
            undefined,
            undefined,
            { get: () => undefined } as never,
        );
    });

    afterAll(async () => {
        if (tracker) {
            await tracker.cleanup(raw);
        }
        if (handle) {
            await closeIntegrityPrisma(handle);
        }
    });

    invariant("SI-CONTRACT-07", "intended (operator decision 2026-10-31): unknown provider status names are stored; known aliases are canonicalized", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const unknown = "doc_brand_new_event";
        const providerDoc = await createContractDoc(handle, tracker, branchId, { statusType: unknown });
        const legacy = await createLegacyDoc({ statusType: "50" });
        const namedAlias = await createLegacyDoc({ statusType: "doc_complete" });
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            statusType: "060",
        });

        expect(applyStatusMigration().status).toBe(0);
        expect((await docRow(handle, legacy.documentId)).statusType).toBe("050");
        expect((await docRow(handle, namedAlias.documentId)).statusType).toBe("003");
        expect((await docRow(handle, providerDoc.documentId)).statusType).toBe(unknown);

        // The action webhook projects the mirror's status through the real
        // status usecase/repository. Start canonical so this must WRITE the name,
        // not merely leave a previously seeded unknown value untouched.
        const payload = documentEventPayload({
            webhookId: `si-unknown-${doc.documentId}`,
            documentId: doc.documentId,
            status: unknown,
            updatedDate: d("2026-10-08"),
        });
        payload.event_type = "document_action";
        payload.document!.action = "doc_open_participant"; // The factory always supplies document.
        try {
            await buildWebhookHarness(handle).service.processWebhook(payload, {
                mirroredDocument: mirrorDetail({ documentId: doc.documentId, statusType: unknown, updatedDate: d("2026-10-08") }),
            });
            expect(await docRow(handle, doc.documentId)).toMatchObject({
                statusType: unknown,
                updatedDate: d("2026-10-08"),
            });
            expect(applyStatusMigration().status).toBe(0);
            expect((await docRow(handle, doc.documentId)).statusType).toBe(unknown);
        } finally {
            await deleteWebhookLedgerRows(handle, [doc.documentId]);
        }
    });

    invariant("SI-CONTRACT-07", "(read-model half, refuted) the client read model maps every stored completed alias to documentStatus completed with the same hasSigned derivation", async () => {
        const padded = await createContractClient(handle, tracker, branchId);
        const unpadded = await createContractClient(handle, tracker, branchId);
        const eventName = await createContractClient(handle, tracker, branchId);
        const docs: Array<{ clientId: number; documentId: string }> = [];
        for (const [pair, statusType] of [
            [padded, "050"],
            [unpadded, "50"],
            [eventName, "doc_complete"],
        ] as const) {
            const doc = await createLegacyDoc({
                clientId: pair.id,
                statusType,
                statusDetail: "완료",
                stepType: "06",
                stepName: "제공기관 확인",
            });
            docs.push({ clientId: pair.id, documentId: doc.documentId });
        }

        const page = await clientService.findAllPaginated(branchId, 1, 100);
        const byId = new Map(page.data.map((row) => [row.id, row]));
        for (const item of docs) {
            const row = byId.get(item.clientId) as {
                documentStatus: DocumentStatusType;
                hasSigned: boolean;
                latestContractDocumentId: string | null;
            };
            expect(row.latestContractDocumentId).toBe(item.documentId);
            expect(row.documentStatus).toBe("completed");
            expect(row.hasSigned).toBe(true);
        }
    });

    // Control for SI-CONTRACT-09: the canonical "050" row keeps its
    // terminal-downgrade fence — the alias-form bypass is shown by the
    // SI-CONTRACT-09 invariant below.
    invariant("SI-CONTRACT-09", "(control) a live-status webhook with a NEWER timestamp cannot downgrade a completed contract stored in canonical form", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            statusType: "050",
            statusDetail: "완료",
            stepType: "06",
            stepName: "제공기관 확인",
            updatedDate: d("2026-10-05"),
        });
        const usecase = new UpdateEformsignDocStatusUsecase(new SbEformsignDocRepository(handle.service));
        const { applied } = await usecase.executeWithOutcome(branchId, {
            documentId: doc.documentId,
            statusType: "060",
            statusDetail: "서명 요청됨",
            sourceUpdatedDate: d("2026-10-08"),
        });
        expect(applied).toBe(false);
        expect((await docRow(handle, doc.documentId)).statusType).toBe("050");
    });

    // The correct invariant: once a contract reached a completed status, no
    // out-of-order live-status webhook may move it back to a live status — the
    // terminal fence must recognise the completed code in ANY stored form.
    invariant("SI-CONTRACT-09", "a completed row stored as a legacy alias loses the terminal-downgrade fence", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const doc = await createLegacyDoc({
            clientId: client.id,
            statusType: "50",
            statusDetail: "완료",
            stepType: "06",
            stepName: "제공기관 확인",
            updatedDate: d("2026-10-05"),
        });
        const usecase = new UpdateEformsignDocStatusUsecase(new SbEformsignDocRepository(handle.service));

        // A live-status event with a genuinely NEWER timestamp: for a canonical
        // 050 row the terminal fence refuses it; for the alias row it must too.
        const { applied } = await usecase.executeWithOutcome(branchId, {
            documentId: doc.documentId,
            statusType: "060",
            statusDetail: "서명 요청됨",
            sourceUpdatedDate: d("2026-10-08"),
        });
        if (applied) {
            throw new Error("SI-CONTRACT-09: a completed alias row was downgraded to a live status (060) by the webhook status write");
        }
        const after = await docRow(handle, doc.documentId);
        expect(after.statusType).toBe("50");
    });
});
