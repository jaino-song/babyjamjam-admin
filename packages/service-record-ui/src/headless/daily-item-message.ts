import { hasDisplayValue, type DailyItem, type ServiceRecordNumericErrors } from "../form-definition";
import {
    FIELD_COPY,
    requiredChoiceCopy,
    requiredInputCopy,
    shortItemLabel,
    textCounterCopy,
    textLimitCopy,
    type SlotMessage,
} from "../field-messages";
import { errorMessage, hintMessage } from "./messages";

const COUNT_DISPLAY_LABEL: Record<string, string> = { "회당": "회당 용량" };

export interface DailyItemMessageOptions {
    /** The user already pressed the page's next button with this page incomplete. */
    submitted: boolean;
    /** Public employee forms require every answer; administrator drafts may leave answers blank. */
    requireAnswers: boolean;
    readOnly: boolean;
    /** The textarea currently has focus (shows the character counter before any text). */
    textFocused: boolean;
    numericErrors: ServiceRecordNumericErrors;
    /**
     * Precomputed "ever held a value" flags (see `useHadValue`). `counts` is keyed by the
     * full field key, `${item.key}_${count.k}`, the same key the draft uses.
     */
    had: { main: boolean; color: boolean; counts: Record<string, boolean> };
}

export interface DailyItemMessages {
    message: SlotMessage | null;
    /** Full field keys (`${item.key}_${count.k}`) of counts that currently show a problem. */
    invalidCountKeys: Set<string>;
    stoolColorMessage: SlotMessage | null;
}

/** Pure: which message a daily item's slot (and its stool colour sub-field) shows. */
export function getDailyItemMessages(
    item: DailyItem,
    draft: Record<string, unknown>,
    opts: DailyItemMessageOptions,
): DailyItemMessages {
    const { submitted, requireAnswers, readOnly, textFocused, numericErrors, had } = opts;
    const value = draft[item.key];
    const label = shortItemLabel(item.label);

    let message: SlotMessage | null = null;
    const invalidCountKeys = new Set<string>();
    if (item.type === "multi") {
        const empty = !Array.isArray(value) || value.filter(hasDisplayValue).length === 0;
        if (requireAnswers && empty) {
            message = had.main || submitted ? errorMessage(requiredChoiceCopy(label)) : hintMessage(FIELD_COPY.multiHint);
        }
    } else if (item.type === "radio" || item.type === "stool") {
        if (requireAnswers && !hasDisplayValue(value) && (had.main || submitted)) message = errorMessage(requiredChoiceCopy(label));
    } else if (item.type === "counts") {
        const counts = item.counts ?? [];
        for (const count of counts) {
            const fieldKey = `${item.key}_${count.k}`;
            const numericError = numericErrors[fieldKey];
            let countMessage: SlotMessage | null = null;
            if (numericError) {
                countMessage = errorMessage(counts.length > 1 ? `${count.label}: ${numericError}` : numericError);
            } else if (requireAnswers && !hasDisplayValue(draft[fieldKey]) && (Boolean(had.counts[fieldKey]) || submitted)) {
                countMessage = errorMessage(requiredInputCopy(COUNT_DISPLAY_LABEL[count.label] ?? count.label));
            }
            if (!countMessage) continue;
            invalidCountKeys.add(fieldKey);
            message ??= countMessage;
        }
    } else if (item.type === "textarea") {
        const length = typeof value === "string" ? value.length : 0;
        if (!readOnly && item.maxLength !== undefined) {
            if (length > item.maxLength) message = errorMessage(textLimitCopy(item.maxLength));
            else if (length > 0 || textFocused) message = hintMessage(textCounterCopy(length, item.maxLength));
        }
    } else if (item.type === "confirm") {
        if (requireAnswers && !value && (had.main || submitted)) message = errorMessage(FIELD_COPY.paymentConfirm);
    }

    let stoolColorMessage: SlotMessage | null = null;
    if (item.type === "stool") {
        const colorEmpty = !hasDisplayValue(draft[`${item.key}_color`]);
        stoolColorMessage = requireAnswers && colorEmpty && (had.color || submitted) ? errorMessage(FIELD_COPY.stoolColor) : null;
    }

    return { message, invalidCountKeys, stoolColorMessage };
}
