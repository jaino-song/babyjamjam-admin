import { createHash } from "node:crypto";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { applyLedgerRecord, emptyLedgerState, ledgerStateToJson } from "domain/eformsign-backup/worker";
import { canonicalLedgerJson } from "infrastructure/eformsign-backup/worker/ledger-canonical-json";
import { decodeCheckpoint, encodeCheckpoint } from "infrastructure/eformsign-backup/worker/ledger-checkpoint";
import { INSTALL_AT, INSTALL_BODY } from "./helpers/ledger-fixtures";

describe("private checkpoint canonical JSON profile", () => {
    it.each([
        { value: { z: 0, a: [true, null, false, -42, Number.MAX_SAFE_INTEGER] }, bytes: '{"a":[true,null,false,-42,9007199254740991],"z":0}' },
        { value: { "😀": "한글", "\uE000": "\"\\\n\t\u0000", Z: "😀" }, bytes: '{"Z":"😀","😀":"한글","\uE000":"\\\"\\\\\\n\\t\\u0000"}' },
        { value: [[], {}, "", Number.MIN_SAFE_INTEGER], bytes: '[[],{},"",-9007199254740991]' },
    ])("matches a literal byte oracle and the legacy codec: $bytes", ({ value, bytes }) => {
        expect(canonicalLedgerJson(value)).toBe(bytes);
        expect(canonicalLedgerJson(value)).toBe(canonicalJson(value));
    });

    it.each([
        undefined, () => null, Symbol("invalid"), 1n, NaN, Infinity, -Infinity, 1.5,
        Number.MAX_SAFE_INTEGER + 1, -0, "\uD800", "\uDC00", { "\uD800": 1 },
        new Date(0), new Map(), new Set(), /x/, Object.create(null), Object.create({ inherited: 1 }),
        [undefined], { value: undefined }, Array(1), Object.assign([], { extra: 1 }),
        JSON.parse('{"__proto__":0}'), { constructor: 1 }, { prototype: 1 },
        Object.defineProperty({}, "hidden", { value: 1 }), { [Symbol("key")]: 1 },
        Object.defineProperty([1], "0", { value: 1, enumerable: false }),
    ])("rejects values outside the unchanged profile (%#)", (value) => {
        expect(() => canonicalLedgerJson(value)).toThrow("Invalid ledger JSON");
    });

    it("rejects cycles, accessors, proxies and toJSON without invoking user code", () => {
        const invoked = jest.fn(() => { throw new Error("must not execute"); });
        const cyclic: unknown[] = [];
        cyclic.push(cyclic);
        const target = { a: 1 };
        const revocable = Proxy.revocable({}, {});
        revocable.revoke();
        const invalid = [
            cyclic, Object.defineProperty({}, "a", { enumerable: true, get: invoked }),
            Object.defineProperty({}, "a", { enumerable: true, set: invoked }),
            Object.defineProperty([], "0", { enumerable: true, get: invoked }),
            new Proxy(target, { get: invoked, getPrototypeOf: invoked, ownKeys: invoked, getOwnPropertyDescriptor: invoked }),
            revocable.proxy, { toJSON: invoked },
        ];
        for (const value of invalid) expect(() => canonicalLedgerJson(value)).toThrow("Invalid ledger JSON");
        expect(invoked).not.toHaveBeenCalled();
        expect(canonicalLedgerJson([target, target])).toBe('[{"a":1},{"a":1}]');
        expect(canonicalLedgerJson({ valid: true })).toBe('{"valid":true}');
    });

    it("retains depth 64, without shared validation state between calls", () => {
        let value: unknown = null;
        for (let i = 0; i < 64; i++) value = [value];
        expect(canonicalLedgerJson(value)).toBe(canonicalJson(value));
        expect(() => canonicalLedgerJson([value])).toThrow("Invalid ledger JSON");
        expect(canonicalLedgerJson(value)).toBe(canonicalJson(value));
    });

    it.each(["bytes", "nodes"] as const)("encodes and parses beyond the legacy aggregate %s limit", (limit) => {
        const value = limit === "bytes" ? "x".repeat(1_048_577) : Array.from({ length: 100_001 }, () => null);
        expect(() => canonicalJson(value)).toThrow("Invalid evidence");
        const bytes = canonicalLedgerJson(value);
        expect(JSON.parse(bytes)).toEqual(value);
        expect(canonicalLedgerJson(JSON.parse(bytes))).toBe(bytes);
    });
});

it("keeps legacy checkpoint bytes/checksum and strict decoding unchanged", () => {
    const state = applyLedgerRecord(emptyLedgerState(), { v: 1, seq: 1, type: "installed", at: INSTALL_AT, body: INSTALL_BODY });
    const body = ledgerStateToJson(state);
    const sum = createHash("sha256").update(`eformsign-backup/ledger/checkpoint/v1\n${canonicalJson({ v: 1, lastSeq: 1, state: body })}`).digest("hex");
    const legacy = Buffer.from(`${canonicalJson({ v: 1, lastSeq: 1, state: body, sum })}\n`);
    expect(encodeCheckpoint(state)).toEqual(legacy);
    expect(ledgerStateToJson(decodeCheckpoint(legacy)!)).toEqual(body);
    const parsed = JSON.parse(legacy.toString());
    parsed.sum = "0".repeat(64);
    expect(decodeCheckpoint(Buffer.from(JSON.stringify(parsed)))).toBeNull();
    parsed.v = 2;
    expect(decodeCheckpoint(Buffer.from(JSON.stringify(parsed)))).toBeNull();
    expect(decodeCheckpoint(Buffer.from('{"v":1}'))).toBeNull();
});
