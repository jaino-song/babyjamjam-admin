import type { EntityChangedEvent, EntityChangeKind } from "application/services/entity-change-event-bus.service";
import type { DeliveredBatch } from "./entity-change-transport";

/** Same closed set as `EntityChangeKind`; the `Record` makes adding a kind without listing it a type error. */
const KNOWN_KINDS: Record<EntityChangeKind, true> = {
    client: true,
    employee: true,
    document: true,
    message: true,
    "service-record": true,
    inquiry: true,
    call: true,
    file: true,
    holiday: true,
    settings: true,
    notification: true,
};

/**
 * Field list of one stream entry (the settle script appends `g`, see below). `b` (branch) is
 * present only for a scoped batch: a broadcast (`branchId: null`) omits it, so an empty-string
 * branch and "no branch" can never be confused.
 */
export function encodeBatchFields(event: EntityChangedEvent): string[] {
    const fields: string[] = [];
    if (event.branchId !== null) fields.push("b", event.branchId);
    fields.push("e", JSON.stringify(event.entities));
    return fields;
}

const INCARNATION = /^[0-9a-f]{16}$/;

export interface StreamEntry {
    branchId: string | null;
    entities: EntityChangeKind[];
    /**
     * `g`: the stream incarnation this transport stamped on the entry when it wrote it. It is the
     * evidence that an entry belongs to the history a cursor was issued in; entries written before
     * `g` existed, or by anything but this transport, have none (`null`) and prove nothing. The
     * first deploy therefore treats the pre-existing tail as unproven (see `base` in the settle
     * script, which keeps that from costing a spurious refresh).
     */
    incarnation: string | null;
}

/**
 * The incarnation an entry claims, whatever else is wrong with it (exactly one well-formed `g`, else
 * `null`). Replay and the reader use it as evidence of origin, independently of whether the body decodes.
 */
export function entryIncarnation(fields: string[]): string | null {
    let found: string | null = null;
    for (let i = 0; i + 1 < fields.length; i += 2) {
        if (fields[i] !== "g") continue;
        if (found !== null) return null;
        found = INCARNATION.test(fields[i + 1] as string) ? (fields[i + 1] as string) : null;
        if (found === null) return null;
    }
    return found;
}

/** Strict reader of one entry: anything unexpected makes the whole entry unusable (`null`) rather than guessed at. */
export function decodeStreamEntry(fields: string[]): StreamEntry | null {
    if (fields.length % 2 !== 0) return null;
    let branchId: string | null = null;
    let sawBranch = false;
    let entities: EntityChangeKind[] | null = null;
    let incarnation: string | null = null;
    for (let i = 0; i < fields.length; i += 2) {
        const name = fields[i];
        const value = fields[i + 1] as string;
        if (name === "b") {
            if (sawBranch) return null;
            sawBranch = true;
            branchId = value;
        } else if (name === "e") {
            if (entities !== null) return null;
            entities = parseKinds(value);
            if (entities === null) return null;
        } else if (name === "g") {
            if (incarnation !== null || !INCARNATION.test(value)) return null;
            incarnation = value;
        } else {
            return null;
        }
    }
    if (entities === null) return null;
    return { branchId, entities, incarnation };
}

export function decodeBatchFields(cursor: string, fields: string[]): DeliveredBatch | null {
    const entry = decodeStreamEntry(fields);
    return entry ? { type: "batch", cursor, branchId: entry.branchId, entities: entry.entities } : null;
}

function parseKinds(raw: string): EntityChangeKind[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    for (const kind of parsed) {
        if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(KNOWN_KINDS, kind)) return null;
    }
    return parsed as EntityChangeKind[];
}
