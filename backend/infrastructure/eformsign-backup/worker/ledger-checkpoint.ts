import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import {
    WorkerError, ledgerStateFromJson, ledgerStateToJson, type LedgerState,
} from "domain/eformsign-backup/worker";

/**
 * `checkpoint.json` = canonical JSON of `{v, lastSeq, state, sum}` plus `\n`, where `state` is the domain's
 * `ledgerStateToJson(state)` and `sum` is sha256 over a domain label and the canonical JSON of the other three fields.
 * Reading it back is strict: a wrong sum, an unknown shape or a `lastSeq` that disagrees with the state is an error.
 */
const CHECKPOINT_VERSION = 1;
const CHECKPOINT_DOMAIN = "eformsign-backup/ledger/checkpoint/v1\n";

function sumOf(lastSeq: number, state: unknown): string {
    return createHash("sha256")
        .update(`${CHECKPOINT_DOMAIN}${canonicalJson({ v: CHECKPOINT_VERSION, lastSeq, state })}`, "utf8")
        .digest("hex");
}

export function encodeCheckpoint(state: LedgerState): Buffer {
    try {
        const body = ledgerStateToJson(state);
        const text = `${canonicalJson({ v: CHECKPOINT_VERSION, lastSeq: state.lastSeq, state: body, sum: sumOf(state.lastSeq, body) })}\n`;
        return Buffer.from(text, "utf8");
    } catch {
        // A state canonicalJson refuses cannot be written down faithfully; nothing has touched the disk yet.
        throw new WorkerError("ledger-schema");
    }
}

const envelopeSchema = z.strictObject({
    v: z.literal(CHECKPOINT_VERSION),
    lastSeq: z.number().int().min(1),
    state: z.unknown(),
    sum: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Returns the state, or `null` when the bytes are not a valid checkpoint. */
export function decodeCheckpoint(bytes: Uint8Array): LedgerState | null {
    try {
        const parsed = envelopeSchema.safeParse(JSON.parse(Buffer.from(bytes).toString("utf8")));
        if (!parsed.success) return null;
        const { lastSeq, state, sum } = parsed.data;
        if (sumOf(lastSeq, state) !== sum) return null;
        const restored = ledgerStateFromJson(state);
        if (restored.lastSeq !== lastSeq || restored.installation === null) return null;
        return restored;
    } catch {
        return null;
    }
}
