import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isCompletedContractSignal, type LatestContractSignal } from "application/utils/current-contract-document";

export const CLIENT_NOTE_KIND = {
    CONTRACT_INFO_MISMATCH: "contract_info_mismatch",
} as const;

export const CLIENT_NOTE_STATUS = {
    OPEN: "open",
    RESOLVED: "resolved",
} as const;

export const CLIENT_NOTE_RESOLVED_REASON = {
    /** Every changed field was set back to the value on the contract. */
    VALUES_RESTORED: "values_restored",
    /** A newer contract replaced the one the note was about. */
    CONTRACT_REPLACED: "contract_replaced",
} as const;

/**
 * The client fields that are written into the eformsign contract. Changing one of
 * them after the contract is completed leaves the contract out of date, because a
 * completed contract can no longer be changed.
 */
export const CONTRACT_INFO_FIELDS = [
    "name",
    "phone",
    "address",
    "birthday",
    "startDate",
    "endDate",
    "duration",
    "fullPrice",
    "grant",
    "actualPrice",
] as const;

export type ContractInfoField = (typeof CONTRACT_INFO_FIELDS)[number];

export type ContractInfoSnapshot = {
    [field in ContractInfoField]?: string | number | Date | null;
};

export interface ContractInfoChange {
    field: ContractInfoField;
    /** The value when the contract was completed (the client value before the first change). */
    contractValue: string | null;
    /** The client's current value. */
    clientValue: string | null;
}

const PRICE_FIELDS: ReadonlySet<ContractInfoField> = new Set(["fullPrice", "grant", "actualPrice"]);
const DATE_FIELDS: ReadonlySet<ContractInfoField> = new Set(["startDate", "endDate"]);

/** Comparable text for one contract field, so formatting alone never counts as a change. */
export function normalizeContractInfoValue(field: ContractInfoField, value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    }
    const text = String(value).trim();
    if (text === "") return null;
    if (DATE_FIELDS.has(field)) return text.slice(0, 10);
    if (PRICE_FIELDS.has(field)) {
        const digits = text.replace(/[^0-9-]/g, "");
        return digits === "" ? null : digits;
    }
    return text;
}

/**
 * Folds one client edit into the changes an open note already holds. The contract
 * value of a field is the value before its first change and never moves; a field
 * that is set back to its contract value leaves the list.
 */
export function mergeContractInfoChanges(
    existing: readonly ContractInfoChange[],
    before: ContractInfoSnapshot,
    after: ContractInfoSnapshot,
): ContractInfoChange[] {
    const merged = new Map<ContractInfoField, ContractInfoChange>(
        existing.map((change) => [change.field, { ...change }]),
    );
    for (const field of CONTRACT_INFO_FIELDS) {
        const beforeValue = normalizeContractInfoValue(field, before[field]);
        const afterValue = normalizeContractInfoValue(field, after[field]);
        if (beforeValue === afterValue) continue;
        const current = merged.get(field);
        if (current) {
            current.clientValue = afterValue;
        } else {
            merged.set(field, { field, contractValue: beforeValue, clientValue: afterValue });
        }
    }
    return CONTRACT_INFO_FIELDS
        .map((field) => merged.get(field))
        .filter((change): change is ContractInfoChange => (
            change !== undefined && change.contractValue !== change.clientValue
        ));
}

function parseStoredChanges(value: unknown): ContractInfoChange[] {
    if (!Array.isArray(value)) return [];
    const fields = new Set<string>(CONTRACT_INFO_FIELDS);
    return value.flatMap((entry): ContractInfoChange[] => {
        if (!entry || typeof entry !== "object") return [];
        const { field, contractValue, clientValue } = entry as Record<string, unknown>;
        if (typeof field !== "string" || !fields.has(field)) return [];
        return [{
            field: field as ContractInfoField,
            contractValue: typeof contractValue === "string" ? contractValue : null,
            clientValue: typeof clientValue === "string" ? clientValue : null,
        }];
    });
}

type ClientNoteDelegateClient = Pick<Prisma.TransactionClient, "client_note">;

function hasClientNoteDelegate(prisma: unknown): prisma is ClientNoteDelegateClient {
    const delegate = (prisma as Partial<ClientNoteDelegateClient> | null | undefined)?.client_note;
    return typeof delegate?.findFirst === "function"
        && typeof delegate?.findMany === "function"
        && typeof delegate?.create === "function"
        && typeof delegate?.update === "function";
}

@Injectable()
export class ClientNoteService {
    /**
     * Records a client edit against the client's completed contract. Call it inside
     * the client write transaction, after the client row is updated. It does nothing
     * unless the latest contract is completed and a contract field changed.
     */
    async recordContractInfoChangeInTransaction(
        transaction: Prisma.TransactionClient,
        params: {
            branchId: string;
            clientId: number;
            latestContract: LatestContractSignal | undefined;
            before: ContractInfoSnapshot;
            after: ContractInfoSnapshot;
            actorUserId?: string | null;
        },
    ): Promise<void> {
        if (!hasClientNoteDelegate(transaction)) return;
        const edits = mergeContractInfoChanges([], params.before, params.after);
        if (edits.length === 0) return;
        const contract = params.latestContract;
        if (!contract || !isCompletedContractSignal(contract)) return;

        const openNote = await transaction.client_note.findFirst({
            where: {
                clientId: params.clientId,
                kind: CLIENT_NOTE_KIND.CONTRACT_INFO_MISMATCH,
                status: CLIENT_NOTE_STATUS.OPEN,
            },
            select: { id: true, contractDocumentId: true, changes: true },
        });

        const sameContract = openNote?.contractDocumentId === contract.documentId;
        if (openNote && !sameContract) {
            // The open note was about an older contract; this edit starts a new one.
            await this.resolve(transaction, openNote.id, CLIENT_NOTE_RESOLVED_REASON.CONTRACT_REPLACED, params.actorUserId);
        }
        const existing = openNote && sameContract ? parseStoredChanges(openNote.changes) : [];
        const changes = mergeContractInfoChanges(existing, params.before, params.after);

        if (openNote && sameContract) {
            if (changes.length === 0) {
                await this.resolve(transaction, openNote.id, CLIENT_NOTE_RESOLVED_REASON.VALUES_RESTORED, params.actorUserId);
                return;
            }
            await transaction.client_note.update({
                where: { id: openNote.id },
                data: { changes: changes as unknown as Prisma.InputJsonValue },
            });
            return;
        }
        if (changes.length === 0) return;
        await transaction.client_note.create({
            data: {
                branchId: params.branchId,
                clientId: params.clientId,
                kind: CLIENT_NOTE_KIND.CONTRACT_INFO_MISMATCH,
                status: CLIENT_NOTE_STATUS.OPEN,
                contractDocumentId: contract.documentId,
                changes: changes as unknown as Prisma.InputJsonValue,
                createdBy: params.actorUserId ?? null,
            },
        });
    }

    /**
     * Client ids whose open contract-info note is about their current, completed
     * contract. A note about an older contract does not count, so a new contract
     * turns the flag off without any write.
     */
    async findContractInfoMismatchClientIds(
        prisma: unknown,
        latestContractByClientId: ReadonlyMap<number, LatestContractSignal>,
    ): Promise<Set<number>> {
        const flagged = new Set<number>();
        if (!hasClientNoteDelegate(prisma) || latestContractByClientId.size === 0) return flagged;
        const notes = await prisma.client_note.findMany({
            where: {
                clientId: { in: [...latestContractByClientId.keys()] },
                kind: CLIENT_NOTE_KIND.CONTRACT_INFO_MISMATCH,
                status: CLIENT_NOTE_STATUS.OPEN,
            },
            select: { clientId: true, contractDocumentId: true },
        });
        for (const note of notes) {
            const contract = latestContractByClientId.get(note.clientId);
            if (contract && isCompletedContractSignal(contract) && note.contractDocumentId === contract.documentId) {
                flagged.add(note.clientId);
            }
        }
        return flagged;
    }

    private async resolve(
        transaction: ClientNoteDelegateClient,
        noteId: string,
        reason: string,
        actorUserId?: string | null,
    ): Promise<void> {
        await transaction.client_note.update({
            where: { id: noteId },
            data: {
                status: CLIENT_NOTE_STATUS.RESOLVED,
                resolvedAt: new Date(),
                resolvedBy: actorUserId ?? null,
                resolvedReason: reason,
            },
        });
    }
}
