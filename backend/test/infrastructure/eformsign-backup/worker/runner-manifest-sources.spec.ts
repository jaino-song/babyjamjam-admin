import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { encodeLedgerLine, type Installation, type LedgerBodies, type LedgerRecord } from "domain/eformsign-backup/worker";
import { readManifestHistory } from "infrastructure/eformsign-backup/worker/runner-manifest-sources";

import { INSTALL_BODY, fixedAt } from "./helpers/ledger-fixtures";

const INSTALLATION = { ...INSTALL_BODY, origin: "installed", priorLedgerName: null } satisfies Installation;
const hex = (n: number): string => n.toString(16).padStart(64, "0");

type Artifact = LedgerBodies["candidate_observed"]["artifacts"][number];
const artifact = (type: Artifact["artifactType"], n: number): Artifact => ({ artifactType: type, artifactIdentity: hex(n), sha256: hex(n + 1000), byteLength: 100 + n });

function observed(seq: number, documentId: string, revision: number, artifacts: Artifact[], classification: LedgerBodies["candidate_observed"]["classification"] = "included", snapshotId = "snap-1"): LedgerRecord {
    return {
        v: 1, seq, type: "candidate_observed", at: fixedAt(seq),
        body: { snapshotId, ordinal: seq, documentId, classification, metadataRevision: hex(revision), artifacts },
    };
}
const installed = (): LedgerRecord => ({ v: 1, seq: 1, type: "installed", at: fixedAt(1), body: INSTALL_BODY });
const lines = (records: LedgerRecord[]): string => records.map((record) => encodeLedgerLine(record)).join("");

describe("readManifestHistory (BJJ-455 P2 FU-10-F1)", () => {
    let control: string;
    let ledger: string;
    beforeEach(async () => {
        control = await fs.mkdtemp(path.join(os.tmpdir(), "bjj455-history-"));
        await fs.chmod(control, 0o700);
        ledger = path.join(control, "ledger");
        await fs.mkdir(ledger, { mode: 0o700 });
    });
    afterEach(async () => { await fs.rm(control, { recursive: true, force: true }); });
    const journal = (base: number, text: string): Promise<void> => fs.writeFile(path.join(ledger, `journal-${String(base).padStart(12, "0")}.jsonl`), text, { mode: 0o600 });
    const read = (lastSeq: number, installation: Installation = INSTALLATION) => readManifestHistory(control, lastSeq, installation);

    it("should find the latest revision of a document that lists the artifact, across journals and after observations left the state", async () => {
        const doc = artifact("document", 1);
        await journal(1, lines([installed(), observed(2, "D001", 1, [doc]), observed(3, "D001", 2, [doc, artifact("audit-trail", 2)])]));
        await journal(4, lines([observed(4, "D002", 3, [artifact("document", 3)])]));

        const history = await read(4);

        expect(history.find(hex(1))).toMatchObject({ documentId: "D001", metadataRevision: hex(2), artifacts: [doc, artifact("audit-trail", 2)] });
        expect(history.find(hex(3))).toMatchObject({ documentId: "D002" });
        expect(history.find(hex(99))).toBeNull();
    });

    it("should ignore excluded observations and anything past the captured sequence", async () => {
        await journal(1, lines([installed(), observed(2, "D001", 1, [], "excluded_by_policy"), observed(3, "D002", 2, [artifact("document", 2)])]));

        const history = await read(2);

        expect(history.find(hex(2))).toBeNull();
    });

    it("should refuse conflicting observations of one revision, but accept an identical one again", async () => {
        const doc = artifact("document", 1);
        await journal(1, lines([installed(), observed(2, "D001", 1, [doc]), observed(3, "D001", 1, [doc]), observed(4, "D009", 5, [artifact("document", 5)]), observed(5, "D009", 5, [artifact("document", 5), artifact("audit-trail", 6)])]));

        const history = await read(5);

        expect(history.find(hex(1))).toMatchObject({ documentId: "D001" });
        expect(history.find(hex(5))).toBe("invalid");
    });

    describe("artifact-set variants of one revision (BJJ-455 P2 FU-10-F5)", () => {
        const doc = artifact("document", 1);
        const auditOld = artifact("audit-trail", 2);
        const auditNew = { ...artifact("audit-trail", 3) };

        it("should keep both artifact sets that two snapshots advertised under one revision, oldest first", async () => {
            await journal(1, lines([installed(), observed(2, "D001", 1, [doc, auditOld], "included", "snap-1"), observed(3, "D001", 1, [doc, auditNew], "included", "snap-2")]));

            const history = await read(3);

            expect(history.forRevision("D001", hex(1))).toEqual([
                { documentId: "D001", metadataRevision: hex(1), artifacts: [doc, auditOld] },
                { documentId: "D001", metadataRevision: hex(1), artifacts: [doc, auditNew] },
            ]);
            expect(history.forRevision("D001", hex(9))).toEqual([]);
            // The latest sound observation of the artifact decides what it is rebuilt from.
            expect(history.find(hex(1))).toMatchObject({ artifacts: [doc, auditNew] });
            expect(history.find(hex(2))).toMatchObject({ artifacts: [doc, auditOld] });
        });

        it("should report observations of one revision that disagree inside ONE snapshot, and skip them when rebuilding", async () => {
            await journal(1, lines([installed(), observed(2, "D001", 1, [doc, auditOld], "included", "snap-1"), observed(3, "D001", 1, [doc, auditNew], "included", "snap-1"),
                observed(4, "D001", 2, [doc], "included", "snap-2")]));

            const history = await read(4);

            expect(history.forRevision("D001", hex(1))).toBe("conflict");
            expect(history.forRevision("D001", hex(2))).toEqual([{ documentId: "D001", metadataRevision: hex(2), artifacts: [doc] }]);
            expect(history.find(hex(1))).toMatchObject({ metadataRevision: hex(2) });
            expect(history.find(hex(2))).toBe("invalid");
        });

        it("should refuse an artifact whose length two observations contradict, though its identity does not bind the length", async () => {
            await journal(1, lines([installed(), observed(2, "D001", 1, [doc], "included", "snap-1"),
                observed(3, "D002", 2, [{ ...doc, byteLength: doc.byteLength + 1 }], "included", "snap-2")]));

            expect((await read(3)).find(hex(1))).toBe("invalid");
        });

        it("should be unavailable for revisions when the history is", async () => {
            expect((await read(1)).forRevision("D001", hex(1))).toBe("unavailable");
        });
    });

    it.each([
        ["a sequence gap", async () => journal(1, lines([installed(), observed(3, "D001", 1, [artifact("document", 1)])])), 2],
        ["a journal that stops short of the captured sequence", async () => journal(1, lines([installed()])), 2],
        ["a journal that does not start at 1", async () => journal(2, lines([observed(2, "D001", 1, [artifact("document", 1)])])), 2],
        ["another installation", async () => journal(1, lines([{ ...installed(), body: { ...INSTALL_BODY, installationId: "someone-else" } } as LedgerRecord, observed(2, "D001", 1, [artifact("document", 1)])])), 2],
        ["a first record that is not an installation", async () => journal(1, lines([observed(1, "D001", 1, [artifact("document", 1)])])), 1],
        ["a damaged line", async () => journal(1, lines([installed(), observed(2, "D001", 1, [artifact("document", 1)])]).replace("D001", "D002")), 2],
        ["an unreadable line", async () => journal(1, `${lines([installed()])}not json\n`), 2],
        ["a torn line before the live journal", async () => { await journal(1, `${lines([installed()])}{torn`); await journal(2, lines([observed(2, "D001", 1, [artifact("document", 1)])])); }, 2],
        ["a name that is not a journal", async () => { await journal(1, lines([installed()])); await fs.writeFile(path.join(ledger, "journal-x.jsonl"), ""); }, 1],
    ])("should be unavailable for %s", async (_name, arrange, lastSeq) => {
        await arrange();

        const history = await read(lastSeq);

        expect(history.find(hex(1))).toBe("invalid");
    });

    it("should refuse a symlinked journal and a ledger directory others can write", async () => {
        await fs.writeFile(path.join(control, "copy"), lines([installed()]), { mode: 0o600 });
        await fs.symlink(path.join(control, "copy"), path.join(ledger, "journal-000000000001.jsonl"));
        expect((await read(1)).find(hex(1))).toBe("invalid");

        await fs.rm(path.join(ledger, "journal-000000000001.jsonl"));
        await journal(1, lines([installed()]));
        await fs.chmod(ledger, 0o777);
        expect((await read(1)).find(hex(1))).toBe("invalid");
    });

    it("should tolerate a torn tail on the live journal and never look into a quarantined lineage", async () => {
        const doc = artifact("document", 1);
        await journal(1, `${lines([installed(), observed(2, "D001", 1, [doc])])}{torn`);
        await fs.mkdir(path.join(control, "ledger.quarantine-00000000-0000-4000-8000-000000000001"), { mode: 0o700 });
        await fs.writeFile(path.join(control, "ledger.quarantine-00000000-0000-4000-8000-000000000001", "journal-000000000001.jsonl"), lines([installed(), observed(2, "D777", 7, [artifact("document", 7)])]), { mode: 0o600 });

        const history = await read(2);

        expect(history.find(hex(1))).toMatchObject({ documentId: "D001" });
        expect(history.find(hex(7))).toBeNull();
    });
});
