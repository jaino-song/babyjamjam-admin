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
 * Field list of one stream entry. `b` (branch) is present only for a scoped batch: a broadcast
 * (`branchId: null`) omits it, so an empty-string branch and "no branch" can never be confused.
 */
export function encodeBatchFields(event: EntityChangedEvent): string[] {
    const fields: string[] = [];
    if (event.branchId !== null) fields.push("b", event.branchId);
    fields.push("e", JSON.stringify(event.entities));
    return fields;
}

/** The inverse, strict: anything unexpected makes the whole entry unusable (`null`) rather than guessed at. */
export function decodeBatchFields(cursor: string, fields: string[]): DeliveredBatch | null {
    if (fields.length % 2 !== 0) return null;
    let branchId: string | null = null;
    let sawBranch = false;
    let entities: EntityChangeKind[] | null = null;
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
        } else {
            return null;
        }
    }
    if (entities === null) return null;
    return { type: "batch", cursor, branchId, entities };
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
