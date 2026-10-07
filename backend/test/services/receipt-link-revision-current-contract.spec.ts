import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import type { PromoteReceiptLinkRevisionArtifactInput } from "domain/repositories/receipt-link-token.repository.interface";

/**
 * Receipt revision promotion must judge "is the target still the client's current contract?" with
 * the same shared rule as the client summary and the automatic receipt path
 * (`selectCurrentContractDocument` over database-ranked candidates), never with the
 * `client.eDocId` pointer, which can lag a re-issued contract.
 */

jest.mock("infrastructure/tenant/run-system-scope", () => ({
    runSystemScope: jest.fn((fn: () => unknown) => fn()),
}));

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const REVISION_ID = "33333333-3333-4333-8333-333333333333";
const STATE_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-08T03:00:00.000Z");
const CLIENT_ID = 7;

interface CandidateRow {
    id: number;
    documentId: string;
    documentKind: string | null;
    serviceRecordCaseId: string | null;
    templateId: string | null;
}

function contract(id: number, documentId: string, extra: Partial<CandidateRow> = {}): CandidateRow {
    return { id, documentId, documentKind: "contract", serviceRecordCaseId: null, templateId: "contract-template", ...extra };
}

function proofFor(documentId: string) {
    return {
        officialPdfSha256: "a".repeat(64),
        verifiedAt: NOW.toISOString(),
        pageCount: 1,
        scope: {
            branchId: BRANCH_ID,
            clientId: CLIENT_ID,
            revisionId: REVISION_ID,
            documentId,
            generation: "generation-1",
            mirrorGeneration: "mirror-1",
            templateId: "template-1",
            templateVersion: "v3",
        },
        expected: { serviceStartDate: "2026-08-01", serviceEndDate: "2026-08-14", receivedDate: "2026-08-02", amount: "123000" },
        artifact: { storagePath: "receipts/new.png", contentSha256: "b".repeat(64), byteSize: 9 },
    };
}

/**
 * Drives one promotion through a fake transaction. `candidates` is what the database returns for
 * the current-contract query, already in `createdDate desc, id desc` order.
 */
function scenario(options: {
    /** The client's (possibly lagging) pointer. Present on the locked client row only to prove it is ignored. */
    eDocId: string | null;
    candidates: CandidateRow[];
    targetDocument: { id: number; documentId: string } | null;
    targetDocumentId: string;
    tokenDocRowId: number;
    serviceRecordTemplateIds?: string[];
}) {
    const proof = proofFor(options.targetDocumentId);
    const queryRaw = jest.fn()
        .mockResolvedValueOnce([{ id: CLIENT_ID, eDocId: options.eDocId }])
        .mockResolvedValueOnce([{ currentRevisionId: REVISION_ID }])
        .mockResolvedValueOnce([{ id: REVISION_ID }])
        .mockResolvedValueOnce([{
            version: 1,
            operation: "receipt_refresh",
            generation: "generation-1",
            sourceDocumentId: "original-document",
            targetDocumentId: options.targetDocumentId,
            documentVersion: 3,
            templateId: "template-1",
            templateVersion: "v3",
            mirrorGeneration: "mirror-1",
            outputProof: proof,
            status: "processing",
        }])
        // The client's document rows, locked in id order before the target is read.
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(options.targetDocument ? [options.targetDocument] : [])
        .mockResolvedValueOnce(options.candidates)
        .mockResolvedValueOnce([{
            id: TOKEN_ID,
            eformsignDocId: options.tokenDocRowId,
            branchId: BRANCH_ID,
            clientId: CLIENT_ID,
            active: true,
            expiresAt: new Date("2026-09-30T00:00:00.000Z"),
        }])
        .mockResolvedValueOnce([{ version: 2 }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { $executeRaw: jest.fn(), $queryRaw: queryRaw, receipt_link_token: { updateMany } };
    const prisma = { $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) };
    const repository = new SbReceiptLinkTokenRepository(prisma as never);
    const input: PromoteReceiptLinkRevisionArtifactInput = {
        branchId: BRANCH_ID,
        clientId: CLIENT_ID,
        serviceRecordCaseId: CASE_ID,
        revisionId: REVISION_ID,
        documentStateId: STATE_ID,
        expectedGeneration: "generation-1",
        expectedStateVersion: 1,
        targetDocumentId: options.targetDocumentId,
        documentVersion: 3,
        templateId: "template-1",
        templateVersion: "v3",
        mirrorGeneration: "mirror-1",
        serviceRecordTemplateIds: options.serviceRecordTemplateIds ?? [],
        eformsignDocId: options.tokenDocRowId,
        tokenIds: [TOKEN_ID],
        storagePath: "receipts/new.png",
        contentSha256: "b".repeat(64),
        byteSize: 9,
        proof,
        now: NOW,
    };
    return { repository, input, queryRaw, updateMany, tx };
}

describe("receipt revision promotion follows the current contract, not client.eDocId", () => {
    beforeEach(() => jest.clearAllMocks());

    it("promotes the current contract B while client.eDocId still points at the older A", async () => {
        const { repository, input, updateMany } = scenario({
            eDocId: "doc-A",
            candidates: [contract(20, "doc-B"), contract(10, "doc-A")],
            targetDocument: { id: 20, documentId: "doc-B" },
            targetDocumentId: "doc-B",
            tokenDocRowId: 20,
        });

        const result = await repository.promoteReceiptRevisionArtifact(input);

        expect(result).toEqual({ disposition: "promoted", tokenIds: [TOKEN_ID], stateVersion: 2 });
        expect(updateMany).toHaveBeenCalledTimes(1);
    });

    it("stable links: a token still attached to the older contract A is refreshed with the current contract B's receipt", async () => {
        const { repository, input, updateMany } = scenario({
            eDocId: "doc-A",
            candidates: [contract(20, "doc-B"), contract(10, "doc-A")],
            targetDocument: { id: 20, documentId: "doc-B" },
            targetDocumentId: "doc-B",
            tokenDocRowId: 10,
        });

        const result = await repository.promoteReceiptRevisionArtifact(input);

        // Product decision: the sent link keeps its token and document (A); only the target
        // (the receipt facts' source) has to be the current contract.
        expect(result).toEqual({ disposition: "promoted", tokenIds: [TOKEN_ID], stateVersion: 2 });
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ eformsignDocId: 10 }),
        }));
    });

    it("refuses a target A while the current contract is the newer B, even though client.eDocId still points at A", async () => {
        const { repository, input, updateMany, queryRaw } = scenario({
            eDocId: "doc-A",
            candidates: [contract(20, "doc-B"), contract(10, "doc-A")],
            targetDocument: { id: 10, documentId: "doc-A" },
            targetDocumentId: "doc-A",
            tokenDocRowId: 10,
        });

        const result = await repository.promoteReceiptRevisionArtifact(input);

        expect(result).toMatchObject({ disposition: "stale", tokenIds: [] });
        expect(updateMany).not.toHaveBeenCalled();
        // Stopped at the currency check: neither the token rows nor the state completion ran.
        expect(queryRaw).toHaveBeenCalledTimes(7);
    });

    it("keeps working when client.eDocId, the target and the current contract all agree", async () => {
        const { repository, input } = scenario({
            eDocId: "doc-A",
            candidates: [contract(10, "doc-A")],
            targetDocument: { id: 10, documentId: "doc-A" },
            targetDocumentId: "doc-A",
            tokenDocRowId: 10,
        });

        await expect(repository.promoteReceiptRevisionArtifact(input)).resolves.toMatchObject({ disposition: "promoted" });
    });

    it("promotes regardless of a cleared client.eDocId when the target is the current contract", async () => {
        const { repository, input } = scenario({
            eDocId: null,
            candidates: [contract(20, "doc-B"), contract(10, "doc-A")],
            targetDocument: { id: 20, documentId: "doc-B" },
            targetDocumentId: "doc-B",
            tokenDocRowId: 20,
        });

        await expect(repository.promoteReceiptRevisionArtifact(input)).resolves.toMatchObject({ disposition: "promoted" });
    });

    it("fails closed when the client has no current contract candidate at all", async () => {
        const { repository, input, updateMany } = scenario({
            eDocId: "doc-A",
            candidates: [],
            targetDocument: { id: 10, documentId: "doc-A" },
            targetDocumentId: "doc-A",
            tokenDocRowId: 10,
        });

        await expect(repository.promoteReceiptRevisionArtifact(input)).resolves.toMatchObject({ disposition: "stale" });
        expect(updateMany).not.toHaveBeenCalled();
    });

    it("trusts the database ranking: a service-record template row never counts as the current contract", async () => {
        const candidates = [
            contract(30, "sr-doc", { templateId: "sr-template" }),
            contract(20, "doc-B"),
            contract(10, "doc-A"),
        ];

        const withTemplates = scenario({
            eDocId: "doc-A",
            candidates,
            targetDocument: { id: 20, documentId: "doc-B" },
            targetDocumentId: "doc-B",
            tokenDocRowId: 20,
            serviceRecordTemplateIds: ["sr-template"],
        });
        await expect(withTemplates.repository.promoteReceiptRevisionArtifact(withTemplates.input))
            .resolves.toMatchObject({ disposition: "promoted" });

        // Without the configured template ids the same rows rank sr-doc first, so B is not current.
        const withoutTemplates = scenario({
            eDocId: "doc-A",
            candidates,
            targetDocument: { id: 20, documentId: "doc-B" },
            targetDocumentId: "doc-B",
            tokenDocRowId: 20,
            serviceRecordTemplateIds: [],
        });
        await expect(withoutTemplates.repository.promoteReceiptRevisionArtifact(withoutTemplates.input))
            .resolves.toMatchObject({ disposition: "stale" });
    });

    it("runs the currency check in the locked transaction, after the target document lock, in database order", async () => {
        const { repository, input, queryRaw, tx } = scenario({
            eDocId: "doc-A",
            candidates: [contract(20, "doc-B"), contract(10, "doc-A")],
            targetDocument: { id: 20, documentId: "doc-B" },
            targetDocumentId: "doc-B",
            tokenDocRowId: 20,
        });

        await repository.promoteReceiptRevisionArtifact(input);

        const text = (call: number) => {
            const sql = queryRaw.mock.calls[call]?.[0] as { strings: string[] };
            return sql.strings.join("?");
        };
        // 0 client lock (no pointer read) -> ... -> 4 every document row of the client locked in
        // id order -> 5 target document lock -> 6 candidates.
        expect(text(0)).toContain("FOR UPDATE");
        expect(text(0)).not.toContain("e_doc_id");
        expect(text(4)).toContain("FROM eformsign_doc");
        expect(text(4)).toContain("WHERE client_id =");
        expect(text(4)).toContain("ORDER BY id");
        expect(text(4)).toContain("FOR UPDATE");
        expect(text(5)).toContain("FROM eformsign_doc");
        expect(text(5)).toContain("FOR UPDATE");
        expect(text(6)).toContain("ORDER BY created_date DESC, id DESC");
        expect(text(6)).toContain("service_record_case_id IS NULL");
        expect(text(6)).not.toContain("e_doc_id");
        // The client row is locked before any document row; the document rows before the check.
        expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[4]!);
        expect(tx.$queryRaw.mock.invocationCallOrder[4]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[6]!);
    });

    it("rejects an envelope without the service-record template ids before opening a transaction", async () => {
        const { repository, input } = scenario({
            eDocId: "doc-A",
            candidates: [contract(10, "doc-A")],
            targetDocument: { id: 10, documentId: "doc-A" },
            targetDocumentId: "doc-A",
            tokenDocRowId: 10,
        });
        const prismaTransaction = (repository as unknown as { prisma: { $transaction: jest.Mock } }).prisma.$transaction;

        const result = await repository.promoteReceiptRevisionArtifact({
            ...input,
            serviceRecordTemplateIds: undefined,
        } as never);

        expect(result).toEqual({ disposition: "stale", tokenIds: [], stateVersion: null });
        expect(prismaTransaction).not.toHaveBeenCalled();
    });
});
