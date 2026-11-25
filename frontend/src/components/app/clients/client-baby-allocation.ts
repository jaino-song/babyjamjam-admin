import {
    PROVIDER_SLOT_LABELS,
    resolveBabyRecordAllocation,
    type BabyRecordAllocation,
    type BabyRecordAssignment,
    type ExistingBaby,
    type FetalType,
    type ProviderSlot,
} from "@babyjamjam/shared";
import type { Client, ClientAllocationWrite, ClientProvider } from "@/features/clients/types";
import { type Locale, t } from "@/lib/i18n/translations";

export const CLIENT_PROVIDER_SLOTS = [0, 1, 2, 3] as const;
export const CLIENT_PROVIDER_FIELDS = ["primaryEmployeeId", "secondaryEmployeeId", "provider-2", "provider-3"] as const;
// Each baby requires a serialized assignment. Beyond this lower bound the full body
// cannot fit within the API's 1 MiB JSON parser limit, even with the shortest rows.
export const MAX_CLIENT_BABY_COUNT = Math.floor(1024 * 1024 / ('{"ordinal":1,"providerSlot":0},'.length));
export type ClientProviderField = typeof CLIENT_PROVIDER_FIELDS[number];
export type ClientBabyField = `baby-${string}`;
export type ClientProviderIds = Record<ProviderSlot, number | null>;

export interface ClientBabyDraft {
    fetalType: FetalType | null;
    count: string;
    extraProviders: Pick<ClientProviderIds, 2 | 3>;
    owners: Partial<Record<ClientBabyField, ProviderSlot>>;
}

export function babyField(baby: { babyId?: string | null; ordinal?: number }): ClientBabyField {
    return `baby-${baby.babyId ?? baby.ordinal}`;
}

export function openClientBabyDraft(client?: Client | null): ClientBabyDraft {
    const fetalType = client?.fetalConfirmation === "CONFIRMED" ? client.fetalType ?? null : null;
    const hasExplicitCount = fetalType === "SEVERE_TRIPLETS_PLUS" || fetalType === "QUADRUPLETS_PLUS";
    return {
        fetalType,
        count: hasExplicitCount && client?.babyCount != null ? String(client.babyCount) : "",
        extraProviders: {
            2: client?.providers?.find(({ slot }) => slot === 2)?.employeeId ?? null,
            3: client?.providers?.find(({ slot }) => slot === 3)?.employeeId ?? null,
        },
        owners: Object.fromEntries((client?.babyAssignments ?? []).flatMap((row) =>
            row.providerSlot === null ? [] : [[babyField(row), row.providerSlot]],
        )),
    };
}

export function listClientProviders(ids: ClientProviderIds, capacity: number): ClientProvider[] {
    return CLIENT_PROVIDER_SLOTS.flatMap((slot) => {
        const employeeId = ids[slot];
        return slot < capacity && employeeId !== null ? [{ slot, employeeId }] : [];
    });
}

export interface ClientBabyRow extends BabyRecordAssignment {
    field: ClientBabyField;
    needsReplacement: boolean;
}

export function getClientBabyRows(
    allocation: BabyRecordAllocation,
    owners: ClientBabyDraft["owners"],
): ClientBabyRow[] {
    if (allocation.status !== "resolved") return [];

    return Array.from({ length: allocation.babyCount }, (_, index) => {
        const assignment = allocation.assignmentAtRank(index + 1)!;
        const field = babyField(assignment);
        const preferred = owners[field];
        // Fixed primary follows slot 0, including when its employee changes.
        const isFixedPrimary = !assignment.canChangeProvider && preferred === 0;
        const needsReplacement = preferred !== undefined && !isFixedPrimary &&
            !assignment.availableProviderSlots.includes(preferred);
        const providerSlot = needsReplacement ? null
            : preferred === undefined || isFixedPrimary ? assignment.providerSlot : preferred;
        return {
            ...assignment,
            field,
            needsReplacement,
            providerSlot,
            employeeId: providerSlot === null ? null : allocation.providerSlots[providerSlot].employeeId,
        };
    });
}

export function resolveClientBabyDraft({
    type, year, catalogCodes, draft, ids, babies, historicalMaxOrdinal,
}: {
    type: string;
    year: number;
    catalogCodes: readonly string[];
    draft: ClientBabyDraft;
    ids: ClientProviderIds;
    babies: readonly ExistingBaby[];
    historicalMaxOrdinal: number | undefined;
}) {
    const voucher = { service: "voucher", mode: "submission", code: type, issuanceYear: year, catalog: { [year]: catalogCodes } } as const;
    const { rules } = resolveBabyRecordAllocation(voucher);
    const option = rules?.fetalTypeOptions.find(({ fetalType }) => fetalType ===
        (rules.voucher.family === "A" ? "SINGLETON" : draft.fetalType));
    const minimumCount = option && "minimumBabyCount" in option ? option.minimumBabyCount : undefined;
    const babyCount = option && "babyCount" in option ? option.babyCount
        : minimumCount !== undefined && /^\d+$/.test(draft.count) ? Number(draft.count) : undefined;
    const exceedsRequestLimit = babyCount !== undefined && babyCount > MAX_CLIENT_BABY_COUNT;
    const retained = babyCount === undefined || exceedsRequestLimit ? babies.length : Math.min(babies.length, babyCount);
    const providers = listClientProviders(ids, rules?.providerCapacity ?? 0);
    const allocation = resolveBabyRecordAllocation({
        ...voucher,
        fetalType: option?.fetalType,
        babyCount: exceedsRequestLimit ? undefined : babyCount,
        providers,
        babies: [...babies].sort((left, right) => left.ordinal - right.ordinal).slice(0, retained),
        historicalMaxOrdinal,
    });
    const rows = getClientBabyRows(allocation, draft.owners);
    const payload: ClientAllocationWrite | undefined = allocation.status === "resolved" &&
        rows.every(({ needsReplacement }) => !needsReplacement) ? {
            fetalType: allocation.fetalType,
            babyCount: allocation.babyCount,
            providers,
            voucherIssuanceYear: year,
            babyAssignments: rows.map(({ babyId, ordinal, providerSlot }) =>
                babyId === null ? { ordinal, providerSlot } : { babyId, providerSlot }),
        } : undefined;
    return { rules, option, minimumCount, exceedsRequestLimit, allocation, providers, rows, payload, retiringCount: babies.length - retained };
}

export function clientProviderLabel(slot: ProviderSlot, locale: Locale): string {
    if (locale === "ko") return PROVIDER_SLOT_LABELS[slot];
    return slot === 0 ? t(locale, "clients.form.baby-record.primary-provider")
        : t(locale, "clients.form.baby-record.secondary-provider").replace("{slot}", String(slot));
}
