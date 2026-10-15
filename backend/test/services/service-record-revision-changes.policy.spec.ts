import { buildServiceRecordRevisionChanges } from "application/policies/service-record-revision-changes.policy";
import { serviceRecordSignatureFingerprint } from "application/utils/service-record-signature-fingerprint";
import type { ServiceRecordEditJsonValue as Json } from "domain/repositories/service-record-edit.repository.interface";

const signature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const row = { sessionIndex: 1, serviceDate: "2026-10-16", answers: { a: ["yes"] }, notes: null, etcService: null, paymentConfirmed: false, employeeId: 7, employeeNameSnapshot: "A" };
const revision = (before: Json | null, after: Json = {}, plannedSessions: Json = []) => buildServiceRecordRevisionChanges({
    id: "revision", revisionNumber: 2, confirmedAt: new Date("2026-10-16T00:00:00Z"), formVersionAtConfirm: 3,
    beforeSnapshot: before, payload: after, plannedSessions,
});

describe("service-record revision changes", () => {
    it("reports period and header differences in deterministic order, in both directions", () => {
        const a = { startDate: "2026-10-16", endDate: "2026-10-17", header: { momName: "A", babyWeight: "3" } };
        const b = { startDate: "2026-10-17", endDate: "2026-10-18", header: { momName: "B", babyWeight: "3" } };
        const changes = revision(a, b).basicInfo;
        expect(changes).toEqual([
            { path: "period.startDate", before: a.startDate, after: b.startDate },
            { path: "period.endDate", before: a.endDate, after: b.endDate },
            { path: "header.momName", before: "A", after: "B" },
        ]);
        expect(revision(b, a).basicInfo).toEqual(changes.map(({ path, before, after }) => ({ path, before: after, after: before })));
        expect(revision(a, a).basicInfo).toEqual([]);
    });

    it("compares the union of answer keys and stable JSON, not object insertion order", () => {
        const before = { sessions: [{ ...row, answers: { a: ["yes"], removed: 1, obj: { b: 2, a: 1 } } }] };
        const after = { sessions: [{ ...row, answers: { a: ["no"], added: true, obj: { a: 1, b: 3 } } }] };
        expect(revision(before, after).sessions[0]?.changes).toEqual([
            { path: "session.answers.a", before: ["yes"], after: ["no"] },
            { path: "session.answers.added", before: null, after: true },
            { path: "session.answers.obj", before: '{"a":1,"b":2}', after: '{"a":1,"b":3}' },
            { path: "session.answers.removed", before: 1, after: null },
        ]);
        expect(revision({ sessions: [{ ...row, answers: { b: 2, a: 1 } }] }, { sessions: [{ ...row, answers: { a: 1, b: 2 } }] }).sessions).toEqual([]);
        expect(revision(after, before).sessions[0]?.changes).toEqual(revision(before, after).sessions[0]?.changes.map(({ path, before, after }) => ({ path, before: after, after: before })));
    });

    it.each(["added", "removed"] as const)("reports %s content rows against null, not planned-entry existence", (kind) => {
        const present = { sessions: [row], plannedSessions: [{ sessionIndex: 1, serviceDate: row.serviceDate }] };
        const empty = { sessions: [], plannedSessions: present.plannedSessions };
        const result = kind === "added" ? revision(empty, present, present.plannedSessions) : revision(present, empty, present.plannedSessions);
        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0]?.kind).toBe(kind);
        expect(result.sessions[0]?.changes).toContainEqual({ path: "session.answers.a", before: kind === "added" ? null : ["yes"], after: kind === "added" ? ["yes"] : null });
        expect(result.sessions[0]?.changes.some((change) => change.path === "session.notes")).toBe(false);
    });

    it("includes planned-only moves, unions all indices, sorts ascending and omits unchanged sessions", () => {
        const before = { sessions: [row], plannedSessions: [{ sessionIndex: 3, serviceDate: "2026-10-17" }, { sessionIndex: 2, serviceDate: "2026-10-16" }] };
        const plans = [{ sessionIndex: 2, serviceDate: "2026-10-17" }, { sessionIndex: 3, serviceDate: "2026-10-18" }];
        const result = revision(before, { sessions: [row] }, plans);
        expect(result.sessions.map((session) => session.sessionIndex)).toEqual([2, 3]);
        expect(result.sessions[0]).toEqual({ sessionIndex: 2, kind: "changed", serviceDateBefore: "2026-10-16", serviceDateAfter: "2026-10-17", changes: [{ path: "session.serviceDate", before: "2026-10-16", after: "2026-10-17" }] });
        expect(revision({ sessions: [row], plannedSessions: plans }, { sessions: [row] }, before.plannedSessions).sessions[0]?.changes).toEqual([{ path: "session.serviceDate", before: "2026-10-17", after: "2026-10-16" }]);
        expect(revision({ plannedSessions: plans }, {}, plans).sessions).toEqual([]);
    });

    it.each([
        [null, signature, "absent", "present"],
        [signature, `${signature}NEW`, "present", "replaced"],
        [signature, null, "present", "absent"],
    ])("projects signature transitions without image data", (oldValue, newValue, before, after) => {
        const result = revision({ sessions: [{ ...row, clientSignatureFingerprint: serviceRecordSignatureFingerprint(oldValue) }] }, { sessions: [{ ...row, clientSignature: newValue }] });
        expect(result.sessions[0]?.changes).toEqual([{ path: "session.clientSignature", before, after }]);
        expect(JSON.stringify(result)).not.toContain("data:");
        expect(JSON.stringify(result)).not.toContain("iVBOR");
    });

    it("hashes exact UTF-8 signature strings and omits unchanged or unsigned signatures", () => {
        expect(serviceRecordSignatureFingerprint("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        expect(serviceRecordSignatureFingerprint("")).toBeNull();
        for (const value of [null, signature]) {
            expect(revision({ sessions: [{ ...row, clientSignatureFingerprint: serviceRecordSignatureFingerprint(value) }] }, { sessions: [{ ...row, clientSignature: value }] }).sessions).toEqual([]);
        }
    });

    it("compares employee IDs even when names match and ignores name-only changes", () => {
        expect(revision({ sessions: [row] }, { sessions: [{ ...row, employeeId: 8 }] }).sessions[0]?.changes).toEqual([{ path: "session.employee", before: "A", after: "A" }]);
        expect(revision({ sessions: [row] }, { sessions: [{ ...row, employeeNameSnapshot: "renamed" }] }).sessions).toEqual([]);
    });

    it("compares every remaining row field both ways, preferring row dates over planned dates", () => {
        const next = { ...row, serviceDate: "2026-10-18", etcService: "care", notes: "note", paymentConfirmed: true, employeeId: 8, employeeNameSnapshot: "B" };
        const plans = [{ sessionIndex: 1, serviceDate: "2026-10-20" }];
        const result = revision({ sessions: [row], plannedSessions: plans }, { sessions: [next] }, plans);
        const changes = [
            { path: "session.serviceDate", before: "2026-10-16", after: "2026-10-18" },
            { path: "session.etcService", before: null, after: "care" },
            { path: "session.notes", before: null, after: "note" },
            { path: "session.paymentConfirmed", before: false, after: true },
            { path: "session.employee", before: "A", after: "B" },
        ];
        expect(result.sessions[0]).toMatchObject({ serviceDateBefore: row.serviceDate, serviceDateAfter: next.serviceDate, changes });
        expect(revision({ sessions: [next] }, { sessions: [row] }).sessions[0]?.changes).toEqual(changes.map(({ path, before, after }) => ({ path, before: after, after: before })));
        expect(revision({ sessions: [next] }, { sessions: [next] }).sessions).toEqual([]);
    });

    it("normalizes mixed arrays and objects to stable JSON strings while preserving primitive values", () => {
        expect(revision({ sessions: [{ ...row, answers: {} }] }, { sessions: [{ ...row, answers: { mixed: [1, "two", { z: false, a: null }], num: 2, text: "yes", nothing: null } }] }).sessions[0]?.changes).toEqual([
            { path: "session.answers.mixed", before: null, after: '[1,"two",{"a":null,"z":false}]' },
            { path: "session.answers.num", before: null, after: 2 },
            { path: "session.answers.text", before: null, after: "yes" },
        ]);
    });

    it("projects only approved fields, never signature images, even if embedded in answers", () => {
        const result = revision({ sessions: [row] }, { header: { momName: signature }, sessions: [{ ...row, answers: { a: { image: signature } }, clientSignature: signature, private: "secret" }] });
        expect(JSON.stringify(result)).not.toMatch(/data:|iVBOR|secret/);
    });

    it("marks legacy null snapshots unavailable rather than diffing against empty content", () => {
        expect(revision(null, { sessions: [row] })).toMatchObject({ beforeAvailable: false, basicInfo: [], sessions: [] });
        expect(revision({}, {})).toMatchObject({ beforeAvailable: true, basicInfo: [], sessions: [] });
    });
});
