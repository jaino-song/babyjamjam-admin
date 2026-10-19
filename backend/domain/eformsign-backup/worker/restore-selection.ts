import { parseCompletionName } from "./archive-paths";
import { completionContentDigest, completionSchema, type Completion } from "./archive-records";

/** A completion file as read from `completions/`: its name and its parsed JSON. No timestamps are part of it. */
export interface CompletionFileEntry {
    name: string;
    content: unknown;
}

/** Restore is always for one company: a completion of any other company is never selected. */
export type RestoreQuery = { companyId: string; snapshotId: string } | { companyId: string; latest: true };

export interface SelectedCompletion {
    name: string;
    sequence: number;
    contentDigest: string;
    completion: Completion;
}

export type QuarantineReason =
    | "name-invalid" | "content-invalid" | "sequence-mismatch" | "digest-mismatch" | "company-mismatch" | "conflict";
export interface QuarantinedEntry {
    name: string;
    reason: QuarantineReason;
}

export type CompletionSelection =
    | { kind: "selected"; entry: SelectedCompletion; quarantined: QuarantinedEntry[] }
    | { kind: "none"; quarantined: QuarantinedEntry[] }
    | { kind: "conflict"; names: string[]; quarantined: QuarantinedEntry[] };

function validate(entry: CompletionFileEntry, companyId: string): SelectedCompletion | QuarantineReason {
    const parsedName = parseCompletionName(entry.name);
    if (!parsedName) return "name-invalid";
    const content = completionSchema.safeParse(entry.content);
    if (!content.success) return "content-invalid";
    if (content.data.sequence !== parsedName.sequence) return "sequence-mismatch";
    if (completionContentDigest(content.data) !== parsedName.contentDigest) return "digest-mismatch";
    if (content.data.companyId !== companyId) return "company-mismatch";
    return {
        name: entry.name, sequence: parsedName.sequence, contentDigest: parsedName.contentDigest, completion: content.data,
    };
}

function conflict(group: SelectedCompletion[], quarantined: QuarantinedEntry[]): CompletionSelection {
    const names = group.map((entry) => entry.name).sort();
    return { kind: "conflict", names, quarantined: [...quarantined, ...names.map((name) => ({ name, reason: "conflict" as const }))] };
}

/**
 * Contract §6 "3.1": a file is valid only when its name (sequence, digest) matches its content. A snapshot query
 * returns that snapshot's completion; `latest` returns the valid completion with the highest sequence. Two valid
 * completions that cannot both be right (same snapshot with different content, or one sequence with two digests)
 * are a `conflict` and nothing is selected.
 */
export function selectCompletion(entries: readonly CompletionFileEntry[], query: RestoreQuery): CompletionSelection {
    const valid: SelectedCompletion[] = [];
    const quarantined: QuarantinedEntry[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);
        const result = validate(entry, query.companyId);
        if (typeof result === "string") quarantined.push({ name: entry.name, reason: result });
        else valid.push(result);
    }
    if ("snapshotId" in query) {
        const matches = valid.filter((entry) => entry.completion.snapshotId === query.snapshotId);
        if (matches.length === 0) return { kind: "none", quarantined };
        if (matches.length > 1) return conflict(matches, quarantined);
        return { kind: "selected", entry: matches[0]!, quarantined };
    }
    if (valid.length === 0) return { kind: "none", quarantined };
    const top = Math.max(...valid.map((entry) => entry.sequence));
    const atTop = valid.filter((entry) => entry.sequence === top);
    if (atTop.length > 1) return conflict(atTop, quarantined);
    return { kind: "selected", entry: atTop[0]!, quarantined };
}
