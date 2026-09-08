import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import type {
    PromoteReceiptLinkRevisionArtifactInput,
    ReceiptLinkRevisionArtifactProof,
} from "domain/repositories/receipt-link-token.repository.interface";
import type { ServiceRecordEditJsonValue } from "domain/repositories/service-record-edit.repository.interface";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

const NOW = new Date("2026-09-30T12:00:00.000Z");
const RECEIVED_DATE = "2026-08-31";
const SERVICE_START_DATE = "2026-09-07";
const SERVICE_END_DATE = "2026-09-23";
const RECEIPT_AMOUNT = "600000";

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function asJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
}

async function buildPromotionFixture(
    prisma: PrismaClient,
    options: {
        tokenActive?: boolean;
        tokenExpiresAt?: Date;
        tokenRevokedAt?: Date | null;
    } = {},
) {
    const fixture = await createServiceRecordConfirmFixture(prisma);
    const originalDocumentId = `receipt-original-${randomUUID()}`;
    const targetDocumentId = `receipt-target-${randomUUID()}`;
    const documentNow = new Date("2026-09-01T00:00:00.000Z");
    const receiptDetail = {
        receipt: {
            receivedDate: RECEIVED_DATE,
            amount: RECEIPT_AMOUNT,
        },
    };
    const documentData = (documentId: string) => ({
        documentId,
        documentName: "Synthetic service receipt",
        documentNumber: `RECEIPT-${randomUUID()}`,
        templateName: "receipt-template",
        createdDate: documentNow,
        updatedDate: documentNow,
        statusType: "070",
        statusDetail: "Synthetic in progress",
        stepType: "06",
        stepIndex: "3",
        stepName: "Synthetic recipient review",
        stepRecipientType: "02",
        stepRecipientName: "Synthetic client",
        stepRecipientSms: "01000000000",
        expiredDate: new Date("2027-01-01T00:00:00.000Z"),
        branchId: fixture.branch.id,
        clientId: fixture.client.id,
        documentKind: "contract",
        detailPayload: asJson(receiptDetail),
    });
    const [originalDocument, targetDocument] = await Promise.all([
        prisma.eformsign_doc.create({ data: documentData(originalDocumentId) }),
        prisma.eformsign_doc.create({ data: documentData(targetDocumentId) }),
    ]);
    await prisma.client.update({
        where: { id: fixture.client.id },
        data: { eDocId: targetDocument.documentId },
    });

    const tokenId = randomUUID();
    const token = await prisma.receipt_link_token.create({
        data: {
            id: tokenId,
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            eformsignDocId: originalDocument.id,
            jobId: null,
            linkTokenHash: hash(`link-${tokenId}`),
            accessTokenHash: hash(`access-${tokenId}`),
            expectedBirthdayHash: hash(`birthday-${tokenId}`),
            verifiedAt: new Date("2026-09-01T08:00:00.000Z"),
            failedAttempts: 2,
            lockedAt: null,
            expiresAt: options.tokenExpiresAt ?? new Date("2026-12-31T23:59:59.000Z"),
            active: options.tokenActive ?? true,
            revokedAt: options.tokenRevokedAt ?? null,
            storagePath: `receipts/${tokenId}/old.pdf`,
            contentSha256: "a".repeat(64),
            byteSize: 111,
            source: "manual",
            createdBy: fixture.actorUserId,
        },
    });

    const editRepository = new ServiceRecordEditRepository(prisma as unknown as PrismaService);
    const revision = await editRepository.appendRevision({
        branchId: fixture.branch.id,
        serviceRecordCaseId: fixture.record.id,
        actorUserId: fixture.actorUserId,
        payload: {
            kind: "receipt_refresh_test",
            receipt: receiptDetail.receipt,
        },
        plannedSessions: {
            sessions: Array.from({ length: 13 }, (_, index) => ({
                sessionIndex: index + 1,
                serviceDate: `2026-09-${String(index + 7).padStart(2, "0")}`,
            })),
        },
        provenance: { source: "synthetic-receipt-promotion-proof" },
        formVersionAtConfirm: 1,
    });
    await prisma.service_record_case.update({
        where: { id: fixture.record.id },
        data: { currentRevisionId: revision.id },
    });

    const immutableInput = {
        expected: {
            serviceStartDate: SERVICE_START_DATE,
            serviceEndDate: SERVICE_END_DATE,
            receivedDate: RECEIVED_DATE,
            amount: RECEIPT_AMOUNT,
        },
        tokens: {
            eformsignDocId: originalDocument.id,
            tokenIds: [token.id],
        },
        source: {
            documentId: targetDocument.documentId,
            documentVersion: null,
            templateId: "receipt-template",
            templateVersion: "1",
            mirrorGeneration: "mirror-generation-1",
        },
    };
    const generation = randomUUID();
    const proof: ReceiptLinkRevisionArtifactProof = {
        officialPdfSha256: "c".repeat(64),
        verifiedAt: "2026-09-30T12:00:00.000Z",
        pageCount: 1,
        scope: {
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            revisionId: revision.id,
            documentId: targetDocument.documentId,
            generation,
            mirrorGeneration: "mirror-generation-1",
            templateId: "receipt-template",
            templateVersion: "1",
        },
        expected: immutableInput.expected,
    };
    const state = await editRepository.createRevisionDocumentState({
        branchId: fixture.branch.id,
        clientId: fixture.client.id,
        serviceRecordCaseId: fixture.record.id,
        revisionId: revision.id,
        operation: "receipt_refresh",
        generation,
        immutableInput,
        inputFingerprint: sha256CanonicalJson(immutableInput),
        documentVersion: null,
        sourceDocumentId: targetDocument.documentId,
        targetDocumentId: targetDocument.documentId,
        templateId: "receipt-template",
        templateVersion: "1",
        mirrorGeneration: "mirror-generation-1",
        outputProof: proof as unknown as ServiceRecordEditJsonValue,
        step: "proof_ready",
        status: "processing",
    });

    const input: PromoteReceiptLinkRevisionArtifactInput = {
        branchId: fixture.branch.id,
        clientId: fixture.client.id,
        serviceRecordCaseId: fixture.record.id,
        revisionId: revision.id,
        documentStateId: state.id,
        expectedGeneration: generation,
        expectedStateVersion: state.version,
        targetDocumentId: targetDocument.documentId,
        documentVersion: null,
        templateId: "receipt-template",
        templateVersion: "1",
        mirrorGeneration: "mirror-generation-1",
        eformsignDocId: originalDocument.id,
        tokenIds: [token.id],
        storagePath: `receipts/${token.id}/new.pdf`,
        contentSha256: "b".repeat(64),
        byteSize: 222,
        proof,
        now: NOW,
    };

    return {
        fixture,
        editRepository,
        originalDocument,
        targetDocument,
        token,
        revision,
        state,
        immutableInput,
        proof,
        input,
    };
}

function receiptTokenIdentity(token: {
    linkTokenHash: string;
    accessTokenHash: string | null;
    expectedBirthdayHash: string;
    verifiedAt: Date | null;
    failedAttempts: number;
    lockedAt: Date | null;
    expiresAt: Date;
    active: boolean;
    revokedAt: Date | null;
    eformsignDocId: number;
}) {
    return {
        linkTokenHash: token.linkTokenHash,
        accessTokenHash: token.accessTokenHash,
        expectedBirthdayHash: token.expectedBirthdayHash,
        verifiedAt: token.verifiedAt,
        failedAttempts: token.failedAttempts,
        lockedAt: token.lockedAt,
        expiresAt: token.expiresAt,
        active: token.active,
        revokedAt: token.revokedAt,
        eformsignDocId: token.eformsignDocId,
    };
}

describeE2E("receipt revision artifact promotion (disposable PostgreSQL)", () => {
    let prisma: PrismaClient;
    let editRepository: ServiceRecordEditRepository;
    let tokenRepository: SbReceiptLinkTokenRepository;

    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        editRepository = new ServiceRecordEditRepository(prisma as unknown as PrismaService);
        tokenRepository = new SbReceiptLinkTokenRepository(prisma as unknown as PrismaService);
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    it("promotes only the artifact while preserving token identity, contract FK, and receipt values", async () => {
        const promotion = await buildPromotionFixture(prisma);
        const beforeToken = await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } });
        const beforeOriginal = await prisma.eformsign_doc.findUniqueOrThrow({ where: { id: promotion.originalDocument.id } });
        const beforeTarget = await prisma.eformsign_doc.findUniqueOrThrow({ where: { id: promotion.targetDocument.id } });
        const beforeTokenCount = await prisma.receipt_link_token.count({ where: { branchId: promotion.fixture.branch.id } });
        const beforeDocumentCount = await prisma.eformsign_doc.count({ where: { branchId: promotion.fixture.branch.id } });

        const result = await tokenRepository.promoteReceiptRevisionArtifact(promotion.input);

        expect(result).toEqual({ disposition: "promoted", tokenIds: [promotion.token.id], stateVersion: promotion.state.version + 1 });
        const afterToken = await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } });
        expect(afterToken).toMatchObject({
            storagePath: promotion.input.storagePath,
            contentSha256: promotion.input.contentSha256,
            byteSize: promotion.input.byteSize,
        });
        expect(receiptTokenIdentity(afterToken)).toEqual(receiptTokenIdentity(beforeToken));
        expect(await prisma.eformsign_doc.findUniqueOrThrow({ where: { id: promotion.originalDocument.id } })).toEqual(beforeOriginal);
        expect(await prisma.eformsign_doc.findUniqueOrThrow({ where: { id: promotion.targetDocument.id } })).toEqual(beforeTarget);
        expect(await prisma.receipt_link_token.count({ where: { branchId: promotion.fixture.branch.id } })).toBe(beforeTokenCount);
        expect(await prisma.eformsign_doc.count({ where: { branchId: promotion.fixture.branch.id } })).toBe(beforeDocumentCount);

        const afterState = await editRepository.findRevisionDocumentState(
            promotion.fixture.branch.id,
            promotion.fixture.client.id,
            promotion.revision.id,
            promotion.state.id,
        );
        expect(afterState).toMatchObject({
            status: "completed",
            step: "artifact_promoted",
            version: promotion.state.version + 1,
            immutableInput: promotion.immutableInput,
            outputProof: promotion.proof,
        });
        expect((afterState?.immutableInput as { expected: typeof promotion.immutableInput.expected }).expected)
            .toEqual({
                serviceStartDate: SERVICE_START_DATE,
                serviceEndDate: SERVICE_END_DATE,
                receivedDate: RECEIVED_DATE,
                amount: RECEIPT_AMOUNT,
            });
    });

    it("fails closed for stale proof, state version, and revision without replacing the old artifact", async () => {
        const promotion = await buildPromotionFixture(prisma);
        const beforeToken = await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } });

        const staleProofResult = await tokenRepository.promoteReceiptRevisionArtifact({
            ...promotion.input,
            proof: { ...promotion.proof, officialPdfSha256: "d".repeat(64) },
        });
        expect(staleProofResult.disposition).toBe("stale");
        expect(await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } })).toEqual(beforeToken);

        const staleStateResult = await tokenRepository.promoteReceiptRevisionArtifact({
            ...promotion.input,
            expectedStateVersion: promotion.state.version + 1,
        });
        expect(staleStateResult).toMatchObject({ disposition: "stale", stateVersion: promotion.state.version });
        expect(await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } })).toEqual(beforeToken);

        const competingRevision = await promotion.editRepository.appendRevision({
            branchId: promotion.fixture.branch.id,
            serviceRecordCaseId: promotion.fixture.record.id,
            actorUserId: promotion.fixture.actorUserId,
            payload: { kind: "new-current-revision" },
            plannedSessions: { sessions: [] },
            provenance: { source: "synthetic-competing-revision" },
            formVersionAtConfirm: 1,
        });
        await prisma.service_record_case.update({
            where: { id: promotion.fixture.record.id },
            data: { currentRevisionId: competingRevision.id },
        });
        const staleRevisionResult = await tokenRepository.promoteReceiptRevisionArtifact(promotion.input);
        expect(staleRevisionResult.disposition).toBe("stale");
        expect(await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } })).toEqual(beforeToken);
        expect(await promotion.editRepository.findRevisionDocumentState(
            promotion.fixture.branch.id,
            promotion.fixture.client.id,
            promotion.revision.id,
            promotion.state.id,
        )).toMatchObject({ status: "processing", step: "proof_ready", version: promotion.state.version });
    });

    it("refuses a cross-branch owner and leaves the original token untouched", async () => {
        const promotion = await buildPromotionFixture(prisma);
        const other = await createServiceRecordConfirmFixture(prisma);
        const beforeToken = await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } });

        const result = await tokenRepository.promoteReceiptRevisionArtifact({
            ...promotion.input,
            branchId: other.branch.id,
            proof: {
                ...promotion.proof,
                scope: { ...promotion.proof.scope, branchId: other.branch.id },
            },
        });

        expect(result.disposition).toBe("not_found");
        expect(await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } })).toEqual(beforeToken);
    });

    it("allows exactly one concurrent promotion for a generation and retains that winner", async () => {
        const promotion = await buildPromotionFixture(prisma);
        const contenderClient = createApprovedServiceRecordConfirmClient();
        await contenderClient.$connect();
        try {
            const contenderRepository = new SbReceiptLinkTokenRepository(contenderClient as unknown as PrismaService);
            const winnerInput = { ...promotion.input, storagePath: `receipts/${promotion.token.id}/race-a.pdf`, contentSha256: "e".repeat(64), byteSize: 333 };
            const loserInput = { ...promotion.input, storagePath: `receipts/${promotion.token.id}/race-b.pdf`, contentSha256: "f".repeat(64), byteSize: 444 };
            const [first, second] = await Promise.all([
                tokenRepository.promoteReceiptRevisionArtifact(winnerInput),
                contenderRepository.promoteReceiptRevisionArtifact(loserInput),
            ]);
            expect([first.disposition, second.disposition].sort()).toEqual(["promoted", "stale"]);
            const promotedInput = first.disposition === "promoted" ? winnerInput : loserInput;
            const token = await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } });
            expect(token.storagePath).toBe(promotedInput.storagePath);
            expect(token.contentSha256).toBe(promotedInput.contentSha256);
            expect(token.byteSize).toBe(promotedInput.byteSize);
            expect(await prisma.receipt_link_token.count({ where: { branchId: promotion.fixture.branch.id } })).toBe(1);
            const state = await editRepository.findRevisionDocumentState(
                promotion.fixture.branch.id,
                promotion.fixture.client.id,
                promotion.revision.id,
                promotion.state.id,
            );
            expect(state).toMatchObject({ status: "completed", step: "artifact_promoted", version: promotion.state.version + 1 });
        } finally {
            await contenderClient.$disconnect();
        }
    });

    it("preserves expired and revoked tokens without issuing a token or SMS", async () => {
        const cases = [
            { label: "expired", tokenExpiresAt: new Date("2026-09-29T23:59:59.000Z"), tokenActive: true, tokenRevokedAt: null },
            { label: "revoked", tokenExpiresAt: new Date("2026-12-31T23:59:59.000Z"), tokenActive: false, tokenRevokedAt: new Date("2026-09-29T09:00:00.000Z") },
        ] as const;
        for (const tokenCase of cases) {
            const promotion = await buildPromotionFixture(prisma, tokenCase);
            const beforeToken = await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } });
            const beforeTokenCount = await prisma.receipt_link_token.count({ where: { branchId: promotion.fixture.branch.id } });
            const beforeMessageCount = await prisma.message_log.count({ where: { branchId: promotion.fixture.branch.id } });

            const result = await tokenRepository.promoteReceiptRevisionArtifact(promotion.input);

            expect(result.disposition).toBe("stale");
            expect(await prisma.receipt_link_token.findUniqueOrThrow({ where: { id: promotion.token.id } })).toEqual(beforeToken);
            expect(await prisma.receipt_link_token.count({ where: { branchId: promotion.fixture.branch.id } })).toBe(beforeTokenCount);
            expect(await prisma.message_log.count({ where: { branchId: promotion.fixture.branch.id } })).toBe(beforeMessageCount);
        }
    });
});
