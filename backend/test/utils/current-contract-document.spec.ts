import {
    findLatestContractSignalsByClientId,
    isActiveContractSignal,
    isCompletedContractSignal,
    isContractSendRequired,
    isIncompleteContractSignal,
    isVoidedContractSignal,
    selectCurrentContractDocument,
    type CurrentContractCandidate,
} from "application/utils/current-contract-document";

type Row = CurrentContractCandidate & {
    id: number;
    documentId: string;
    createdDate: Date;
    permanentPurgeRequestedAt?: Date | null;
    voidedAt?: Date | null;
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

describe("requested-state contract signals (060 / 063 / 064 / 070 / 071)", () => {
    // Start date inside the send window, no other reason to skip: only the contract signal decides.
    const calendar = { diffBusinessDays: () => 0 } as unknown as Parameters<typeof isContractSendRequired>[1];
    const sendRequiredFor = (statusType: string | null) =>
        isContractSendRequired(
            {
                serviceStatus: "active",
                startDate: new Date("2026-07-16T00:00:00Z"),
                hasActiveContractDocument:
                    statusType === null
                        ? false
                        : isActiveContractSignal({ statusType, permanentPurgeRequestedAt: null }),
                now: new Date("2026-07-14T03:00:00Z"),
            },
            calendar,
        );

    it.each(["060", "063", "064", "070", "071"])("treats a current %s document as active, incomplete and not 발송 필요", (statusType) => {
        const contract = { statusType, permanentPurgeRequestedAt: null };
        expect(isActiveContractSignal(contract)).toBe(true);
        expect(isIncompleteContractSignal(contract)).toBe(true);
        expect(sendRequiredFor(statusType)).toBe(false);
    });

    it("keeps a purge-requested 063/064 document dead so 발송 필요 still fires", () => {
        for (const statusType of ["063", "064"]) {
            expect(isActiveContractSignal({ statusType, permanentPurgeRequestedAt: new Date() })).toBe(false);
        }
    });

    it("still requires sending when there is no document or the document is dead (control)", () => {
        expect(sendRequiredFor(null)).toBe(true);
        for (const statusType of ["080", "061", "049", "099", "042"]) {
            expect(sendRequiredFor(statusType)).toBe(true);
        }
    });
});

describe("voided (계약 파기) newest contract", () => {
    const VOIDED_AT = new Date("2026-07-10T00:00:00Z");
    const calendar = { diffBusinessDays: () => 0 } as unknown as Parameters<typeof isContractSendRequired>[1];
    const sendRequired = (hasActiveContractDocument: boolean) =>
        isContractSendRequired(
            {
                serviceStatus: "active",
                startDate: new Date("2026-07-16T00:00:00Z"),
                hasActiveContractDocument,
                now: new Date("2026-07-14T03:00:00Z"),
            },
            calendar,
        );

    it("keeps returning the voided newest row and never skips to an older signed contract", () => {
        const older = row({ id: 1, documentId: "older-signed", createdDate: new Date("2026-01-01T00:00:00Z") });
        const voided = row({ id: 2, documentId: "voided", createdDate: new Date("2026-06-01T00:00:00Z"), voidedAt: VOIDED_AT });
        const current = selectCurrentContractDocument([voided, older], NO_TEMPLATES);
        expect(current?.documentId).toBe("voided");
        expect(current?.voidedAt).toEqual(VOIDED_AT);
    });

    it.each(["060", "041", "040", "020", "010", "003", "050", "070"])(
        "treats a voided %s document as not active, not completed and not incomplete, whatever its eformsign code says",
        (statusType) => {
            const contract = { statusType, permanentPurgeRequestedAt: null, voidedAt: VOIDED_AT };
            expect(isVoidedContractSignal(contract)).toBe(true);
            expect(isActiveContractSignal(contract)).toBe(false);
            expect(isCompletedContractSignal(contract)).toBe(false);
            expect(isIncompleteContractSignal(contract)).toBe(false);
        },
    );

    it.each(["060", "041", "040", "003", "050", "070"])(
        "control: the same %s document that is not voided keeps its previous liveness",
        (statusType) => {
            for (const voidedAt of [null, undefined]) {
                const contract = { statusType, permanentPurgeRequestedAt: null, voidedAt };
                expect(isVoidedContractSignal(contract)).toBe(false);
                expect(isActiveContractSignal(contract)).toBe(true);
            }
            expect(isActiveContractSignal({ statusType, permanentPurgeRequestedAt: null })).toBe(true);
        },
    );

    it("control: completed codes stay completed and 070 stays incomplete when not voided", () => {
        expect(isCompletedContractSignal({ statusType: "003", permanentPurgeRequestedAt: null, voidedAt: null })).toBe(true);
        expect(isIncompleteContractSignal({ statusType: "070", permanentPurgeRequestedAt: null, voidedAt: null })).toBe(true);
        expect(isIncompleteContractSignal({ statusType: "003", permanentPurgeRequestedAt: null, voidedAt: null })).toBe(false);
    });

    it("requires sending a contract when the newest document is voided, even though an older one is signed", () => {
        const voidedNewest = { statusType: "003", permanentPurgeRequestedAt: null, voidedAt: VOIDED_AT };
        expect(sendRequired(isActiveContractSignal(voidedNewest))).toBe(true);
    });

    it("control: does not require sending when the newest document is the same code and not voided", () => {
        const liveNewest = { statusType: "003", permanentPurgeRequestedAt: null, voidedAt: null };
        expect(sendRequired(isActiveContractSignal(liveNewest))).toBe(false);
    });

    it("isVoidedContractSignal is false for an absent contract", () => {
        expect(isVoidedContractSignal(null)).toBe(false);
        expect(isVoidedContractSignal(undefined)).toBe(false);
    });
});

describe("findLatestContractSignalsByClientId voided column", () => {
    const docRow = (overrides: Record<string, unknown>) => ({
        clientId: 1,
        documentId: "doc",
        statusType: "003",
        stepType: null,
        stepName: null,
        detailPayload: null,
        permanentPurgeRequestedAt: null,
        voidedAt: null,
        documentKind: "contract",
        serviceRecordCaseId: null,
        templateId: null,
        ...overrides,
    });
    const prismaWith = (rows: Record<string, unknown>[]) => {
        const findMany = jest.fn().mockResolvedValue(rows);
        return { prisma: { eformsign_doc: { findMany } } as never, findMany };
    };

    it("selects voidedAt and carries it on the signal of the newest document", async () => {
        const voidedAt = new Date("2026-07-10T00:00:00Z");
        const { prisma, findMany } = prismaWith([
            docRow({ documentId: "newest-voided", voidedAt }),
            docRow({ documentId: "older-signed" }),
        ]);

        const signals = await findLatestContractSignalsByClientId(prisma, NO_TEMPLATES, [1]);

        expect(findMany.mock.calls[0][0].select.voidedAt).toBe(true);
        expect(signals.get(1)?.documentId).toBe("newest-voided");
        expect(signals.get(1)?.voidedAt).toEqual(voidedAt);
        expect(isActiveContractSignal(signals.get(1))).toBe(false);
    });

    it("control: a non-voided newest document carries a null voidedAt and stays active", async () => {
        const { prisma } = prismaWith([docRow({ documentId: "newest" })]);

        const signals = await findLatestContractSignalsByClientId(prisma, NO_TEMPLATES, [1]);

        expect(signals.get(1)?.voidedAt).toBeNull();
        expect(isActiveContractSignal(signals.get(1))).toBe(true);
    });

    it("does not query for an empty client list", async () => {
        const { prisma, findMany } = prismaWith([]);
        await findLatestContractSignalsByClientId(prisma, NO_TEMPLATES, []);
        expect(findMany).not.toHaveBeenCalled();
    });
});
