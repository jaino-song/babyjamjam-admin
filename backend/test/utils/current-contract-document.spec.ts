import {
    selectCurrentContractDocument,
    type CurrentContractCandidate,
} from "application/utils/current-contract-document";

type Row = CurrentContractCandidate & {
    id: number;
    documentId: string;
    createdDate: Date;
    permanentPurgeRequestedAt?: Date | null;
};

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

    it("returns the first contract of the DB-ordered input (newest first), never re-ranking by JS Date", () => {
        const newer = row({ id: 2, documentId: "newer", createdDate: new Date("2026-06-01T00:00:00Z") });
        const older = row({ id: 1, documentId: "older", createdDate: new Date("2026-01-01T00:00:00Z") });
        expect(selectCurrentContractDocument([newer, older], NO_TEMPLATES)?.documentId).toBe("newer");
    });

    it("honours the database order when timestamps tie at millisecond precision (timestamptz(6) microseconds)", () => {
        // Both rows are 2026-06-01T00:00:00.000Z as JS Dates, but the DB held .000900 for id 10 and
        // .000100 for id 20, so `createdDate desc, id desc` returns id 10 first. A JS re-rank would
        // see a tie and pick id 20.
        const sameMillisecond = new Date("2026-06-01T00:00:00.000Z");
        const dbNewest = row({ id: 10, documentId: "db-newest", createdDate: sameMillisecond });
        const dbOlder = row({ id: 20, documentId: "db-older", createdDate: new Date(sameMillisecond) });
        expect(selectCurrentContractDocument([dbNewest, dbOlder], NO_TEMPLATES)?.documentId).toBe("db-newest");
    });

    it("treats legacy documentKind=null rows as contracts", () => {
        const legacy = row({ id: 2, documentId: "legacy", documentKind: null, createdDate: new Date("2026-06-01T00:00:00Z") });
        const typed = row({ id: 1, documentId: "typed", createdDate: new Date("2026-01-01T00:00:00Z") });
        expect(selectCurrentContractDocument([legacy, typed], NO_TEMPLATES)?.documentId).toBe("legacy");
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
        const current = selectCurrentContractDocument([purged, older], NO_TEMPLATES);
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
