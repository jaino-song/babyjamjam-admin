/**
 * Cursors are opaque to clients, which only echo them. The backend alone looks inside: Valkey
 * stream ids (`<ms>-<seq>@<incarnation>`) and in-process ring ids (`<epoch>:<seq>`) are compared
 * by their numeric parts, never as strings ("…-9" sorts after "…-10" lexically).
 *
 * The incarnation names one life of the Valkey stream. A stream that was deleted and recreated
 * restarts its counters, so a bare `<ms>-<seq>` from the old stream could look valid (or even
 * "older than everything") against the new one and silently skip hints; with the incarnation in the
 * cursor, history that no longer exists is a different id space and is never honoured.
 */
export const CURSOR_MAX_LENGTH = 64;

const CURSOR_PATTERN = /^[0-9A-Za-z:._-]+$/;
const STREAM_CURSOR = /^(\d{1,20})-(\d{1,20})@([0-9a-f]{16})$/;
const RING_CURSOR = /^([0-9A-Za-z._-]{1,32}):(\d{1,15})$/;

export type ParsedCursor =
    | { kind: "stream"; ms: bigint; seq: bigint; inc: string }
    | { kind: "ring"; epoch: string; seq: bigint };

/** Wire-level validity only (length and charset); says nothing about whether it is honoured. */
export function isValidCursor(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= CURSOR_MAX_LENGTH && CURSOR_PATTERN.test(value);
}

export function parseCursor(cursor: string): ParsedCursor | null {
    const stream = STREAM_CURSOR.exec(cursor);
    if (stream) {
        return { kind: "stream", ms: BigInt(stream[1] as string), seq: BigInt(stream[2] as string), inc: stream[3] as string };
    }
    const ring = RING_CURSOR.exec(cursor);
    if (ring) return { kind: "ring", epoch: ring[1] as string, seq: BigInt(ring[2] as string) };
    return null;
}

export function formatStreamCursor(streamId: string, incarnation: string): string {
    return `${streamId}@${incarnation}`;
}

export function formatRingCursor(epoch: string, seq: number): string {
    return `${epoch}:${seq}`;
}

/** Negative / zero / positive like a comparator, or `null` when the two live in different id spaces. */
export function compareParsedCursors(a: ParsedCursor, b: ParsedCursor): number | null {
    if (a.kind === "stream" && b.kind === "stream") {
        if (a.inc !== b.inc) return null;
        if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
        return a.seq === b.seq ? 0 : a.seq < b.seq ? -1 : 1;
    }
    if (a.kind === "ring" && b.kind === "ring" && a.epoch === b.epoch) {
        return a.seq === b.seq ? 0 : a.seq < b.seq ? -1 : 1;
    }
    return null;
}

export function compareCursors(a: string, b: string): number | null {
    const pa = parseCursor(a);
    const pb = parseCursor(b);
    return pa && pb ? compareParsedCursors(pa, pb) : null;
}
