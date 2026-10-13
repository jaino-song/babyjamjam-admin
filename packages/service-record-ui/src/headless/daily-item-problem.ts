import {
    hasDisplayValue,
    isDailyItemComplete,
    type DailyItem,
    type ServiceRecordNumericErrors,
} from "../form-definition";

/** UI-agnostic description of the first control that keeps a daily item from being complete. */
export type DailyItemProblem =
    | { kind: "textarea" }
    /** `countKey` is the count's own key (`count.k`), not the full draft key. */
    | { kind: "count"; countKey: string }
    | { kind: "stoolColor" }
    | { kind: "option" };

export function getDailyItemProblem(
    item: DailyItem,
    draft: Record<string, unknown>,
    numericErrors: ServiceRecordNumericErrors,
): DailyItemProblem | null {
    if (item.type === "textarea") {
        const text = draft[item.key];
        return item.maxLength !== undefined && typeof text === "string" && text.length > item.maxLength
            ? { kind: "textarea" } : null;
    }
    if (item.type === "counts") {
        const count = (item.counts ?? []).find((candidate) => (
            !hasDisplayValue(draft[`${item.key}_${candidate.k}`]) || numericErrors[`${item.key}_${candidate.k}`]
        ));
        return count ? { kind: "count", countKey: count.k } : null;
    }
    if (isDailyItemComplete(item, draft)) return null;
    if (item.type === "stool" && hasDisplayValue(draft[item.key])) return { kind: "stoolColor" };
    return { kind: "option" };
}
