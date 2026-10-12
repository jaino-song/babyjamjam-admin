import {
    DAILY_ITEMS,
    type DailyItem,
    type ServiceRecordNumericErrors,
} from "../form-definition";
import { getDailyItemProblem, type DailyItemProblem } from "./daily-item-problem";

export type DayPageProblem =
    | { kind: "serviceDate" }
    | { kind: "item"; item: DailyItem; problem: DailyItemProblem };

/** First thing that blocks "next" on a day page: the service date, then the first unfinished item. */
export function getFirstDayPageProblem(
    pageItemIndexes: readonly number[],
    draft: Record<string, unknown>,
    numericErrors: ServiceRecordNumericErrors,
    { serviceDateBlocked, serviceDateFieldVisible }: { serviceDateBlocked: boolean; serviceDateFieldVisible: boolean },
): DayPageProblem | null {
    if (serviceDateFieldVisible && serviceDateBlocked) return { kind: "serviceDate" };
    for (const index of pageItemIndexes) {
        const item = DAILY_ITEMS[index];
        if (!item) continue;
        const problem = getDailyItemProblem(item, draft, numericErrors);
        if (problem) return { kind: "item", item, problem };
    }
    return null;
}

export function hasInvalidTextAnswers(draft: Record<string, unknown>): boolean {
    return DAILY_ITEMS.some((item) => item.type === "textarea"
        && item.maxLength !== undefined && typeof draft[item.key] === "string"
        && (draft[item.key] as string).length > item.maxLength);
}

export function hasInvalidNumericAnswersOnPage(
    pageItemIndexes: readonly number[],
    numericErrors: ServiceRecordNumericErrors,
): boolean {
    return pageItemIndexes.some((index) => {
        const item = DAILY_ITEMS[index];
        return item?.type === "counts"
            && (item.counts ?? []).some((count) => numericErrors[`${item.key}_${count.k}`]);
    });
}
