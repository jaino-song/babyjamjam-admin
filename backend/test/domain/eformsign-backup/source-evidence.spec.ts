import {
    artifactIdentity, canonicalJson, evaluateBundle, metadataRevision,
} from "domain/eformsign-backup/source-evidence";

const hash = "a".repeat(64);
const document = { companyId: "company-1", documentId: "doc-1", artifactKind: "document" as const, contentSha256: hash, byteLength: 3 };
const audit = { ...document, artifactKind: "audit-trail" as const, contentSha256: "b".repeat(64) };
const metadata = { status: "completed", fields: { b: 2, a: 1 } };
const bundle = (artifacts = [document, audit], stableMetadata: unknown = metadata) => evaluateBundle({ companyId: "company-1", documentId: "doc-1", artifacts, stableMetadata });

describe("source evidence v1", () => {
    it("freezes exact independently calculated golden identities", () => {
        expect(artifactIdentity(document)).toBe("f41cb8500b17f15342e1a4917f7798850a0e9b75a0116687ca8cf8d955cd863b");
        expect(metadataRevision(metadata)).toBe("fce4be36f4208e3716303c126e7fba1d4a1046c7c2f22dcd33a7e3abfeff0c76");
        expect(bundle().bundleId).toBe("4352d8c85f2773d4372c72f9da04ff836b32ba864f40dc6647f61e43ab185d96");
    });
    it("sorts recursive keys and artifacts, retaining array order", () => {
        expect(bundle([audit, document], { fields: { a: 1, b: 2 }, status: "completed" })).toEqual(bundle());
        expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    });
    it("keeps acquisition provenance outside identity and never manufactures provider proof", () => {
        const acquiredAgain = { ...document, acquisitionId: "attempt-2", acquiredAt: "2099-01-01", sourceUpdatedDate: "same" };
        expect(artifactIdentity(acquiredAgain)).toBe(artifactIdentity(document));
        expect(bundle([acquiredAgain, audit])).toMatchObject({ sourceRevision: null, consistency: "unverified" });
    });
    it("changes bundle when either bytes or selected metadata changes", () => {
        expect(bundle([{ ...document, contentSha256: "c".repeat(64) }, audit]).bundleId).not.toBe(bundle().bundleId);
        expect(bundle([document, audit], { status: "changed" }).bundleId).not.toBe(bundle().bundleId);
    });
    it("marks missing audit incomplete without a usable bundle", () => {
        expect(bundle([document])).toMatchObject({ consistency: "incomplete", bundleId: null });
    });
    it("deduplicates identical claims but marks contradictory same-kind claims conflict", () => {
        expect(bundle([document, document, audit])).toEqual(bundle());
        expect(bundle([document, { ...document, byteLength: 4 }, audit])).toMatchObject({ consistency: "conflict", bundleId: null });
        expect(bundle([document, { ...document, contentSha256: "c".repeat(64) }, audit]).consistency).toBe("conflict");
    });
    it.each(["", "../unsafe", "a".repeat(257), "space id"])("rejects unsafe identifier %s", companyId => {
        expect(() => artifactIdentity({ ...document, companyId })).toThrow("Invalid evidence");
    });
    it.each(["A".repeat(64), "a".repeat(63), "z".repeat(64)])("rejects noncanonical digest", contentSha256 => {
        expect(() => artifactIdentity({ ...document, contentSha256 })).toThrow();
    });
    it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN])("rejects invalid byte lengths", byteLength => {
        expect(() => artifactIdentity({ ...document, byteLength })).toThrow();
    });
    it("rejects foreign context and unsupported artifact kinds", () => {
        expect(() => artifactIdentity(null as any)).toThrow("Invalid evidence");
        expect(() => evaluateBundle(null as any)).toThrow("Invalid evidence");
        expect(() => bundle([{ ...document, companyId: "other" }, audit])).toThrow();
        expect(() => artifactIdentity({ ...document, artifactKind: "detail" as any })).toThrow();
    });
    it.each([undefined, NaN, Infinity, -0, 1n, () => 1, new Date(), new Map(), /x/, { missing: undefined }, [undefined], Array(1), Object.assign([1], { extra: 2 }), { x: "\ud800" }])("rejects ambiguous non-JSON metadata %#", value => {
        expect(() => canonicalJson(value)).toThrow("Invalid evidence");
    });
    it("rejects cycles, symbol keys, accessors without invoking them and custom prototypes", () => {
        const cycle: any = {}; cycle.self = cycle;
        const trap = jest.fn();
        expect(() => canonicalJson(new Proxy({}, { ownKeys: trap }))).toThrow("Invalid evidence");
        expect(trap).not.toHaveBeenCalled();
        const get = jest.fn(() => "secret");
        for (const value of [cycle, { [Symbol("x")]: 1 }, Object.defineProperty({}, "x", { get, enumerable: true }), Object.create({ x: 1 })]) {
            expect(() => canonicalJson(value)).toThrow();
        }
        expect(() => artifactIdentity(Object.defineProperty({ ...document }, "contentSha256", { get, enumerable: true }))).toThrow();
        expect(() => evaluateBundle(Object.defineProperty({ companyId: "company-1", documentId: "doc-1", artifacts: [document, audit], stableMetadata: metadata }, "artifacts", { get, enumerable: true }))).toThrow();
        expect(get).not.toHaveBeenCalled();
    });
    it("rejects dangerous and hidden keys and a scalar selected metadata object", () => {
        expect(() => canonicalJson(JSON.parse('{"__proto__":1}'))).toThrow();
        expect(() => canonicalJson(Object.defineProperty({}, "x", { value: 1 }))).toThrow();
        expect(() => metadataRevision("not-selected-fields")).toThrow();
    });
});
