import {
    loadRevisionFactsSource,
    lockClientOwnedContractDocuments,
} from "infrastructure/database/repositories/service-record-edit.repository";
import type { ServiceRecordEditSource } from "domain/repositories/service-record-edit.repository.interface";

/**
 * The confirm planner reads receipt facts from the client's CURRENT contract (shared
 * `selectCurrentContractDocument` rule over database-ranked candidates), while contract-revision
 * planning keeps following the `client.eDocId`-pinned document.
 */

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = 101;
const TOKEN_ID = "66666666-6666-4666-8666-666666666666";

function scope(options: { pointerDocumentId: string | null; tokenDocumentId: string | null }): ServiceRecordEditSource {
    return {
        client: { id: CLIENT_ID },
        documentScope: {
            evidence: "observed",
            serviceRecordSnapshot: { documentIds: [], snapshotVersion: null, chunks: [] },
            currentRevision: { id: null, revisionNumber: null, formVersion: null },
            form: { version: 3 },
            contract: { currentDocumentId: options.pointerDocumentId, stage: "in_progress" },
            receipt: {
                evidence: "observed",
                eformsignDocId: options.tokenDocumentId ? 77 : null,
                tokenIds: options.tokenDocumentId ? [TOKEN_ID] : [],
                sourceDocumentId: options.tokenDocumentId,
            },
        },
    } as unknown as ServiceRecordEditSource;
}

function row(documentId: string, tokens: Array<Record<string, unknown>> = []) {
    return {
        documentId,
        branchId: BRANCH_ID,
        clientId: CLIENT_ID,
        snapshotVersion: null,
        templateId: "contract-template",
        statusType: "070",
        stepType: "06",
        stepIndex: "3",
        stepName: "step",
        stepRecipientType: "02",
        stepRecipientName: "name",
        stepRecipientSms: null,
        detailPayload: { id: documentId },
        receiptLinkTokens: tokens,
    };
}

function liveToken(eformsignDocId = 77) {
    return { id: TOKEN_ID, eformsignDocId, branchId: BRANCH_ID, clientId: CLIENT_ID, active: true, revokedAt: null };
}

function candidate(id: number, documentId: string, extra: Record<string, unknown> = {}) {
    return { id, documentId, documentKind: "contract", serviceRecordCaseId: null, templateId: "contract-template", ...extra };
}

/** A tx whose `eformsign_doc.findMany` answers the candidate query and the document query. */
function fakeTx(options: { candidates: unknown[] | Error; documents: unknown[] }) {
    const findMany = jest.fn(async (args: { where: Record<string, unknown> }) => {
        if ("documentId" in args.where) return options.documents;
        if (options.candidates instanceof Error) throw options.candidates;
        return options.candidates;
    });
    return { tx: { eformsign_doc: { findMany } } as never, findMany };
}

const candidateQuery = (findMany: jest.Mock) => findMany.mock.calls.find(
    ([args]) => !("documentId" in (args as { where: Record<string, unknown> }).where),
)?.[0] as { where: Record<string, unknown>; orderBy: unknown } | undefined;

describe("loadRevisionFactsSource receipt document", () => {
    it("reads receipt facts from the current contract B while the contract facts stay on the pinned A", async () => {
        const { tx, findMany } = fakeTx({
            candidates: [candidate(20, "doc-B"), candidate(10, "doc-A")],
            documents: [row("doc-A"), row("doc-B", [liveToken()])],
        });

        const result = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-B" }),
        );

        expect(result.document?.documentId).toBe("doc-A");
        expect(result.receiptDocument?.documentId).toBe("doc-B");
        expect(result.receiptTokens).toEqual([expect.objectContaining({ id: TOKEN_ID, eformsignDocId: 77 })]);
        expect(candidateQuery(findMany)).toEqual({
            where: {
                clientId: CLIENT_ID,
                serviceRecordCaseId: null,
                OR: [{ documentKind: "contract" }, { documentKind: null }],
            },
            // Ranked by the database at full precision; the same order the summary uses.
            orderBy: [{ createdDate: "desc" }, { id: "desc" }],
            select: expect.any(Object),
        });
    });

    it("hands the contract-revision planner the same document as before (no retargeting of the contract write)", async () => {
        const { tx } = fakeTx({
            candidates: [candidate(20, "doc-B"), candidate(10, "doc-A")],
            documents: [row("doc-A"), row("doc-B", [liveToken()])],
        });

        const lagging = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-B" }),
        );
        const aligned = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-A" }),
        );

        expect(lagging.document?.documentId).toBe("doc-A");
        expect(aligned.document?.documentId).toBe("doc-A");
    });

    it("keeps one shared document when the pointer, the tokens and the current contract agree", async () => {
        const { tx, findMany } = fakeTx({
            candidates: [candidate(10, "doc-A")],
            documents: [row("doc-A", [liveToken(10)])],
        });

        const result = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-A" }),
        );

        expect(result.receiptDocument).toBe(result.document);
        const documentQuery = findMany.mock.calls.find(([args]) => "documentId" in (args as { where: Record<string, unknown> }).where)?.[0] as {
            where: { documentId: { in: string[] } };
        };
        expect(documentQuery.where.documentId.in).toEqual(["doc-A"]);
    });

    it("fails the receipt closed when the current contract is not a readable branch/client contract", async () => {
        const { tx } = fakeTx({
            candidates: [candidate(20, "doc-B"), candidate(10, "doc-A")],
            // doc-B (current) is not returned by the branch/client/contract-scoped read.
            documents: [row("doc-A", [liveToken(10)])],
        });

        const result = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-A" }),
        );

        // The tokens live on the stale pointer document: they must not rebuild a receipt from it.
        expect(result.receiptDocument).toBeNull();
        expect(result.document?.documentId).toBe("doc-A");
    });

    it("fails the receipt closed when the client has no current contract candidate", async () => {
        const { tx } = fakeTx({ candidates: [], documents: [row("doc-A", [liveToken(10)])] });

        const result = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-A" }),
        );

        expect(result.receiptDocument).toBeNull();
    });

    it("excludes configured service-record template rows from the current-contract choice", async () => {
        const candidates = [
            candidate(30, "sr-doc", { templateId: "sr-template" }),
            candidate(20, "doc-B"),
            candidate(10, "doc-A"),
        ];
        const documents = [row("doc-A"), row("doc-B", [liveToken()])];

        const configured = await loadRevisionFactsSource(
            fakeTx({ candidates, documents }).tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-B" }),
            new Set(["sr-template"]),
        );
        const unconfigured = await loadRevisionFactsSource(
            fakeTx({ candidates, documents }).tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-B" }),
        );

        expect(configured.receiptDocument?.documentId).toBe("doc-B");
        // Without the template ids the template row would win, and it is not a readable contract.
        expect(unconfigured.receiptDocument).toBeNull();
    });

    it("does not rank candidates when no receipt token was observed", async () => {
        const { tx, findMany } = fakeTx({ candidates: [candidate(20, "doc-B")], documents: [row("doc-A")] });

        const result = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: null }),
        );

        expect(candidateQuery(findMany)).toBeUndefined();
        expect(result.document?.documentId).toBe("doc-A");
        expect(result.receiptDocument).toBeUndefined();
    });

    it("falls back to the token document for the contract facts when the pointer is cleared (unchanged)", async () => {
        const { tx } = fakeTx({
            candidates: [candidate(10, "doc-A")],
            documents: [row("doc-A", [liveToken(10)])],
        });

        const result = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: null, tokenDocumentId: "doc-A" }),
        );

        expect(result.document?.documentId).toBe("doc-A");
        expect(result.receiptDocument?.documentId).toBe("doc-A");
    });

    it("reports an unknown observation, not a guess, when the candidate query fails", async () => {
        const { tx } = fakeTx({ candidates: new Error("db down"), documents: [] });

        const result = await loadRevisionFactsSource(
            tx,
            BRANCH_ID,
            scope({ pointerDocumentId: "doc-A", tokenDocumentId: "doc-B" }),
        );

        expect(result).toEqual({ document: null, receiptTokens: undefined });
    });
});

describe("lockClientOwnedContractDocuments", () => {
    it("locks the pointer document and every client contract candidate in id order", async () => {
        const queryRaw = jest.fn().mockResolvedValue([]);

        await lockClientOwnedContractDocuments({ $queryRaw: queryRaw } as never, BRANCH_ID, CLIENT_ID);

        const sql = queryRaw.mock.calls[0]?.[0] as { strings: string[] };
        const text = sql.strings.join("?");
        expect(text).toContain("owner_client.e_doc_id = owner_doc.document_id");
        expect(text).toContain("owner_doc.service_record_case_id IS NULL");
        expect(text).toContain("owner_doc.document_kind = 'contract' OR owner_doc.document_kind IS NULL");
        expect(text).toContain("ORDER BY owner_doc.id");
        expect(text).toContain("FOR UPDATE OF owner_doc");
    });
});
