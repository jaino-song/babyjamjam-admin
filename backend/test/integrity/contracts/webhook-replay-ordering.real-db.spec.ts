import { PrismaClient } from "@prisma/client";

import { EformsignWebhookController } from "interface/controllers/eformsign-webhook.controller";
import { EformsignWebhookEventWriter } from "application/services/eformsign-webhook-event.service";
import { SbEformsignWebhookEventRepository } from "infrastructure/database/repositories/sb.eformsign-webhook-event.repository";
import { SERVICE_RECORD_CASE_STATUS } from "application/services/service-record-lifecycle.service";

import {
    buildWebhookHarness,
    clientRow,
    createContractClient,
    createContractDoc,
    deleteWebhookLedgerRows,
    documentEventPayload,
    docRow,
    d,
    mirrorDetail,
    type WebhookHarness,
} from "./contracts-fixture";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal, assertThrowawayTarget, type IntegrityPrisma } from "../helpers/real-db";
import { invariant } from "../helpers/known-defect";
import { RowTracker } from "../helpers/tracker";

/**
 * SI-CONTRACT-01 / SI-CONTRACT-02 — webhook replay and out-of-order deliveries,
 * through the nearly-real webhook service and the real webhook controller over
 * the real database: the same event delivered twice must produce exactly one
 * set of side effects, and an event without a usable timestamp must not be able
 * to overwrite a newer terminal status. Only vendors/caches are stubbed (see
 * `contracts-fixture.ts`); the completion claim, the status CAS, the client
 * link, the fenced end-date sync and the delivery ledger are all real.
 */

// The service-record snapshot gate reads this env var on every call, so the
// re-entry test registers its template through it (restored in afterAll).
const SERVICE_RECORD_TEMPLATE_ENV = "EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID";
const SERVICE_RECORD_TEMPLATE_ID = "tpl-si-service-record";

describeReal("eformsign webhook replay and ordering (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let raw: PrismaClient;
    let tracker: RowTracker;
    let harness: WebhookHarness;
    let branchId: string;
    let originalTemplateEnv: string | undefined;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        raw = handle.raw;
        tracker = new RowTracker();
        const branchRow = await raw.branch.create({
            data: { name: "무결성 웹훅 지점", slug: `throwaway-si-contracts-webhook-${Date.now().toString(36)}` },
        });
        tracker.track("branch", branchRow.id);
        branchId = branchRow.id;
        harness = buildWebhookHarness(handle);
        originalTemplateEnv = process.env[SERVICE_RECORD_TEMPLATE_ENV];
    });

    afterAll(async () => {
        if (originalTemplateEnv === undefined) {
            delete process.env[SERVICE_RECORD_TEMPLATE_ENV];
        } else {
            process.env[SERVICE_RECORD_TEMPLATE_ENV] = originalTemplateEnv;
        }
        if (tracker) {
            await tracker.cleanup(raw);
        }
        if (handle) {
            await closeIntegrityPrisma(handle);
        }
    });

    invariant("SI-CONTRACT-01", "the same doc_complete webhook delivered twice runs completion side effects exactly once", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const createdDate = d("2026-10-01");
        const completionTime = d("2026-10-02");
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            createdDate,
            updatedDate: createdDate,
            statusType: "060",
        });
        const payload = documentEventPayload({
            webhookId: "si-replay-complete-1",
            documentId: doc.documentId,
            status: "doc_complete",
            updatedDate: completionTime,
        });
        const mirrored = mirrorDetail({ documentId: doc.documentId, statusType: "050", updatedDate: completionTime });

        // Delivery 1: the claim is taken and the real side effects run — the
        // client link and the fenced end-date sync.
        const first = await harness.service.processWebhook(payload, {
            mirroredDocument: mirrored,
            deferCompletionEvent: true,
            deferCompletionEffects: false,
        });
        expect(first).toMatchObject({ completionClaim: "claimed", completionBranchId: branchId });
        expect((await clientRow(handle, client.id)).eDocId).toBe(doc.documentId);
        expect((await clientRow(handle, client.id)).endDate).toEqual(d("2026-10-30"));
        expect((await docRow(handle, doc.documentId)).statusType).toBe("050");
        const bumpsAfterFirst = harness.counts.snapshotBumps;
        expect(bumpsAfterFirst).toBeGreaterThan(0);

        // Delivery 2: the identical payload must be recognized as a duplicate;
        // no second link, no second end-date write, no second cache bump.
        const second = await harness.service.processWebhook(payload, {
            mirroredDocument: mirrored,
            deferCompletionEvent: true,
            deferCompletionEffects: false,
        });
        expect(second).toMatchObject({ completionClaim: "duplicate" });
        expect((await clientRow(handle, client.id)).eDocId).toBe(doc.documentId);
        expect((await clientRow(handle, client.id)).endDate).toEqual(d("2026-10-30"));
        expect(harness.counts.snapshotBumps).toBe(bumpsAfterFirst);
        // The completion claim is the only completion write: both deliveries
        // left the row at the same terminal state, not at two different ones.
        expect((await docRow(handle, doc.documentId)).statusType).toBe("050");

        // The delivery ledger is an append-only record: both deliveries are
        // recorded (there is no unique on webhook_id), but only the first one
        // was allowed to act.
        const ledger = await raw.eformsign_webhook_event.findMany({
            where: { documentId: doc.documentId },
            orderBy: { id: "asc" },
        });
        expect(ledger.map((row) => row.outcome)).toEqual(["completion_claimed", "completion_duplicate"]);
        await deleteWebhookLedgerRows(handle, [doc.documentId]);
    });

    invariant("SI-CONTRACT-01", "the same non-completion status webhook delivered twice is applied once and records no second side effect", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const createdDate = d("2026-10-01");
        const revokeTime = d("2026-10-03");
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            createdDate,
            updatedDate: createdDate,
            statusType: "060",
        });
        const payload = documentEventPayload({
            webhookId: "si-replay-revoke-1",
            documentId: doc.documentId,
            status: "doc_revoke",
            updatedDate: revokeTime,
        });
        const mirrored = mirrorDetail({ documentId: doc.documentId, statusType: "042", updatedDate: revokeTime });

        // The controller-level mirror gate needs the stored detail; the service
        // under test here receives it directly (as the controller passes it).
        const first = await harness.service.processWebhook(payload, { mirroredDocument: mirrored });
        expect(first).toBeUndefined(); // non-completion events return no claim
        expect((await docRow(handle, doc.documentId)).statusType).toBe("042");
        const emitsAfterFirst = harness.counts.eventBusEmits.length;
        expect(emitsAfterFirst).toBeGreaterThan(0);

        // The replay: the status CAS (`updatedDate < sourceUpdatedDate`) must
        // refuse the equal-generation write, so the second delivery records no
        // invalidation and no link attempt.
        await expect(harness.service.processWebhook(payload, { mirroredDocument: mirrored })).resolves.toBeUndefined();
        expect((await docRow(handle, doc.documentId)).statusType).toBe("042");
        expect((await docRow(handle, doc.documentId)).updatedDate).toEqual(revokeTime);
        expect(harness.counts.eventBusEmits.length).toBe(emitsAfterFirst);
        // The replay was recorded as a dropped projection, not as another apply.
        const ledger = await raw.eformsign_webhook_event.findMany({
            where: { documentId: doc.documentId },
            orderBy: { id: "asc" },
        });
        expect(ledger.map((row) => row.outcome)).toEqual(["applied", "ignored_stale_projection"]);
        await deleteWebhookLedgerRows(handle, [doc.documentId]);
    });

    invariant("SI-CONTRACT-01", "service-record snapshot completion handling is re-entry safe: a replay cannot flip a completed case twice", async () => {
        process.env[SERVICE_RECORD_TEMPLATE_ENV] = SERVICE_RECORD_TEMPLATE_ID;

        const user = await raw.user.create({
            data: {
                email: `si-snapshot-${Date.now().toString(36)}@integrity.test`,
                name: "무결성 스냅샷 사용자",
                phone: "010-0000-0001",
                kakaoId: `si-snapshot-${Date.now().toString(36)}`,
                role: "user",
                approvalStatus: "approved",
                emailVerified: true,
                authProvider: "kakao",
            },
        });
        tracker.track("user", user.id);
        const client = await createContractClient(handle, tracker, branchId);
        const caseRow = await raw.service_record_case.create({
            data: {
                branchId,
                clientId: client.id,
                status: SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
                currentRevisionId: null,
                currentUsableRevisionId: null,
                currentUsableDocumentVersion: null,
            },
        });
        const readyTime = d("2026-10-05");
        const snapshot = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            documentKind: "service_record_snapshot",
            templateId: SERVICE_RECORD_TEMPLATE_ID,
            statusType: "050",
            statusDetail: "완료",
            syncStatus: "ready",
            detailReady: true,
            createdDate: readyTime,
            updatedDate: readyTime,
        });
        // The snapshot doc needs its case identity; the doc factory does not
        // expose that column, so set it directly (the row is tracked).
        await raw.eformsign_doc.update({
            where: { id: snapshot.id },
            data: { serviceRecordCaseId: caseRow.id },
        });
        await raw.eformsign_doc_file.create({
            data: {
                eformsignDocId: snapshot.id,
                fileType: "document",
                content: Buffer.from("x"),
                contentType: "application/pdf",
                byteSize: 1,
                sha256: "1".repeat(64),
                sourceUpdatedDate: readyTime,
            },
        });
        await raw.eformsign_doc_file.create({
            data: {
                eformsignDocId: snapshot.id,
                fileType: "audit_trail",
                content: Buffer.from("x"),
                contentType: "application/pdf",
                byteSize: 1,
                sha256: "2".repeat(64),
                sourceUpdatedDate: readyTime,
            },
        });

        // First completion handling (what the webhook does on the claim): flips
        // the DOCUMENTS_CREATED case to COMPLETED exactly once.
        await expect(harness.lifecycle.completeServiceRecordSnapshotIfReady({
            branchId,
            documentId: snapshot.documentId,
        })).resolves.toBe(true);
        const completedCase = await raw.service_record_case.findUniqueOrThrow({ where: { id: caseRow.id } });
        expect(completedCase.status).toBe(SERVICE_RECORD_CASE_STATUS.COMPLETED);
        expect(completedCase.documentsCompletedAt).not.toBeNull();

        // Re-entry (what a duplicate completion webhook runs again): the
        // status CAS in completeServiceRecordSnapshotIfReady must refuse.
        await expect(harness.lifecycle.completeServiceRecordSnapshotIfReady({
            branchId,
            documentId: snapshot.documentId,
        })).resolves.toBe(false);
        const reread = await raw.service_record_case.findUniqueOrThrow({ where: { id: caseRow.id } });
        expect(reread.status).toBe(SERVICE_RECORD_CASE_STATUS.COMPLETED);
        expect(reread.documentsCompletedAt).toEqual(completedCase.documentsCompletedAt);
        expect(reread.version).toBe(completedCase.version);
    });

    invariant("SI-CONTRACT-02", "an older non-completion webhook after a newer completion does not downgrade statusType", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const createdDate = d("2026-10-01");
        const completionTime = d("2026-10-06");
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            createdDate,
            updatedDate: completionTime,
            statusType: "050",
            statusDetail: "완료",
        });
        // A signing-request event that predates the completion but arrives
        // late, with the mirror already showing the older live status.
        const payload = documentEventPayload({
            webhookId: "si-order-old-1",
            documentId: doc.documentId,
            status: "doc_request_participant",
            updatedDate: d("2026-10-04"),
        });
        const mirrored = mirrorDetail({ documentId: doc.documentId, statusType: "060", updatedDate: d("2026-10-04") });

        await expect(harness.service.processWebhook(payload, { mirroredDocument: mirrored })).resolves.toBeUndefined();
        const row = await docRow(handle, doc.documentId);
        expect(row.statusType).toBe("050");
        expect(row.updatedDate).toEqual(completionTime);
        const ledger = await raw.eformsign_webhook_event.findMany({
            where: { documentId: doc.documentId },
            orderBy: { id: "asc" },
        });
        expect(ledger.map((ledgerRow) => ledgerRow.outcome)).toEqual(["ignored_stale_projection"]);
        await deleteWebhookLedgerRows(handle, [doc.documentId]);
    });

    invariant("SI-CONTRACT-02", "a webhook without a usable timestamp is not fenced by the controller ordering gate yet still cannot overwrite a newer terminal status", async () => {
        const client = await createContractClient(handle, tracker, branchId);
        const completionTime = d("2026-10-07");
        const doc = await createContractDoc(handle, tracker, branchId, {
            clientId: client.id,
            createdDate: d("2026-10-01"),
            updatedDate: completionTime,
            statusType: "050",
            statusDetail: "완료",
        });
        // The payload's document.updated_date is MISSING — exactly the shape
        // that skips `isWebhookCurrentEnough`. The real controller must still
        // keep the terminal row intact.
        const payload = documentEventPayload({
            webhookId: "si-order-nodt-1",
            documentId: doc.documentId,
            status: "doc_request_participant",
            // updated_date deliberately absent
        });
        const mirroredDocument = mirrorDetail({ documentId: doc.documentId, statusType: "060", updatedDate: d("2026-10-07") });
        const documentMirrorService = {
            syncDocument: async () => undefined,
            getStoredDetail: async () => mirroredDocument,
            isDocumentReady: async () => true,
        };
        const controller = new EformsignWebhookController(
            harness.service,
            documentMirrorService as never,
            new EformsignWebhookEventWriter(new SbEformsignWebhookEventRepository(handle.service)),
        );

        await expect(controller.handleWebhook(payload)).resolves.toEqual({ success: true });

        const row = await docRow(handle, doc.documentId);
        // The terminal-downgrade fence in the status usecase is what held: the
        // timestamp-less delivery must not have moved the completed contract.
        expect(row.statusType).toBe("050");
        expect(row.statusDetail).toBe("완료");
        expect(row.updatedDate).toEqual(completionTime);
        const ledger = await raw.eformsign_webhook_event.findMany({
            where: { documentId: doc.documentId },
            orderBy: { id: "asc" },
        });
        expect(ledger.map((ledgerRow) => ledgerRow.outcome)).toEqual(["ignored_stale_projection"]);
        await deleteWebhookLedgerRows(handle, [doc.documentId]);
    });
});
