import { Prisma } from "@prisma/client";
import {
    AuthorityConflictError, AuthorityPatch, AuthorityPhase, assertAuthorityPointerWrite,
    compareAndSetAuthority, lockAuthorityScope, reserveAuthority, discoverAuthorityClientIds, assertNoUnresolvedAuthorityForDocuments,
} from "./eformsign-contract-authority";

const B = "11111111-1111-4111-8111-111111111111", FB = "22222222-2222-4222-8222-222222222222";
const G = "33333333-3333-4333-8333-333333333333", FG = "44444444-4444-4444-8444-444444444444";
const J = "55555555-5555-4555-8555-555555555555", FJ = "66666666-6666-4666-8666-666666666666";
const U = "77777777-7777-4777-8777-777777777777", F = "a".repeat(64);
const client = { id: 2, e_doc_id: "prior-doc" as string | null };
const job = { id: J, branch_id: B, client_id: 2, contract_generation: G, payload_fingerprint: F, job_type: "create_document" };
const authority = (phase: AuthorityPhase = "reserved") => ({
    branch_id: B, client_id: 2, generation: G, creation_job_id: J, fingerprint: F,
    prior_document_id: "prior-doc", provider_document_id: "bound-doc", phase, claim_epoch: 42n,
    creation_intent_id: null, draft_intent_id: null, human_intent_id: ["human_exposed", "verified"].includes(phase) ? J : null,
    claim_user_id: ["human_exposed", "verified"].includes(phase) ? U : null,
    claim_expires_at: ["human_exposed", "verified"].includes(phase) ? new Date("2026-11-05T00:10:00.000Z") : null,
});
const expected = { branchId: B, clientId: 2, generation: G, creationJobId: J, phase: "reserved" as const, claimEpoch: 42n };
const reservation = { branchId: B, clientId: 2, jobId: J, generation: G, fingerprint: F, priorDocumentId: "prior-doc" as string | null };
function harness(...responses: unknown[]) {
    const trace: Array<{ text: string; values: unknown[] }> = [];
    const record = jest.fn((sql: Prisma.Sql) => {
        trace.push({ text: sql.text, values: sql.values });
        if (!responses.length) throw new Error("Unqueued query");
        return Promise.resolve(responses.shift());
    });
    const tx = { $queryRaw: record, $executeRaw: record } as unknown as Prisma.TransactionClient;
    return { tx, trace, writes: () => trace.filter(q => /\b(INSERT|UPDATE|DELETE)\s+(INTO\s+)?eformsign_contract_authority\b/.test(q.text)) };
}
const scope = { branchId: B, clientIds: [2] };
describe("eformsign contract authority primitives (SQL mock, no concurrency proof)", () => {
    it("discovery returns sorted branch-only IDs and binds document values", async () => {
        const h = harness([{ client_id: 8 }, { client_id: 2 }, { client_id: 8 }], [{ conflict: false }]);
        await expect(discoverAuthorityClientIds(h.tx, B, ["bound-doc"])).resolves.toEqual([2, 8]);
        expect(h.trace[0]!.values).toEqual([B, "bound-doc"]); expect(h.trace[1]!.text).toContain("SELECT EXISTS");
    });
    it("discovery rejects foreign ownership without projecting it", async () => {
        const h = harness([], [{ conflict: true }]);
        await expect(discoverAuthorityClientIds(h.tx, B, ["bound-doc"])).rejects.toThrow(/^Authority conflict$/);
    });
    it.each([false, true])("privileged unresolved-document fence uses only a boolean, conflict=%s", async conflict => {
        const h = harness([{ conflict }]), result = assertNoUnresolvedAuthorityForDocuments(h.tx, ["bound-doc"]);
        if (conflict) await expect(result).rejects.toBeInstanceOf(AuthorityConflictError); else await expect(result).resolves.toBeUndefined();
        expect(h.trace[0]!.text).toContain("SELECT EXISTS"); expect(h.trace[0]!.text).toContain("phase <> 'closed'");
        expect(h.trace[0]!.values).toEqual(["bound-doc"]);
    });
    it("authority conflicts expose only the fixed safe HTTP 409 code", () => {
        const error = new AuthorityConflictError(); expect(error.getStatus()).toBe(409);
        expect(error.getResponse()).toEqual({ code: "REQUEST_CONFLICT" }); expect(error.message).toBe("Authority conflict");
    });
    it("T01 locks unique ascending clients before authorities; absent authority returns []", async () => {
        const h = harness([client, { id: 8, e_doc_id: null }], []);
        await expect(lockAuthorityScope(h.tx, B, [8, 2, 8])).resolves.toEqual([]);
        expect(h.trace[0]!.text.replace(/\s+/g, " ").trim()).toBe(
            "SELECT id, e_doc_id FROM client WHERE branch_id = $1::uuid AND id IN ($2,$3) ORDER BY id FOR UPDATE",
        );
        expect(h.trace[0]!.values).toEqual([B, 2, 8]);
        expect(h.trace[1]!.text.replace(/\s+/g, " ").trim()).toMatch(
            /FROM eformsign_contract_authority WHERE branch_id = \$1::uuid AND client_id IN \(\$2,\$3\) ORDER BY client_id FOR UPDATE$/,
        );
        expect(h.trace[1]!.values).toEqual([B, 2, 8]);
        expect(h.writes()).toHaveLength(0);
    });
    it.each([0, -1, 1.5])("T02 rejects invalid client IDs %j before querying", async id => {
        const h = harness(); await expect(lockAuthorityScope(h.tx, B, [id])).rejects.toThrow(); expect(h.trace).toHaveLength(0);
    });
    it("T02 rejects invalid branch UUID before querying", async () => {
        const h = harness(); await expect(lockAuthorityScope(h.tx, "invalid", [2])).rejects.toThrow(); expect(h.trace).toHaveLength(0);
    });
    it.each([undefined, "closed"] as const)("T03/T04 allows absent or closed authority: %s", async phase => {
        const h = harness([client], phase ? [authority(phase)] : []);
        await expect(assertAuthorityPointerWrite(h.tx, { ...scope, documentIds: [] })).resolves.toBeUndefined();
        expect(h.writes()).toHaveLength(0);
    });
    it("T05 requires a generation permit for active authority", async () => {
        const h = harness([client], [authority()]);
        await expect(assertAuthorityPointerWrite(h.tx, scope)).rejects.toBeInstanceOf(AuthorityConflictError);
    });
    it.each(["reserved", "creation_pending", "document_ready"] as const)("T06 allows exact generation at %s", async phase => {
        const h = harness([client], [authority(phase)]);
        await expect(assertAuthorityPointerWrite(h.tx, { ...scope, generation: G })).resolves.toBeUndefined();
    });
    it.each(["creation_uncertain", "human_exposed", "verified", "blocked"] as const)("T07 rejects even exact generation at %s", async phase => {
        const h = harness([client], [authority(phase)]);
        await expect(assertAuthorityPointerWrite(h.tx, { ...scope, generation: G })).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(h.writes()).toHaveLength(0);
    });
    it("T08 rejects a foreign generation", async () => {
        const h = harness([client], [authority()]);
        await expect(assertAuthorityPointerWrite(h.tx, { ...scope, generation: FG })).rejects.toBeInstanceOf(AuthorityConflictError);
    });
    it("T09 rejects a discovered owner missing from the input before any locks or writes", async () => {
        const h = harness([{ client_id: 8 }], [{ conflict: false }]);
        await expect(assertAuthorityPointerWrite(h.tx, { ...scope, documentIds: ["bound-doc"] })).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(h.trace.some(q => /FOR UPDATE/.test(q.text))).toBe(false); expect(h.writes()).toHaveLength(0);
    });
    it("T09 included owner is locked in the same ascending set and rejects an unpermitted write", async () => {
        const h = harness([{ client_id: 8 }], [{ conflict: false }], [client, { id: 8, e_doc_id: null }],
            [{ ...authority(), client_id: 8 }], [{ document_id: "bound-doc" }], [{ client_id: 8 }], [{ conflict: false }]);
        await expect(assertAuthorityPointerWrite(h.tx, { ...scope, clientIds: [8, 2], documentIds: ["bound-doc"] })).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(h.trace[2]!.values).toEqual([B, 2, 8]); expect(h.writes()).toHaveLength(0);
    });
    it("T10 rejects foreign-branch provider collisions without projecting foreign rows", async () => {
        const h = harness([], [{ conflict: true }]);
        await expect(assertAuthorityPointerWrite(h.tx, { ...scope, documentIds: ["bound-doc"] })).rejects.toThrow(/^Authority conflict$/);
        expect(h.trace[1]!.text).toMatch(/SELECT EXISTS/); expect(h.writes()).toHaveLength(0);
    });
    it("T09 rediscovery refuses a new omitted owner without acquiring a late lock", async () => {
        const h = harness([], [{ conflict: false }], [client], [], [{ document_id: "bound-doc" }], [{ client_id: 8 }], [{ conflict: false }]);
        await expect(assertAuthorityPointerWrite(h.tx, { ...scope, documentIds: ["bound-doc"] })).rejects.toBeInstanceOf(AuthorityConflictError);
        expect(h.trace.filter(q => /FROM client[\s\S]*FOR UPDATE/.test(q.text))).toHaveLength(1);
        expect(h.trace[2]!.values).toEqual([B, 2]); expect(h.writes()).toHaveLength(0);
    });
    it("T11 binds all expected CAS identity fields and returns true only for one affected row", async () => {
        const h = harness(1);
        await expect(compareAndSetAuthority(h.tx, expected, { phase: "creation_pending" })).resolves.toBe(true);
        expect(h.trace[0]!.text.replace(/\s+/g, " ").trim()).toBe(
            "UPDATE eformsign_contract_authority SET phase = $1, updated_at = CURRENT_TIMESTAMP "
            + "WHERE branch_id = $2::uuid AND client_id = $3 AND generation = $4::uuid AND creation_job_id = $5::uuid "
            + "AND phase = $6 AND claim_epoch = $7::bigint",
        );
        expect(h.trace[0]!.values).toEqual(["creation_pending", B, 2, G, J, "reserved", 42n]);
    });
    it.each([{}, { phase: "closed" }, { generation: FG }, { creationJobId: FJ }, { branchId: FB }] as const)("T12 stale CAS returns false: %j", async delta => {
        const stale = { ...expected, ...delta }, h = harness(0);
        await expect(compareAndSetAuthority(h.tx, stale, { phase: "creation_pending" })).resolves.toBe(false);
        expect(h.trace[0]!.text.replace(/\s+/g, " ").trim()).toMatch(
            /WHERE branch_id = \$2::uuid AND client_id = \$3 AND generation = \$4::uuid AND creation_job_id = \$5::uuid AND phase = \$6 AND claim_epoch = \$7::bigint$/,
        );
        expect(h.trace[0]!.values).toEqual(["creation_pending", stale.branchId, stale.clientId, stale.generation, stale.creationJobId, stale.phase, stale.claimEpoch]);
    });
    it.each([U, null])("T11 optional expected claimant is bound with NULL-safe equality: %s", async claimUserId => {
        const h = harness(1);
        await expect(compareAndSetAuthority(h.tx, { ...expected, claimUserId }, { claimEpoch: 43n })).resolves.toBe(true);
        expect(h.trace[0]!.text).toMatch(/claim_user_id IS NOT DISTINCT FROM/); expect(h.trace[0]!.values).toContain(claimUserId);
    });
    it("T11/T19 allowed patch values and all nullable references remain bound", async () => {
        const id = "quoted ' document; --", expires = new Date("2026-11-05T00:10:00.000Z"), h = harness(1);
        await compareAndSetAuthority(h.tx, expected, { providerDocumentId: id, creationIntentId: J, draftIntentId: null,
            humanIntentId: null, claimUserId: U, claimExpiresAt: expires, claimEpoch: 43n });
        expect(h.trace[0]!.values).toEqual(expect.arrayContaining([id, J, null, U, expires, 43n])); expect(h.trace[0]!.text).not.toContain(id);
    });
    it.each(["branchId", "clientId", "generation", "creationJobId", "fingerprint", "priorDocumentId", "unknownKey"])("T13 rejects runtime patch key %s before queries", async key => {
        const h = harness(); await expect(compareAndSetAuthority(h.tx, expected, { [key]: B } as AuthorityPatch)).rejects.toThrow(); expect(h.trace).toHaveLength(0);
    });
    it("T13 excludes scope and immutable keys from the patch type", () => {
        type Forbidden = Extract<keyof AuthorityPatch, "branchId" | "clientId" | "generation" | "creationJobId" | "fingerprint" | "priorDocumentId" | "unknownKey">;
        const noForbiddenKeys: [Forbidden] extends [never] ? true : false = true; expect(noForbiddenKeys).toBe(true);
    });
    it("T14 inserts reserved authority after validating durable job and preserves the prior pointer", async () => {
        const h = harness([client], [], [job], [authority()]);
        const result = await reserveAuthority(h.tx, reservation);
        expect(result).toMatchObject({ phase: "reserved", generation: G, creationJobId: J, fingerprint: F, priorDocumentId: "prior-doc" });
        expect(h.writes()).toHaveLength(1); expect(h.trace[3]!.text).toMatch(/INSERT INTO/);
        expect(h.trace[3]!.text.replace(/\s+/g, " ").trim()).toMatch(
            /^INSERT INTO eformsign_contract_authority \(branch_id, client_id, generation, creation_job_id, fingerprint, prior_document_id, phase\) VALUES \(\$1::uuid, \$2, \$3::uuid, \$4::uuid, \$5, \$6, 'reserved'\) RETURNING /,
        );
        expect(h.trace[3]!.values).toEqual([B, 2, G, J, F, "prior-doc"]);
    });
    it("T14 identical operation is idempotent with no second insert", async () => {
        const h = harness([client], [authority()], [job]);
        await expect(reserveAuthority(h.tx, reservation)).resolves.toMatchObject({ generation: G }); expect(h.writes()).toHaveLength(0);
    });
    it("T15 rotates only closed authority after durable-job verification, without mutating old jobs", async () => {
        const h = harness([client], [{ ...authority("closed"), generation: FG, creation_job_id: FJ }], [job], [authority()]);
        await reserveAuthority(h.tx, reservation); expect(h.writes()).toHaveLength(1);
        expect(h.trace[2]!.text).toMatch(/FROM eformsign_document_job/); expect(h.trace[3]!.text).toMatch(/UPDATE eformsign_contract_authority/);
        expect(h.trace.some(q => /(?:UPDATE|DELETE FROM) eformsign_document_job/.test(q.text))).toBe(false);
    });
    it.each(["creation_pending", "creation_uncertain", "document_ready", "human_exposed", "verified", "blocked"] as const)("T16 rejects different operations at %s", async phase => {
        const h = harness([client], [{ ...authority(phase), generation: FG, creation_job_id: FJ }], [job]);
        await expect(reserveAuthority(h.tx, reservation)).rejects.toBeInstanceOf(AuthorityConflictError); expect(h.writes()).toHaveLength(0);
    });
    it("T16 same job/generation with different fingerprint conflicts", async () => {
        const h = harness([client], [{ ...authority(), fingerprint: "b".repeat(64) }], [job]);
        await expect(reserveAuthority(h.tx, reservation)).rejects.toBeInstanceOf(AuthorityConflictError); expect(h.writes()).toHaveLength(0);
    });
    it.each([{ contract_generation: null }, { contract_generation: FG }, { branch_id: FB }, { client_id: 8 },
        { payload_fingerprint: "b".repeat(64) }, { job_type: "finalize_document" }])("T17 rejects mismatched or legacy durable job %j", async delta => {
        const h = harness([client], [], [{ ...job, ...delta }]);
        await expect(reserveAuthority(h.tx, reservation)).rejects.toBeInstanceOf(AuthorityConflictError); expect(h.writes()).toHaveLength(0);
    });
    it("T18 allows exact NULL prior pointer", async () => {
        const h = harness([{ ...client, e_doc_id: null }], [], [job], [{ ...authority(), prior_document_id: null }]);
        await expect(reserveAuthority(h.tx, { ...reservation, priorDocumentId: null })).resolves.toMatchObject({ priorDocumentId: null });
    });
    it.each([["prior-doc", null], [null, "prior-doc"]])("T18 rejects prior pointer mismatch %s / %s", async (stored, prior) => {
        const h = harness([{ ...client, e_doc_id: stored }], [], [job]);
        await expect(reserveAuthority(h.tx, { ...reservation, priorDocumentId: prior })).rejects.toBeInstanceOf(AuthorityConflictError); expect(h.writes()).toHaveLength(0);
    });
    it("T19 document IDs containing SQL syntax remain bound values", async () => {
        const documentId = "x'); DELETE FROM client; --", h = harness([], [{ conflict: false }], [client], [], [{ document_id: "x'); DELETE FROM client; --" }], [], [{ conflict: false }]);
        await assertAuthorityPointerWrite(h.tx, { ...scope, documentIds: [documentId] });
        for (const q of h.trace.filter(q => q.values.includes(documentId))) expect(q.text).not.toContain(documentId);
        expect(h.trace.filter(q => q.values.includes(documentId))).toHaveLength(5); expect(h.writes()).toHaveLength(0);
    });
    it("T20 preserves BigInt epochs, exact claim IDs/dates and NULLs", async () => {
        const h = harness([client], [authority()]);
        const state = (await lockAuthorityScope(h.tx, B, [2]))[0]!;
        expect(state.claimEpoch).toBe(42n); expect(state.claimUserId).toBeNull(); expect(state.claimExpiresAt).toBeNull();
        expect(state.creationIntentId).toBeNull(); expect(state.draftIntentId).toBeNull(); expect(state.humanIntentId).toBeNull();
        const claimed = harness([client], [authority("human_exposed")]);
        expect((await lockAuthorityScope(claimed.tx, B, [2]))[0]).toMatchObject({ claimUserId: U, claimExpiresAt: new Date("2026-11-05T00:10:00.000Z"), claimEpoch: 42n });
    });
});
it.each(["missing-parent", "owner-after-parent", "no-authority"])("shared parent lifecycle lock and final rediscovery: %s", async mode => {
    let parentLocked = false;
    const query = jest.fn(async (sql: Prisma.Sql) => {
        if (/FROM eformsign_doc[\s\S]*FOR UPDATE/.test(sql.text)) { parentLocked = true; return mode === "missing-parent" ? [] : [{ document_id: "bound-doc" }]; }
        if (sql.text.includes("SELECT EXISTS")) return [{ conflict: false }];
        if (sql.text.includes("provider_document_id IN")) return parentLocked && mode === "owner-after-parent" ? [{ client_id: 8 }] : [];
        if (sql.text.includes("FROM client")) return [client];
        return [];
    });
    const result = assertAuthorityPointerWrite({ $queryRaw: query } as never, { ...scope, documentIds: ["bound-doc"] });
    if (mode === "no-authority") await expect(result).resolves.toBeUndefined(); else await expect(result).rejects.toBeInstanceOf(AuthorityConflictError);
    expect(parentLocked).toBe(true); const trace = query.mock.calls.map(([sql]) => sql.text);
    expect(trace.findIndex(text => text.includes("FROM client"))).toBeLessThan(trace.findIndex(text => text.includes("FROM eformsign_doc")));
    expect(trace.filter(text => /FROM client[\s\S]*FOR UPDATE/.test(text))).toHaveLength(1);
});
