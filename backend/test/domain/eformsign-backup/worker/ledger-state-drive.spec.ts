import {
    WorkerError, applyLedgerRecord, applyLedgerRecords, assertVerifiedReusable, destinationKey, driveDestinationIdentity,
    driveDestinationRevision, driveStateKey, emptyLedgerState, ledgerStateFromJson, ledgerStateToJson, transitionDestination,
    type LedgerBodies, type LedgerRecord, type LedgerRecordType, type LedgerState,
} from "domain/eformsign-backup/worker";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";

const hex = (char: string) => char.repeat(64);
const ART1 = hex("1");
const BIND_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIND_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOT_A = "rootFolderAaaaa01";
const ROOT_B = "rootFolderBbbbb02";
const ID_A = driveDestinationIdentity(ROOT_A);
const ID_B = driveDestinationIdentity(ROOT_B);
const REV_A = driveDestinationRevision(BIND_A);
const REV_B = driveDestinationRevision(BIND_B);
const FILE_1 = "driveFile_000000001";
const FILE_2 = "driveFile_000000002";
const FILE_3 = "driveFile_000000003";
const PARENT = "parentFolder_000001";
const NODE = "eformsign/company-1";
const REC_KEY = "eformsign/company-1/D001/manifests/" + hex("c") + ".json";
const ART_KEY = `eformsign/company-1/D001/artifacts/document/${hex("a")}.pdf`;
const clock = (n: number) => `2026-11-02T00:00:${String(n % 60).padStart(2, "0")}.000Z`;

let nextSeq = 1;
function rec<T extends LedgerRecordType>(type: T, body: LedgerBodies[T], seq = nextSeq++): LedgerRecord {
    return { v: 1, seq, type, at: clock(seq), body } as LedgerRecord;
}
const installed = () => rec("installed", {
    installationId: "inst-1", archiveId: "arch-1", archiveDev: 1, archiveIno: 2,
    destinationIdentity: "local:arch-1", destinationRevision: "local-layout-v1",
});
const boundBody = (root = ROOT_A, bind = BIND_A): LedgerBodies["drive_bound"] => ({
    destinationIdentity: driveDestinationIdentity(root), destinationRevision: driveDestinationRevision(bind), bindingId: bind,
    rootFolderId: root, rootName: "bjj-eformsign-backup", rootParentId: "myDriveRoot0001", accountId: "permission-1",
});
const driveBound = (root = ROOT_A, bind = BIND_A) => rec("drive_bound", boundBody(root, bind));
const driveReady = (revision = REV_A) => rec("drive_ready", { destinationRevision: revision });
const reserve = (fileId: string, kind: "folder" | "file" = "folder", nodeKey = NODE, revision = REV_A) =>
    rec("drive_node_reserved", { destinationRevision: revision, kind, nodeKey, fileId, parentFileId: PARENT });
const created = (fileId: string, nodeKey = NODE, revision = REV_A) =>
    rec("drive_node_created", { destinationRevision: revision, nodeKey, fileId });
const published = (sha: string, fileId = FILE_1, relativeKey = REC_KEY, revision = REV_A) =>
    rec("drive_record_published", { destinationRevision: revision, relativeKey, sha256: sha, fileId });
const pending = (sha: string, relativeKey = REC_KEY, revision = REV_A) =>
    rec("drive_record_pending", { destinationRevision: revision, relativeKey, sha256: sha });
const driveTransition = (
    to: LedgerBodies["destination_transition"]["to"], from: LedgerBodies["destination_transition"]["from"],
    identity = ID_A, revision = REV_A, extra: Partial<LedgerBodies["destination_transition"]> = {},
) => rec("destination_transition", {
    artifactIdentity: ART1, destinationIdentity: identity, destinationRevision: revision, from, to, reasonCode: null,
    attempts: 0, nextRetryAt: null, relativeKey: null, ...extra,
});
const driveVerifiedPath = (identity = ID_A, revision = REV_A) => [
    driveTransition("pending", null, identity, revision), driveTransition("transferring", "pending", identity, revision),
    driveTransition("verifying", "transferring", identity, revision),
    driveTransition("verified", "verifying", identity, revision, { relativeKey: ART_KEY }),
];

function build(make: () => LedgerRecord[]): LedgerState {
    nextSeq = 1;
    return applyLedgerRecords(emptyLedgerState(), make());
}
function reasonOf(fn: () => unknown): string | null {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof WorkerError ? error.reasonCode : `other:${String(error)}`;
    }
}
const withBinding = () => build(() => [installed(), driveBound()]);
const ready = () => build(() => [installed(), driveBound(), driveReady()]);
const canon = (state: LedgerState) => canonicalJson(ledgerStateToJson(state));

describe("Drive binding (BJJ-456 U1)", () => {
    beforeEach(() => { nextSeq = 1; });

    it("starts without a Drive binding and with empty Drive state", () => {
        const state = build(() => [installed()]);
        expect(state.installation?.drive).toBeNull();
        expect(state.driveNodes.size).toBe(0);
        expect(state.driveRecords.size).toBe(0);
        expect(state.driveRecordsPending.size).toBe(0);
    });

    it("requires an installation: drive_bound cannot be the first record", () => {
        nextSeq = 1;
        expect(reasonOf(() => applyLedgerRecord(emptyLedgerState(), driveBound()))).toBe("ledger-first-record");
    });

    it("binds as pending and becomes ready only through drive_ready", () => {
        const bound = withBinding();
        expect(bound.installation?.drive).toEqual({ ...boundBody(), status: "pending" });
        nextSeq = 3;
        const done = applyLedgerRecord(bound, driveReady());
        expect(done.installation?.drive).toEqual({ ...boundBody(), status: "ready" });
        nextSeq = 4;
        expect(done.installation?.drive?.status).toBe("ready");
        expect(applyLedgerRecord(done, driveReady()).installation?.drive?.status).toBe("ready");
    });

    it("refuses drive_ready without a binding or for another revision", () => {
        const plain = build(() => [installed()]);
        expect(reasonOf(() => applyLedgerRecord(plain, driveReady()))).toBe("ledger-inconsistent");
        const bound = withBinding();
        nextSeq = 3;
        expect(reasonOf(() => applyLedgerRecord(bound, driveReady(REV_B)))).toBe("ledger-inconsistent");
    });

    it("refuses a binding whose identity or revision does not follow from its root and binding ids", () => {
        const body = boundBody();
        for (const wrong of [
            { ...body, destinationIdentity: ID_B }, { ...body, destinationRevision: REV_B }, { ...body, destinationIdentity: "local:arch-1" },
        ]) {
            nextSeq = 1;
            const state = build(() => [installed()]);
            expect(reasonOf(() => applyLedgerRecord(state, rec("drive_bound", wrong)))).toBe("ledger-inconsistent");
        }
    });

    it("supersedes the earlier binding with a new revision, pending again, and leaves the old revision's state in place", () => {
        const first = build(() => [installed(), driveBound(), driveReady(), reserve(FILE_1), created(FILE_1), ...driveVerifiedPath()]);
        nextSeq = first.lastSeq + 1;
        const second = applyLedgerRecord(first, driveBound(ROOT_B, BIND_B));
        expect(second.installation?.drive).toEqual({ ...boundBody(ROOT_B, BIND_B), status: "pending" });
        expect(second.driveNodes.get(driveStateKey(REV_A, NODE))).toEqual({ kind: "folder", fileId: FILE_1, parentFileId: PARENT, status: "created" });
        expect(second.destinations.get(destinationKey(ART1, ID_A, REV_A))?.state).toBe("verified");
        expect(second.installation?.destinationIdentity).toBe("local:arch-1");
    });

    it("treats the same binding again as a no-op that keeps its status, and refuses the same revision with other fields", () => {
        const first = ready();
        nextSeq = first.lastSeq + 1;
        expect(applyLedgerRecord(first, driveBound()).installation?.drive?.status).toBe("ready");
        nextSeq = first.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(first, rec("drive_bound", { ...boundBody(), rootName: "other" })))).toBe("ledger-inconsistent");
        nextSeq = first.lastSeq + 1;
        const sameRevisionOtherRoot = { ...boundBody(ROOT_B, BIND_A), destinationRevision: REV_A };
        expect(reasonOf(() => applyLedgerRecord(first, rec("drive_bound", sameRevisionOtherRoot)))).toBe("ledger-inconsistent");
    });

    it("takes the binding of recovery_started as pending and leaves a local-only recovery without one", () => {
        const recoveryBody = {
            installationId: "inst-1", archiveId: "arch-1", archiveDev: 1, archiveIno: 2, destinationIdentity: "local:arch-1",
            destinationRevision: "local-layout-v1", priorLedgerName: "ledger.quarantine-x", sequenceFloor: 3, knownGaps: [],
        };
        nextSeq = 1;
        const withDrive = applyLedgerRecord(emptyLedgerState(), rec("recovery_started", { ...recoveryBody, drive: boundBody() }));
        expect(withDrive.installation?.drive).toEqual({ ...boundBody(), status: "pending" });
        nextSeq = 2;
        expect(applyLedgerRecord(withDrive, driveReady()).installation?.drive?.status).toBe("ready");
        nextSeq = 1;
        expect(applyLedgerRecord(emptyLedgerState(), rec("recovery_started", recoveryBody)).installation?.drive).toBeNull();
        nextSeq = 1;
        const inconsistent = rec("recovery_started", { ...recoveryBody, drive: { ...boundBody(), destinationRevision: REV_B } });
        expect(reasonOf(() => applyLedgerRecord(emptyLedgerState(), inconsistent))).toBe("ledger-inconsistent");
    });
});

describe("Drive node reservations (BJJ-456 U1)", () => {
    beforeEach(() => { nextSeq = 1; });

    it("records a reservation before the create, then marks it created", () => {
        const reserved = build(() => [installed(), driveBound(), reserve(FILE_1)]);
        expect(reserved.driveNodes.get(driveStateKey(REV_A, NODE))).toEqual({ kind: "folder", fileId: FILE_1, parentFileId: PARENT, status: "reserved" });
        nextSeq = reserved.lastSeq + 1;
        const done = applyLedgerRecord(reserved, created(FILE_1));
        expect(done.driveNodes.get(driveStateKey(REV_A, NODE))?.status).toBe("created");
        nextSeq = done.lastSeq + 1;
        expect(applyLedgerRecord(done, created(FILE_1)).driveNodes.get(driveStateKey(REV_A, NODE))?.status).toBe("created");
        expect(reserved.driveNodes.get(driveStateKey(REV_A, NODE))?.status).toBe("reserved");
    });

    it("refuses a reservation without a binding or for a revision that is not the current one (T29)", () => {
        const plain = build(() => [installed()]);
        expect(reasonOf(() => applyLedgerRecord(plain, reserve(FILE_1)))).toBe("ledger-inconsistent");
        const rebound = build(() => [installed(), driveBound(), driveReady(), driveBound(ROOT_B, BIND_B)]);
        nextSeq = rebound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(rebound, reserve(FILE_1, "folder", NODE, REV_A)))).toBe("ledger-inconsistent");
        nextSeq = rebound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(rebound, reserve(FILE_1, "folder", NODE, REV_B)))).toBeNull();
        nextSeq = rebound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(rebound, reserve(FILE_1, "folder", NODE, "drive-layout-v1:cccccccc-cccc-4ccc-8ccc-cccccccccccc")))).toBe("ledger-inconsistent");
    });

    it("lets a later reservation of the same key supersede the earlier id; the superseded id can no longer be created, and the current id cannot be re-reserved", () => {
        const first = build(() => [installed(), driveBound(), reserve(FILE_1), created(FILE_1)]);
        nextSeq = first.lastSeq + 1;
        const second = applyLedgerRecord(first, reserve(FILE_2));
        expect(second.driveNodes.get(driveStateKey(REV_A, NODE))).toEqual({ kind: "folder", fileId: FILE_2, parentFileId: PARENT, status: "reserved" });
        expect(second.driveNodes.size).toBe(1);
        nextSeq = second.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(second, created(FILE_1)))).toBe("ledger-inconsistent");
        nextSeq = second.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(second, reserve(FILE_1)))).toBe("ledger-inconsistent");
        nextSeq = second.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(second, reserve(FILE_2)))).toBe("ledger-inconsistent");
        // Re-reserving the id of a created node would silently reset it to `reserved`.
        nextSeq = first.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(first, reserve(FILE_1)))).toBe("ledger-inconsistent");
    });

    describe("a retired reservation id is never current again (u1f-retired)", () => {
        const abandoned = (): LedgerState => build(() => [installed(), driveBound(), reserve(FILE_1), created(FILE_1), reserve(FILE_2)]);

        it("refuses to reserve or create a superseded id for the same key, for another key and for a file", () => {
            const state = abandoned();
            expect(state.driveNodes.get(driveStateKey(REV_A, NODE))).toEqual({ kind: "folder", fileId: FILE_2, parentFileId: PARENT, status: "reserved" });
            for (const next of [reserve(FILE_1), created(FILE_1), reserve(FILE_1, "folder", "eformsign/other"), reserve(FILE_1, "file", ART_KEY)]) {
                nextSeq = state.lastSeq + 1;
                expect(reasonOf(() => applyLedgerRecord(state, { ...next, seq: nextSeq }))).toBe("ledger-inconsistent");
            }
            expect(state.driveNodes.get(driveStateKey(REV_A, NODE))?.fileId).toBe(FILE_2);
        });

        it("keeps refusing it through any further supersession", () => {
            const state = build(() => [installed(), driveBound(), reserve(FILE_1), reserve(FILE_2), reserve(FILE_3)]);
            for (const retired of [FILE_1, FILE_2]) {
                nextSeq = state.lastSeq + 1;
                expect(reasonOf(() => applyLedgerRecord(state, reserve(retired)))).toBe("ledger-inconsistent");
            }
            nextSeq = state.lastSeq + 1;
            expect(reasonOf(() => applyLedgerRecord(state, reserve(FILE_3)))).toBe("ledger-inconsistent");
        });

        it("still refuses it after a checkpoint round trip", () => {
            const restored = ledgerStateFromJson(JSON.parse(canonicalJson(ledgerStateToJson(abandoned()))));
            for (const next of [reserve(FILE_1), created(FILE_1)]) {
                nextSeq = restored.lastSeq + 1;
                expect(reasonOf(() => applyLedgerRecord(restored, { ...next, seq: nextSeq }))).toBe("ledger-inconsistent");
            }
            nextSeq = restored.lastSeq + 1;
            expect(reasonOf(() => applyLedgerRecord(restored, reserve(FILE_3)))).toBeNull();
        });

        it("does not retire an id that was never superseded", () => {
            const state = build(() => [installed(), driveBound(), reserve(FILE_1), created(FILE_1), reserve(FILE_2, "file", ART_KEY)]);
            nextSeq = state.lastSeq + 1;
            expect(reasonOf(() => applyLedgerRecord(state, reserve(FILE_3, "folder", "eformsign/other")))).toBeNull();
        });
    });

    it("keeps a folder and a file under distinct node keys", () => {
        const state = build(() => [installed(), driveBound(), reserve(FILE_1), reserve(FILE_2, "file", ART_KEY)]);
        expect(state.driveNodes.get(driveStateKey(REV_A, ART_KEY))).toMatchObject({ kind: "file", fileId: FILE_2 });
        expect(state.driveNodes.get(driveStateKey(REV_A, NODE))).toMatchObject({ kind: "folder", fileId: FILE_1 });
    });

    it("refuses drive_node_created for an unknown key, another id or another revision", () => {
        const reserved = build(() => [installed(), driveBound(), reserve(FILE_1)]);
        for (const bad of [created(FILE_1, "eformsign/other"), created(FILE_3), created(FILE_1, NODE, REV_B)]) {
            nextSeq = reserved.lastSeq + 1;
            expect(reasonOf(() => applyLedgerRecord(reserved, { ...bad, seq: nextSeq }))).toBe("ledger-inconsistent");
        }
        const plain = build(() => [installed()]);
        nextSeq = 2;
        expect(reasonOf(() => applyLedgerRecord(plain, created(FILE_1)))).toBe("ledger-inconsistent");
    });
});

describe("Drive published records and the outbox (BJJ-456 U1)", () => {
    beforeEach(() => { nextSeq = 1; });
    const SHA = hex("e");
    const SHA2 = hex("f");

    it("records a published record per revision and key", () => {
        const state = build(() => [installed(), driveBound(), published(SHA)]);
        expect(state.driveRecords.get(driveStateKey(REV_A, REC_KEY))).toEqual({ sha256: SHA, fileId: FILE_1 });
    });

    it("is idempotent for the same content, follows a changed file id, and refuses different content for one key", () => {
        const state = build(() => [installed(), driveBound(), published(SHA)]);
        nextSeq = state.lastSeq + 1;
        const same = applyLedgerRecord(state, published(SHA));
        expect(same.driveRecords.get(driveStateKey(REV_A, REC_KEY))).toEqual({ sha256: SHA, fileId: FILE_1 });
        nextSeq = state.lastSeq + 1;
        expect(applyLedgerRecord(state, published(SHA, FILE_2)).driveRecords.get(driveStateKey(REV_A, REC_KEY))).toEqual({ sha256: SHA, fileId: FILE_2 });
        nextSeq = state.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(state, published(SHA2)))).toBe("drive-conflict");
    });

    it("refuses a published record without a binding or for another revision", () => {
        nextSeq = 2;
        expect(reasonOf(() => applyLedgerRecord(build(() => [installed()]), published(SHA)))).toBe("ledger-inconsistent");
        const bound = withBinding();
        nextSeq = bound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(bound, published(SHA, FILE_1, REC_KEY, REV_B)))).toBe("ledger-inconsistent");
    });

    it("keeps a pending record until the same content is published, then clears it", () => {
        const state = build(() => [installed(), driveBound(), pending(SHA)]);
        expect(state.driveRecordsPending.get(driveStateKey(REV_A, REC_KEY))).toBe(SHA);
        nextSeq = state.lastSeq + 1;
        expect(applyLedgerRecord(state, pending(SHA)).driveRecordsPending.get(driveStateKey(REV_A, REC_KEY))).toBe(SHA);
        nextSeq = state.lastSeq + 1;
        const done = applyLedgerRecord(state, published(SHA));
        expect(done.driveRecordsPending.size).toBe(0);
        expect(done.driveRecords.get(driveStateKey(REV_A, REC_KEY))).toEqual({ sha256: SHA, fileId: FILE_1 });
        expect(state.driveRecordsPending.size).toBe(1);
    });

    it("refuses two different contents for one record key, in either order, and a pending for a published key", () => {
        const pend = build(() => [installed(), driveBound(), pending(SHA)]);
        nextSeq = pend.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(pend, pending(SHA2)))).toBe("drive-conflict");
        nextSeq = pend.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(pend, published(SHA2)))).toBe("drive-conflict");
        const pub = build(() => [installed(), driveBound(), published(SHA)]);
        nextSeq = pub.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(pub, pending(SHA2)))).toBe("drive-conflict");
        nextSeq = pub.lastSeq + 1;
        expect(applyLedgerRecord(pub, pending(SHA)).driveRecordsPending.size).toBe(0);
    });

    it("refuses a pending record without a binding or for another revision", () => {
        nextSeq = 2;
        expect(reasonOf(() => applyLedgerRecord(build(() => [installed()]), pending(SHA)))).toBe("ledger-inconsistent");
        const bound = withBinding();
        nextSeq = bound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(bound, pending(SHA, REC_KEY, REV_B)))).toBe("ledger-inconsistent");
    });
});

describe("Drive destination entries do not cross bindings (T29, u1-reuse)", () => {
    beforeEach(() => { nextSeq = 1; });

    function verifiedUnderA(): LedgerState {
        return build(() => [installed(), driveBound(), driveReady(), ...driveVerifiedPath()]);
    }

    it("reaches verified for the current Drive binding through the ordinary transitions", () => {
        const state = verifiedUnderA();
        expect(state.destinations.get(destinationKey(ART1, ID_A, REV_A))).toMatchObject({ state: "verified", relativeKey: ART_KEY });
    });

    it("does not reuse a verified entry of revision A once revision B is bound", () => {
        const state = verifiedUnderA();
        nextSeq = state.lastSeq + 1;
        const rebound = applyLedgerRecord(state, driveBound(ROOT_B, BIND_B));
        expect(rebound.destinations.get(destinationKey(ART1, ID_A, REV_A))?.state).toBe("verified");
        expect(rebound.destinations.get(destinationKey(ART1, ID_B, REV_B))).toBeUndefined();
        expect(() => assertVerifiedReusable(REV_A, rebound.installation!.drive!.destinationRevision)).toThrow(expect.objectContaining({ reasonCode: "forbidden-transition" }));
        expect(() => transitionDestination("verified", "pending", { fromDestinationRevision: REV_A, destinationRevision: REV_B }))
            .toThrow(expect.objectContaining({ reasonCode: "forbidden-transition" }));
        // Claiming the carried-over entry under B starts from nothing, so a transition from `verified` is refused ...
        nextSeq = rebound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(rebound, driveTransition("integrity_error", "verified", ID_B, REV_B)))).toBe("forbidden-transition");
        // ... and a fresh path under B begins at pending.
        nextSeq = rebound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(rebound, driveTransition("pending", null, ID_B, REV_B)))).toBeNull();
    });

    it("refuses a Drive transition for a binding that is not the current one", () => {
        const rebound = build(() => [installed(), driveBound(), driveReady(), driveBound(ROOT_B, BIND_B)]);
        nextSeq = rebound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(rebound, driveTransition("pending", null, ID_A, REV_A)))).toBe("ledger-inconsistent");
        nextSeq = rebound.lastSeq + 1;
        // right root, wrong revision and the reverse are refused too
        expect(reasonOf(() => applyLedgerRecord(rebound, driveTransition("pending", null, ID_B, REV_A)))).toBe("ledger-inconsistent");
        nextSeq = rebound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(rebound, driveTransition("pending", null, ID_A, REV_B)))).toBe("ledger-inconsistent");
    });

    it("refuses a Drive transition when nothing is bound, and leaves local transitions alone", () => {
        const plain = build(() => [installed()]);
        nextSeq = plain.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(plain, driveTransition("pending", null)))).toBe("ledger-inconsistent");
        nextSeq = plain.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(plain, driveTransition("pending", null, "local:arch-1", "local-layout-v1")))).toBeNull();
    });

    it("takes a Drive recovered_verified only for the current binding and creates a verified entry for it", () => {
        const recovered = (identity: string, revision: string, fileId = FILE_1) => rec("recovered_verified", {
            artifactIdentity: ART1, relativeKey: ART_KEY, sha256: hex("a"), destinationIdentity: identity, destinationRevision: revision, fileId,
        });
        const bound = build(() => [installed(), driveBound(), driveReady()]);
        nextSeq = bound.lastSeq + 1;
        const state = applyLedgerRecord(bound, recovered(ID_A, REV_A));
        expect(state.destinations.get(destinationKey(ART1, ID_A, REV_A))).toMatchObject({
            state: "verified", relativeKey: ART_KEY, destinationIdentity: ID_A, destinationRevision: REV_A,
            history: [expect.objectContaining({ to: "verified", kind: "recovery" })],
        });
        expect(state.destinations.get(destinationKey(ART1, "local:arch-1", "local-layout-v1"))).toBeUndefined();
        expect(state.artifacts.get(ART1)).toMatchObject({ documentId: "D001", artifactType: "document", sha256: hex("a") });

        const rebound = build(() => [installed(), driveBound(), driveReady(), driveBound(ROOT_B, BIND_B)]);
        for (const [identity, revision] of [[ID_A, REV_A], [ID_B, REV_A], [ID_A, REV_B], ["drive:rootFolderCcccc03", "drive-layout-v1:cccccccc-cccc-4ccc-8ccc-cccccccccccc"]]) {
            nextSeq = rebound.lastSeq + 1;
            expect(reasonOf(() => applyLedgerRecord(rebound, recovered(identity!, revision!)))).toBe("ledger-inconsistent");
        }
        nextSeq = rebound.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(rebound, recovered(ID_B, REV_B)))).toBeNull();
        const plain = build(() => [installed()]);
        nextSeq = plain.lastSeq + 1;
        expect(reasonOf(() => applyLedgerRecord(plain, recovered(ID_A, REV_A)))).toBe("ledger-inconsistent");
    });

    it("keeps a recovered_verified without Drive fields local, as before", () => {
        const plain = build(() => [installed(), driveBound(), driveReady()]);
        nextSeq = plain.lastSeq + 1;
        const state = applyLedgerRecord(plain, rec("recovered_verified", { artifactIdentity: ART1, relativeKey: ART_KEY, sha256: hex("a") }));
        expect(state.destinations.get(destinationKey(ART1, "local:arch-1", "local-layout-v1"))?.state).toBe("verified");
        expect(state.destinations.get(destinationKey(ART1, ID_A, REV_A))).toBeUndefined();
    });
});

describe("Drive state checkpoint and replay (BJJ-456 U1)", () => {
    beforeEach(() => { nextSeq = 1; });
    const SHA = hex("e");

    function rich(): LedgerRecord[] {
        nextSeq = 1;
        return [
            installed(), driveBound(), reserve(FILE_1), created(FILE_1), reserve(FILE_2, "file", ART_KEY), driveReady(),
            published(SHA, FILE_3), pending(hex("d"), "eformsign/company-1/runs/" + "11111111-1111-4111-8111-111111111111" + ".json"),
            ...driveVerifiedPath(), reserve(FILE_3, "folder", NODE),
        ];
    }

    it("round-trips all Drive state through the canonical-JSON-safe checkpoint object", () => {
        const state = applyLedgerRecords(emptyLedgerState(), rich());
        expect(state.installation?.drive?.status).toBe("ready");
        expect(state.driveNodes.size).toBe(2);
        expect(state.driveRecords.size).toBe(1);
        expect(state.driveRecordsPending.size).toBe(1);
        const text = canonicalJson(ledgerStateToJson(state));
        const restored = ledgerStateFromJson(JSON.parse(text));
        expect(restored).toEqual(state);
        expect(canonicalJson(ledgerStateToJson(restored))).toBe(text);
        expect(restored.driveNodes.get(driveStateKey(REV_A, NODE))).toEqual({ kind: "folder", fileId: FILE_3, parentFileId: PARENT, status: "reserved" });
        expect([...restored.driveRetiredIds]).toEqual([driveStateKey(REV_A, FILE_1)]);
        nextSeq = state.lastSeq + 1;
        const next = published(SHA, FILE_3, NODE + "/x.json");
        expect(canon(applyLedgerRecord(restored, next))).toBe(canon(applyLedgerRecord(state, next)));
    });

    it("replays to the same state however the records are folded, and from a checkpoint plus the tail", () => {
        const records = rich();
        const whole = applyLedgerRecords(emptyLedgerState(), records);
        const stepwise = records.reduce((state, record) => applyLedgerRecord(state, record), emptyLedgerState());
        expect(canon(stepwise)).toBe(canon(whole));
        expect(canon(applyLedgerRecords(emptyLedgerState(), records))).toBe(canon(whole));
        const head = applyLedgerRecords(emptyLedgerState(), records.slice(0, 6));
        const resumed = applyLedgerRecords(ledgerStateFromJson(JSON.parse(canonicalJson(ledgerStateToJson(head)))), records.slice(6));
        expect(canon(resumed)).toBe(canon(whole));
    });

    it("does not change the input state when it applies a Drive record", () => {
        const before = build(() => [installed(), driveBound(), reserve(FILE_1)]);
        const frozen = canon(before);
        for (const next of [reserve(FILE_2), created(FILE_1), published(SHA), pending(SHA), driveReady(), driveBound(ROOT_B, BIND_B)]) {
            applyLedgerRecord(before, { ...next, seq: before.lastSeq + 1 });
            expect(canon(before)).toBe(frozen);
        }
        expect(before.driveNodes.get(driveStateKey(REV_A, NODE))?.fileId).toBe(FILE_1);
    });

    it("reads a checkpoint written before the Drive fields existed as a state without Drive", () => {
        nextSeq = 1;
        const local = applyLedgerRecords(emptyLedgerState(), [installed()]);
        const json = JSON.parse(canonicalJson(ledgerStateToJson(local))) as Record<string, unknown>;
        delete json["driveNodes"];
        delete json["driveRecords"];
        delete json["driveRecordsPending"];
        delete json["driveRetiredIds"];
        delete (json["installation"] as Record<string, unknown>)["drive"];
        expect(ledgerStateFromJson(json)).toEqual(local);
    });

    it("rejects malformed Drive checkpoint data as ledger-schema", () => {
        const json = JSON.parse(canon(applyLedgerRecords(emptyLedgerState(), rich()))) as Record<string, any>;
        const clone = () => JSON.parse(JSON.stringify(json)) as Record<string, any>;
        const broken: Array<Record<string, unknown>> = [];
        let value = clone(); value["driveNodes"][0]["fileId"] = "short"; broken.push(value);
        value = clone(); value["driveNodes"][0]["status"] = "gone"; broken.push(value);
        value = clone(); value["driveNodes"][0]["extra"] = 1; broken.push(value);
        value = clone(); value["driveRecords"][0]["sha256"] = "x"; broken.push(value);
        value = clone(); value["driveRecordsPending"][0]["sha256"] = "x"; broken.push(value);
        value = clone(); value["installation"]["drive"]["status"] = "maybe"; broken.push(value);
        value = clone(); value["installation"]["drive"]["bindingId"] = "nope"; broken.push(value);
        value = clone(); value["installation"]["drive"]["extra"] = 1; broken.push(value);
        value = clone(); value["driveNodes"] = "x"; broken.push(value);
        value = clone(); value["driveRetiredIds"][0]["fileId"] = "short"; broken.push(value);
        value = clone(); value["driveRetiredIds"][0]["extra"] = 1; broken.push(value);
        for (const candidate of broken) expect(reasonOf(() => ledgerStateFromJson(candidate))).toBe("ledger-schema");
    });
});

describe("checkpoint written before the Drive counters existed (BJJ-456 U1-F1)", () => {
    beforeEach(() => { nextSeq = 1; });
    const RUN = "11111111-1111-4111-8111-111111111111";
    const counts = { candidates: 1, included: 1, verified: 1, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0 };
    const zeroDrive = { driveVerified: 0, driveBlocked: 0, driveRetryWait: 0, driveIntegrityError: 0 };

    function withFinishedRun(): LedgerState {
        return build(() => [
            installed(), rec("run_started", { runId: RUN, scheduledFor: null, startedAt: clock(1) }),
            rec("run_finished", {
                runId: RUN, finishedAt: clock(2), snapshotStatus: "partial", historicalCoverage: "unverified",
                reasonCodes: ["coverage-unverified", "drive-not-configured"], counts: { ...counts, ...zeroDrive },
            }),
        ]);
    }
    function legacyJson(): Record<string, any> {
        const json = JSON.parse(canon(withFinishedRun())) as Record<string, any>;
        for (const key of Object.keys(zeroDrive)) delete json["runs"][0]["counts"][key];
        return json;
    }

    it("loads a checkpoint whose finished run has no Drive counters, normalized to zero", () => {
        const json = legacyJson();
        expect(Object.keys(json["runs"][0]["counts"])).toHaveLength(8);
        const restored = ledgerStateFromJson(json);
        expect(restored.runs.get(RUN)?.counts).toEqual({ ...counts, ...zeroDrive });
        expect(restored).toEqual(withFinishedRun());
    });

    it("writes all four Drive counters again", () => {
        const rewritten = JSON.parse(canon(ledgerStateFromJson(legacyJson()))) as Record<string, any>;
        expect(rewritten["runs"][0]["counts"]).toEqual({ ...counts, ...zeroDrive });
    });

    it("stays strict about the Drive counters", () => {
        for (const bad of ["1", -1, 0.5, null]) {
            const json = legacyJson();
            json["runs"][0]["counts"]["driveBlocked"] = bad;
            expect(reasonOf(() => ledgerStateFromJson(json))).toBe("ledger-schema");
        }
        const extra = legacyJson();
        extra["runs"][0]["counts"]["other"] = 1;
        expect(reasonOf(() => ledgerStateFromJson(extra))).toBe("ledger-schema");
    });
});
