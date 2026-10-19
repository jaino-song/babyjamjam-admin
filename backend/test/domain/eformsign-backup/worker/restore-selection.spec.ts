import {
    buildCompletion, selectCompletion, type CompletionFileEntry, type CompletionInput,
} from "domain/eformsign-backup/worker";
import { createHash } from "node:crypto";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const COMPANY = "company-1";

function completion(sequence: number, snapshotId: string, extra: Partial<CompletionInput> = {}) {
    return buildCompletion({
        companyId: COMPANY, sequence, snapshotId, runId: "3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e",
        scopeRevision: "2026-10-19-company-all-docs", policyRevision: "2026-10-18-completed-pdf-audit",
        destinationIdentity: "local:arch-1", destinationRevision: "local-layout-v1",
        entries: [{ documentId: "D001", metadataRevision: sha(`m${snapshotId}`), manifestSha256: sha(`f${snapshotId}`) }],
        gaps: [], ...extra,
    });
}
const asEntry = (built: ReturnType<typeof completion>): CompletionFileEntry => ({ name: built.name, content: built.value });

// M1 = first snapshot, M2 = the later one (V13).
const M1 = completion(1, "snap-m1");
const M2 = completion(2, "snap-m2");

describe("selectCompletion (T-WRK-04 / V13)", () => {
    it.each([
        ["M1 listed first", [asEntry(M1), asEntry(M2)]],
        ["M1 listed last", [asEntry(M2), asEntry(M1)]],
    ])("returns exactly M1 for snapshot M1 (%s)", (_name, entries) => {
        const result = selectCompletion(entries, { companyId: COMPANY, snapshotId: "snap-m1" });
        expect(result.kind).toBe("selected");
        if (result.kind !== "selected") return;
        expect(result.entry.name).toBe(M1.name);
        expect(result.entry.completion).toEqual(M1.value);
        expect(result.entry.sequence).toBe(1);
        expect(result.quarantined).toEqual([]);
    });

    it.each([
        ["M1 listed first", [asEntry(M1), asEntry(M2)]],
        ["M1 listed last", [asEntry(M2), asEntry(M1)]],
    ])("latest picks the maximum sequence, M2, whatever the listing order (%s)", (_name, entries) => {
        const result = selectCompletion(entries, { companyId: COMPANY, latest: true });
        expect(result.kind === "selected" && result.entry.name).toBe(M2.name);
    });

    it("has no input that depends on time: a clock running backwards changes nothing", () => {
        // M2 was written first according to any file time; selection sees only names and content.
        const forward = selectCompletion([asEntry(M1), asEntry(M2)], { companyId: COMPANY, latest: true });
        const backward = selectCompletion([asEntry(M2), asEntry(M1)], { companyId: COMPANY, latest: true });
        expect(forward).toEqual(backward);
        expect(Object.keys(asEntry(M1))).toEqual(["name", "content"]);
    });

    it("quarantines a stray latest.json-like entry and still selects the real latest", () => {
        const stray: CompletionFileEntry = { name: "latest.json", content: M1.value };
        const result = selectCompletion([stray, asEntry(M1), asEntry(M2)], { companyId: COMPANY, latest: true });
        expect(result.kind === "selected" && result.entry.name).toBe(M2.name);
        expect(result.quarantined).toEqual([{ name: "latest.json", reason: "name-invalid" }]);
    });

    it("quarantines a file whose name does not match its content, so it cannot win as latest", () => {
        const liar: CompletionFileEntry = { name: M2.name.replace(/^000000000002/, "000000000009"), content: M2.value };
        const wrongDigest: CompletionFileEntry = { name: `000000000003-${sha("nope")}.json`, content: { ...M2.value, sequence: 3 } };
        const garbage: CompletionFileEntry = { name: `000000000004-${sha("junk")}.json`, content: { hello: "world" } };
        const result = selectCompletion([asEntry(M1), liar, wrongDigest, garbage], { companyId: COMPANY, latest: true });
        expect(result.kind === "selected" && result.entry.name).toBe(M1.name);
        expect(result.quarantined).toEqual([
            { name: liar.name, reason: "sequence-mismatch" },
            { name: wrongDigest.name, reason: "digest-mismatch" },
            { name: garbage.name, reason: "content-invalid" },
        ]);
    });

    it("reports a conflict, and selects nothing, when one sequence has two digests", () => {
        const other = completion(2, "snap-other");
        const result = selectCompletion([asEntry(M1), asEntry(M2), asEntry(other)], { companyId: COMPANY, latest: true });
        expect(result.kind).toBe("conflict");
        if (result.kind !== "conflict") return;
        expect(result.names).toEqual([M2.name, other.name].sort());
        expect(result.quarantined.filter((entry) => entry.reason === "conflict").map((entry) => entry.name).sort()).toEqual(result.names);
    });

    it("reports a conflict when two different completions claim the same snapshot", () => {
        const again = completion(5, "snap-m2");
        const result = selectCompletion([asEntry(M1), asEntry(M2), asEntry(again)], { companyId: COMPANY, snapshotId: "snap-m2" });
        expect(result.kind).toBe("conflict");
        expect(result.kind === "conflict" && result.names).toEqual([M2.name, again.name].sort());
    });

    it("returns none for an unknown snapshot, for no files, and for only invalid files", () => {
        expect(selectCompletion([asEntry(M1)], { companyId: COMPANY, snapshotId: "snap-zzz" }).kind).toBe("none");
        expect(selectCompletion([], { companyId: COMPANY, latest: true })).toEqual({ kind: "none", quarantined: [] });
        const only = selectCompletion([{ name: "latest.json", content: M1.value }], { companyId: COMPANY, latest: true });
        expect(only).toEqual({ kind: "none", quarantined: [{ name: "latest.json", reason: "name-invalid" }] });
    });

    it("treats a repeated file name as one file", () => {
        const result = selectCompletion([asEntry(M2), asEntry(M2)], { companyId: COMPANY, latest: true });
        expect(result.kind).toBe("selected");
    });

    it("does not select a snapshot completion from an invalid file", () => {
        const liar: CompletionFileEntry = { name: M1.name.replace(/^000000000001/, "000000000007"), content: M1.value };
        expect(selectCompletion([liar], { companyId: COMPANY, snapshotId: "snap-m1" })).toEqual({
            kind: "none", quarantined: [{ name: liar.name, reason: "sequence-mismatch" }],
        });
    });

    it("quarantines a completion of another company, for latest and for a snapshot query", () => {
        const foreign = completion(9, "snap-foreign", { companyId: "company-2" });
        const latest = selectCompletion([asEntry(M1), asEntry(foreign)], { companyId: COMPANY, latest: true });
        expect(latest.kind === "selected" && latest.entry.name).toBe(M1.name);
        expect(latest.quarantined).toEqual([{ name: foreign.name, reason: "company-mismatch" }]);
        const bySnapshot = selectCompletion([asEntry(foreign)], { companyId: COMPANY, snapshotId: "snap-foreign" });
        expect(bySnapshot).toEqual({ kind: "none", quarantined: [{ name: foreign.name, reason: "company-mismatch" }] });
        const theirs = selectCompletion([asEntry(M1), asEntry(foreign)], { companyId: "company-2", latest: true });
        expect(theirs.kind === "selected" && theirs.entry.name).toBe(foreign.name);
    });

    it("does not let another company's completion cause a conflict", () => {
        const foreign = completion(2, "snap-m2", { companyId: "company-2" });
        const result = selectCompletion([asEntry(M2), asEntry(foreign)], { companyId: COMPANY, snapshotId: "snap-m2" });
        expect(result.kind === "selected" && result.entry.name).toBe(M2.name);
    });

    it("selects the maximum sequence when it is not the first or last listed", () => {
        const m3 = completion(3, "snap-m3");
        const m10 = completion(10, "snap-m10");
        const result = selectCompletion([asEntry(m3), asEntry(m10), asEntry(M1), asEntry(M2)], { companyId: COMPANY, latest: true });
        expect(result.kind === "selected" && result.entry.sequence).toBe(10);
    });
});
