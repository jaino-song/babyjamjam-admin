import type { UpdateClientDto } from "@/features/clients/types";
import type { EformsignLinkConfirmation } from "@/services/eformsign";

/**
 * Pure logic behind the "연결 확인 필요" comparison (S3 / 계약-05): which items a person has to
 * decide, when 확정 may be pressed, and what is written to the client. Kept free of React so
 * every combination can be tested without rendering.
 */

/** Query keys shared by the contract section and the confirm dialog. */
export const clientContractDocsQueryKey = (clientId: number) => ["eformsign-docs", "client", clientId] as const;
export const linkConfirmationsQueryKey = (clientId: number) =>
    ["eformsign-docs", "link-confirmations", clientId] as const;

export type LinkConfirmField = "name" | "birthday";
export type LinkConfirmSide = "contract" | "client";
export type LinkConfirmChoices = Partial<Record<LinkConfirmField, LinkConfirmSide>>;

export interface LinkConfirmRow {
    field: LinkConfirmField;
    label: string;
    /** The signer's value on the contract, or null when the contract has none. */
    contractValue: string | null;
    /** The client's stored value, or null when the client has none. */
    clientValue: string | null;
    /** Sides that hold a value and so can be chosen. Empty when both sides are missing. */
    selectableSides: LinkConfirmSide[];
}

type LinkConfirmEntry = Pick<EformsignLinkConfirmation, "document" | "client" | "differences">;

export const LINK_CONFIRM_FIELD_LABELS: Record<LinkConfirmField, string> = {
    name: "이름",
    birthday: "생년월일",
};

const FIELD_ORDER: readonly LinkConfirmField[] = ["name", "birthday"];

function presentValue(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

/** One row per differing item, in the fixed order name then birthday. */
export function buildLinkConfirmRows(entry: LinkConfirmEntry): LinkConfirmRow[] {
    return FIELD_ORDER.filter((field) => entry.differences.includes(field)).map((field) => {
        const contractValue = presentValue(field === "name" ? entry.document.name : entry.document.birthday);
        const clientValue = presentValue(field === "name" ? entry.client.name : entry.client.birthday);
        const selectableSides: LinkConfirmSide[] = [];
        if (contractValue !== null) selectableSides.push("contract");
        if (clientValue !== null) selectableSides.push("client");
        return {
            field,
            label: LINK_CONFIRM_FIELD_LABELS[field],
            contractValue,
            clientValue,
            selectableSides,
        };
    });
}

/** The differing items in words, for the pending entry in the contract section. */
export function describeLinkConfirmDifferences(differences: readonly LinkConfirmField[]): string {
    const hasName = differences.includes("name");
    const hasBirthday = differences.includes("birthday");
    if (hasName && hasBirthday) return "이름과 생년월일이 다릅니다";
    if (hasName) return "이름이 다릅니다";
    if (hasBirthday) return "생년월일이 다릅니다";
    return "";
}

function chosenSide(row: LinkConfirmRow, choices: LinkConfirmChoices): LinkConfirmSide | null {
    const side = choices[row.field];
    return side && row.selectableSides.includes(side) ? side : null;
}

/**
 * 확정 is enabled only when every row that has at least one selectable value has a choice.
 * No rows at all is outside the contract (differences is never empty), so it is not ready.
 */
export function isLinkConfirmReady(rows: readonly LinkConfirmRow[], choices: LinkConfirmChoices): boolean {
    if (rows.length === 0) return false;
    return rows.every((row) => row.selectableSides.length === 0 || chosenSide(row, choices) !== null);
}

/**
 * The client fields to write: only the items where the contract's value was chosen. Choosing the
 * client's values changes nothing, so the result is then empty and no update is sent.
 */
export function buildContractChoiceClientPatch(
    rows: readonly LinkConfirmRow[],
    choices: LinkConfirmChoices,
): UpdateClientDto {
    const patch: UpdateClientDto = {};
    for (const row of rows) {
        if (chosenSide(row, choices) !== "contract" || row.contractValue === null) continue;
        if (row.field === "name") patch.name = row.contractValue;
        else patch.birthday = row.contractValue;
    }
    return patch;
}
