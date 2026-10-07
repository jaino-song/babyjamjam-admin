import {
    selectCurrentContractDocument,
    type CurrentContractCandidate,
} from "application/utils/current-contract-document";

type Row = CurrentContractCandidate & { documentId: string; permanentPurgeRequestedAt?: Date | null };

const row = (overrides: Partial<Row> & Pick<Row, "id" | "documentId">): Row => ({
    createdDate: new Date("2026-01-01T00:00:00Z"),
    documentKind: "contract",
    serviceRecordCaseId: null,
    templateId: null,
    ...overrides,
});

const NO_TEMPLATES: ReadonlySet<string> = new Set();

describe("selectCurrentContractDocument", () => {
    it("returns null when there are no rows", () => {
        expect(selectCurrentContractDocument([], NO_TEMPLATES)).toBeNull();
    });

    it("picks the newest contract by createdDate regardless of input order", () => {
        const older = row({ id: 1, documentId: "older", createdDate: new Date("2026-01-01T00:00:00Z") });
        const newer = row({ id: 2, documentId: "newer", createdDate: new Date("2026-06-01T00:00:00Z") });
        expect(selectCurrentContractDocument([older, newer], NO_TEMPLATES)?.documentId).toBe("newer");
        expect(selectCurrentContractDocument([newer, older], NO_TEMPLATES)?.documentId).toBe("newer");
    });

    it("breaks a createdDate tie by the higher id", () => {
        const date = new Date("2026-06-01T00:00:00Z");
        const low = row({ id: 5, documentId: "low", createdDate: date });
        const high = row({ id: 9, documentId: "high", createdDate: date });
        expect(selectCurrentContractDocument([high, low], NO_TEMPLATES)?.documentId).toBe("high");
        expect(selectCurrentContractDocument([low, high], NO_TEMPLATES)?.documentId).toBe("high");
    });

    it("treats legacy documentKind=null rows as contracts", () => {
        const legacy = row({ id: 2, documentId: "legacy", documentKind: null, createdDate: new Date("2026-06-01T00:00:00Z") });
        const typed = row({ id: 1, documentId: "typed", createdDate: new Date("2026-01-01T00:00:00Z") });
        expect(selectCurrentContractDocument([typed, legacy], NO_TEMPLATES)?.documentId).toBe("legacy");
    });

    it("never selects a service-record snapshot, a case-linked row, or a service-record template row", () => {
        const contract = row({ id: 1, documentId: "contract", createdDate: new Date("2026-01-01T00:00:00Z") });
        const rows = [
            contract,
            row({ id: 2, documentId: "snapshot", documentKind: "service_record_snapshot", createdDate: new Date("2026-02-01T00:00:00Z") }),
            row({ id: 3, documentId: "case", serviceRecordCaseId: "case-1", createdDate: new Date("2026-03-01T00:00:00Z") }),
            row({ id: 4, documentId: "legacy-template", documentKind: null, templateId: "sr-template", createdDate: new Date("2026-04-01T00:00:00Z") }),
        ];
        expect(selectCurrentContractDocument(rows, new Set(["sr-template"]))?.documentId).toBe("contract");
    });

    it("never selects an unknown document kind", () => {
        const other = row({ id: 2, documentId: "other", documentKind: "something_else", createdDate: new Date("2026-06-01T00:00:00Z") });
        expect(selectCurrentContractDocument([other], NO_TEMPLATES)).toBeNull();
    });

    it("keeps a purge-requested newest contract as the current one (the caller fails closed, never falls back)", () => {
        const older = row({ id: 1, documentId: "older", createdDate: new Date("2026-01-01T00:00:00Z") });
        const purged = row({
            id: 2,
            documentId: "purged",
            createdDate: new Date("2026-06-01T00:00:00Z"),
            permanentPurgeRequestedAt: new Date("2026-07-01T00:00:00Z"),
        });
        const current = selectCurrentContractDocument([older, purged], NO_TEMPLATES);
        expect(current?.documentId).toBe("purged");
        expect(current?.permanentPurgeRequestedAt).toEqual(new Date("2026-07-01T00:00:00Z"));
    });

    it("does not mutate its input", () => {
        const rows = [
            row({ id: 1, documentId: "a", createdDate: new Date("2026-01-01T00:00:00Z") }),
            row({ id: 2, documentId: "b", createdDate: new Date("2026-06-01T00:00:00Z") }),
        ];
        const snapshot = rows.map((r) => r.documentId);
        selectCurrentContractDocument(rows, NO_TEMPLATES);
        expect(rows.map((r) => r.documentId)).toEqual(snapshot);
    });
});
