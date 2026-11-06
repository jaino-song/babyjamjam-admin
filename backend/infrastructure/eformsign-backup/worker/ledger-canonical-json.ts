import { types } from "node:util";

function invalid(): never { throw new Error("Invalid ledger JSON"); }
function jsonString(value: string): string {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) invalid();
    return JSON.stringify(value);
}

/**
 * Private control-checkpoint codec. Same bytes and conservative profile as source-evidence canonicalJson,
 * without its aggregate node/byte budget: selections and historical receipts accumulate across records.
 * Individual journal records retain their existing limits. Whole strings/Buffers and JSON.parse still
 * consume host memory; this is neither a streaming storage format nor an unlimited-memory guarantee.
 */
export function canonicalLedgerJson(value: unknown): string {
    const ancestors = new Set<object>();
    function encode(item: unknown, depth: number): string {
        if (depth > 64) invalid();
        if (item === null) return "null";
        if (typeof item === "string") return jsonString(item);
        if (typeof item === "boolean") return String(item);
        if (typeof item === "number") {
            if (!Number.isSafeInteger(item) || Object.is(item, -0)) invalid();
            return String(item);
        }
        // Check proxies before any reflection, including revoked proxies; never invoke their traps.
        if (typeof item !== "object" || types.isProxy(item) || ancestors.has(item)) invalid();
        const array = Array.isArray(item);
        if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)) invalid();
        const descriptors = Object.getOwnPropertyDescriptors(item);
        const keys = Reflect.ownKeys(descriptors);
        for (const key of keys) {
            if (typeof key !== "string") invalid();
            const descriptor = descriptors[key]!;
            if (!("value" in descriptor) || (!descriptor.enumerable && !(array && key === "length"))) invalid();
            if (["__proto__", "constructor", "prototype"].includes(key)) invalid();
        }
        ancestors.add(item);
        let result: string;
        if (array) {
            if (keys.length !== item.length + 1) invalid();
            const parts: string[] = [];
            for (let i = 0; i < item.length; i++) {
                const descriptor = descriptors[String(i)];
                if (!descriptor) invalid();
                parts.push(encode(descriptor.value, depth + 1));
            }
            result = `[${parts.join(",")}]`;
        } else {
            result = `{${(keys as string[]).sort().map(key => `${jsonString(key)}:${encode(descriptors[key]!.value, depth + 1)}`).join(",")}}`;
        }
        ancestors.delete(item);
        return result;
    }
    return encode(value, 0);
}
