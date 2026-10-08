import { renderHook } from "@testing-library/react";
import * as packageIndex from "../../../packages/service-record-ui/src";
import {
    DAILY_ITEMS,
    DAY_PAGES,
    type DailyItem,
} from "../../../packages/service-record-ui/src/form-definition";
import {
    FIELD_COPY,
    requiredChoiceCopy,
    requiredInputCopy,
    shortItemLabel,
    textCounterCopy,
    textLimitCopy,
} from "../../../packages/service-record-ui/src/field-messages";
import type { ServiceRecordContext } from "../../../packages/service-record-ui/src/types";
import {
    HEADER_DATE_KEYS,
    firstHeaderProblemKey,
    focusFirstProblem,
    getDailyItemMessages,
    getDailyItemProblem,
    getFirstDayPageProblem,
    getHeaderFieldMessage,
    getPhoneState,
    getServiceDateMessage,
    getServiceDateMin,
    getWizardProgress,
    hasInvalidNumericAnswersOnPage,
    hasInvalidTextAnswers,
    resolveHeaderErrors,
    resolvePlannedDates,
    useHadValue,
    type DailyItemMessageOptions,
} from "../../../packages/service-record-ui/src/headless";

const item = (key: string): DailyItem => {
    const found = DAILY_ITEMS.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`unknown daily item ${key}`);
    return found;
};

const NO_HAD = { main: false, color: false, counts: {} as Record<string, boolean> };
const messageOpts = (overrides: Partial<DailyItemMessageOptions> = {}): DailyItemMessageOptions => ({
    submitted: false,
    requireAnswers: true,
    readOnly: false,
    textFocused: false,
    numericErrors: {},
    had: NO_HAD,
    ...overrides,
});

/** Wires `useHadValue` and `getDailyItemMessages` exactly the way `DailyField` does. */
function useDailyFieldMessages(
    dailyItem: DailyItem,
    draft: Record<string, unknown>,
    extra: Partial<DailyItemMessageOptions> = {},
) {
    const track = useHadValue();
    const main = track(dailyItem.key, draft[dailyItem.key]);
    const color = track(`${dailyItem.key}_color`, draft[`${dailyItem.key}_color`]);
    const counts: Record<string, boolean> = {};
    for (const count of dailyItem.counts ?? []) {
        const fieldKey = `${dailyItem.key}_${count.k}`;
        counts[fieldKey] = track(fieldKey, draft[fieldKey]);
    }
    return getDailyItemMessages(dailyItem, draft, messageOpts({ ...extra, had: { main, color, counts } }));
}

describe("package index", () => {
    it("re-exports the headless functions", () => {
        for (const name of [
            "focusFirstProblem", "useHadValue", "getDailyItemMessages", "getDailyItemProblem",
            "resolveHeaderErrors", "getHeaderFieldMessage", "firstHeaderProblemKey", "HEADER_DATE_KEYS",
            "getPhoneState", "resolvePlannedDates", "getServiceDateMessage", "getServiceDateMin",
            "getWizardProgress", "getFirstDayPageProblem", "hasInvalidTextAnswers", "hasInvalidNumericAnswersOnPage",
        ]) {
            expect((packageIndex as Record<string, unknown>)[name]).toBeDefined();
        }
    });
});

describe("focusFirstProblem", () => {
    afterEach(() => { document.body.replaceChildren(); });

    it("focuses and scrolls the element with the id", () => {
        const input = document.createElement("input");
        input.id = "target";
        document.body.appendChild(input);
        const scroll = jest.fn();
        input.scrollIntoView = scroll;
        focusFirstProblem("target");
        expect(document.activeElement).toBe(input);
        expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    });

    it("does nothing for an empty id or a missing element", () => {
        expect(() => focusFirstProblem(null)).not.toThrow();
        expect(() => focusFirstProblem(undefined)).not.toThrow();
        expect(() => focusFirstProblem("")).not.toThrow();
        expect(() => focusFirstProblem("missing")).not.toThrow();
    });

    it("focuses even when scrollIntoView is unavailable", () => {
        const input = document.createElement("input");
        input.id = "target";
        document.body.appendChild(input);
        Object.defineProperty(input, "scrollIntoView", { value: undefined });
        focusFirstProblem("target");
        expect(document.activeElement).toBe(input);
    });
});

describe("useHadValue", () => {
    it("is false until a key held a value, then stays true after it is cleared", () => {
        const { result, rerender } = renderHook(({ value }) => {
            const track = useHadValue();
            return track("k", value);
        }, { initialProps: { value: "" as unknown } });
        expect(result.current).toBe(false);
        rerender({ value: "x" });
        expect(result.current).toBe(true);
        rerender({ value: "" });
        expect(result.current).toBe(true);
    });

    it("tracks keys independently", () => {
        const { result } = renderHook(() => {
            const track = useHadValue();
            return [track("a", "x"), track("b", "")] as const;
        });
        expect(result.current).toEqual([true, false]);
    });

    it("does not treat false as a filled value but does treat true as one", () => {
        const { result, rerender } = renderHook(({ value }) => useHadValue()("pay", value), {
            initialProps: { value: false as unknown },
        });
        expect(result.current).toBe(false);
        rerender({ value: true });
        expect(result.current).toBe(true);
        rerender({ value: false });
        expect(result.current).toBe(true);
    });

    it("treats blank strings, empty arrays and null as not filled", () => {
        const { result } = renderHook(() => {
            const track = useHadValue();
            return [track("s", "  "), track("a", []), track("n", null), track("u", undefined)];
        });
        expect(result.current).toEqual([false, false, false, false]);
    });
});

describe("getDailyItemMessages", () => {
    describe("multi", () => {
        const perineum = item("perineum");
        it("shows the multi hint before any interaction", () => {
            expect(getDailyItemMessages(perineum, {}, messageOpts()).message)
                .toEqual({ tone: "hint", text: FIELD_COPY.multiHint });
        });
        it("shows the required error after the field held a value or after submit", () => {
            const expected = { tone: "error", text: requiredChoiceCopy(shortItemLabel(perineum.label)) };
            expect(getDailyItemMessages(perineum, {}, messageOpts({ had: { ...NO_HAD, main: true } })).message).toEqual(expected);
            expect(getDailyItemMessages(perineum, {}, messageOpts({ submitted: true })).message).toEqual(expected);
        });
        it("treats an array of blanks as empty", () => {
            expect(getDailyItemMessages(perineum, { perineum: [" "] }, messageOpts({ submitted: true })).message?.tone).toBe("error");
        });
        it("shows nothing when answered or when answers are not required", () => {
            expect(getDailyItemMessages(perineum, { perineum: ["이상없음"] }, messageOpts({ submitted: true })).message).toBeNull();
            expect(getDailyItemMessages(perineum, {}, messageOpts({ requireAnswers: false, submitted: true })).message).toBeNull();
        });
    });

    describe("radio and stool", () => {
        it("radio shows nothing before interaction and the required error after", () => {
            const sitz = item("sitzBath");
            const expected = { tone: "error", text: requiredChoiceCopy("좌욕") };
            expect(getDailyItemMessages(sitz, {}, messageOpts()).message).toBeNull();
            expect(getDailyItemMessages(sitz, {}, messageOpts({ had: { ...NO_HAD, main: true } })).message).toEqual(expected);
            expect(getDailyItemMessages(sitz, {}, messageOpts({ submitted: true })).message).toEqual(expected);
            expect(getDailyItemMessages(sitz, { sitzBath: "실시" }, messageOpts({ submitted: true })).message).toBeNull();
            expect(getDailyItemMessages(sitz, {}, messageOpts({ submitted: true, requireAnswers: false })).message).toBeNull();
        });
        it("stool uses the same rule for its main choice", () => {
            const stool = item("stool");
            expect(getDailyItemMessages(stool, {}, messageOpts({ submitted: true })).message)
                .toEqual({ tone: "error", text: requiredChoiceCopy("배변양상") });
        });
    });

    describe("stool colour", () => {
        const stool = item("stool");
        const color = { tone: "error", text: FIELD_COPY.stoolColor };
        it("is hidden before interaction, shown after the colour was held or after submit", () => {
            expect(getDailyItemMessages(stool, { stool: "이상변" }, messageOpts()).stoolColorMessage).toBeNull();
            expect(getDailyItemMessages(stool, { stool: "이상변" }, messageOpts({ had: { ...NO_HAD, color: true } })).stoolColorMessage).toEqual(color);
            expect(getDailyItemMessages(stool, { stool: "이상변" }, messageOpts({ submitted: true })).stoolColorMessage).toEqual(color);
        });
        it("is hidden when filled or when answers are not required", () => {
            expect(getDailyItemMessages(stool, { stool: "이상변", stool_color: "초록" }, messageOpts({ submitted: true })).stoolColorMessage).toBeNull();
            expect(getDailyItemMessages(stool, { stool: "이상변" }, messageOpts({ submitted: true, requireAnswers: false })).stoolColorMessage).toBeNull();
        });
        it("is only produced for the stool item", () => {
            expect(getDailyItemMessages(item("sitzBath"), {}, messageOpts({ submitted: true })).stoolColorMessage).toBeNull();
        });
    });

    describe("counts", () => {
        it("a single count shows its numeric error without a prefix", () => {
            const result = getDailyItemMessages(item("temperature"), {}, messageOpts({ numericErrors: { temperature_temp: "숫자만 입력해 주세요" } }));
            expect(result.message).toEqual({ tone: "error", text: "숫자만 입력해 주세요" });
            expect([...result.invalidCountKeys]).toEqual(["temperature_temp"]);
        });
        it("several counts prefix the numeric error with the count label", () => {
            const result = getDailyItemMessages(item("meals"), { meals_meal: "1", meals_snack: "x" }, messageOpts({ numericErrors: { meals_snack: "숫자만 입력해 주세요" } }));
            expect(result.message).toEqual({ tone: "error", text: "간식: 숫자만 입력해 주세요" });
            expect([...result.invalidCountKeys]).toEqual(["meals_snack"]);
        });
        it("required errors need prior input or submit, and are per count", () => {
            const meals = item("meals");
            const idle = getDailyItemMessages(meals, {}, messageOpts());
            expect(idle.message).toBeNull();
            expect(idle.invalidCountKeys.size).toBe(0);
            const snackHad = getDailyItemMessages(meals, { meals_meal: "1" }, messageOpts({ had: { ...NO_HAD, counts: { meals_snack: true } } }));
            expect(snackHad.message).toEqual({ tone: "error", text: requiredInputCopy("간식") });
            expect([...snackHad.invalidCountKeys]).toEqual(["meals_snack"]);
            const submitted = getDailyItemMessages(meals, {}, messageOpts({ submitted: true }));
            expect([...submitted.invalidCountKeys]).toEqual(["meals_meal", "meals_snack"]);
            expect(submitted.message).toEqual({ tone: "error", text: requiredInputCopy("식사") });
        });
        it("a numeric error wins over the required error and the first problem owns the slot", () => {
            const result = getDailyItemMessages(item("meals"), {}, messageOpts({ submitted: true, numericErrors: { meals_snack: "숫자만 입력해 주세요" } }));
            expect(result.message?.text).toBe(requiredInputCopy("식사"));
            expect(result.invalidCountKeys.has("meals_snack")).toBe(true);
        });
        it("the 회당 count asks for 회당 용량", () => {
            const result = getDailyItemMessages(item("formulaFeeding"), { formulaFeeding_count: "3" }, messageOpts({ submitted: true }));
            expect(result.message).toEqual({ tone: "error", text: requiredInputCopy("회당 용량") });
            expect([...result.invalidCountKeys]).toEqual(["formulaFeeding_ml"]);
        });
        it("shows numeric errors even when answers are not required, but no required errors", () => {
            const optional = messageOpts({ requireAnswers: false, submitted: true });
            expect(getDailyItemMessages(item("temperature"), {}, optional).message).toBeNull();
            expect(getDailyItemMessages(item("temperature"), {}, { ...optional, numericErrors: { temperature_temp: "범위" } }).message)
                .toEqual({ tone: "error", text: "범위" });
        });
    });

    describe("textarea", () => {
        const etc = item("etcService");
        const max = etc.maxLength as number;
        it("shows nothing when empty and unfocused", () => {
            expect(getDailyItemMessages(etc, {}, messageOpts()).message).toBeNull();
        });
        it("shows the counter when focused or non-empty", () => {
            expect(getDailyItemMessages(etc, {}, messageOpts({ textFocused: true })).message)
                .toEqual({ tone: "hint", text: textCounterCopy(0, max) });
            expect(getDailyItemMessages(etc, { etcService: "abc" }, messageOpts()).message)
                .toEqual({ tone: "hint", text: textCounterCopy(3, max) });
        });
        it("shows the limit error over the limit and the counter at the limit", () => {
            expect(getDailyItemMessages(etc, { etcService: "x".repeat(max + 1) }, messageOpts()).message)
                .toEqual({ tone: "error", text: textLimitCopy(max) });
            expect(getDailyItemMessages(etc, { etcService: "x".repeat(max) }, messageOpts()).message?.tone).toBe("hint");
        });
        it("shows nothing when read-only", () => {
            expect(getDailyItemMessages(etc, { etcService: "x".repeat(max + 1) }, messageOpts({ readOnly: true })).message).toBeNull();
        });
        it("ignores a non-string value", () => {
            expect(getDailyItemMessages(etc, { etcService: 5 }, messageOpts()).message).toBeNull();
        });
    });

    describe("confirm", () => {
        const pay = item("paymentConfirmed");
        const expected = { tone: "error", text: FIELD_COPY.paymentConfirm };
        it("needs prior input or submit before the error", () => {
            expect(getDailyItemMessages(pay, { paymentConfirmed: false }, messageOpts()).message).toBeNull();
            expect(getDailyItemMessages(pay, { paymentConfirmed: false }, messageOpts({ had: { ...NO_HAD, main: true } })).message).toEqual(expected);
            expect(getDailyItemMessages(pay, {}, messageOpts({ submitted: true })).message).toEqual(expected);
        });
        it("shows nothing when confirmed or not required", () => {
            expect(getDailyItemMessages(pay, { paymentConfirmed: true }, messageOpts({ submitted: true })).message).toBeNull();
            expect(getDailyItemMessages(pay, {}, messageOpts({ submitted: true, requireAnswers: false })).message).toBeNull();
        });
    });

    describe("as DailyField wires it with useHadValue", () => {
        it("fill then clear a count with submitted=false gives the required error", () => {
            const meals = item("meals");
            const { result, rerender } = renderHook(({ draft }) => useDailyFieldMessages(meals, draft), {
                initialProps: { draft: {} as Record<string, unknown> },
            });
            expect(result.current.message).toBeNull();
            rerender({ draft: { meals_meal: "2" } });
            expect(result.current.message).toBeNull();
            rerender({ draft: { meals_meal: "" } });
            expect(result.current.message).toEqual({ tone: "error", text: requiredInputCopy("식사") });
            expect([...result.current.invalidCountKeys]).toEqual(["meals_meal"]);
        });

        it("fill then clear the stool colour with submitted=false gives the colour error", () => {
            const stool = item("stool");
            const { result, rerender } = renderHook(({ draft }) => useDailyFieldMessages(stool, draft), {
                initialProps: { draft: { stool: "이상변" } as Record<string, unknown> },
            });
            expect(result.current.stoolColorMessage).toBeNull();
            rerender({ draft: { stool: "이상변", stool_color: "초록색" } });
            expect(result.current.stoolColorMessage).toBeNull();
            rerender({ draft: { stool: "이상변", stool_color: "" } });
            expect(result.current.stoolColorMessage).toEqual({ tone: "error", text: FIELD_COPY.stoolColor });
        });

        it("a prefilled main choice that is cleared shows the required error", () => {
            const sitz = item("sitzBath");
            const { result, rerender } = renderHook(({ draft }) => useDailyFieldMessages(sitz, draft), {
                initialProps: { draft: { sitzBath: "실시" } as Record<string, unknown> },
            });
            expect(result.current.message).toBeNull();
            rerender({ draft: {} });
            expect(result.current.message).toEqual({ tone: "error", text: requiredChoiceCopy("좌욕") });
        });

        it("the payment confirmation is an error after it was ticked and unticked", () => {
            const pay = item("paymentConfirmed");
            const { result, rerender } = renderHook(({ draft }) => useDailyFieldMessages(pay, draft), {
                initialProps: { draft: { paymentConfirmed: false } as Record<string, unknown> },
            });
            expect(result.current.message).toBeNull();
            rerender({ draft: { paymentConfirmed: true } });
            rerender({ draft: { paymentConfirmed: false } });
            expect(result.current.message).toEqual({ tone: "error", text: FIELD_COPY.paymentConfirm });
        });
    });
});

describe("getDailyItemProblem", () => {
    const noErrors = {};
    it("textarea: only an over-limit text is a problem", () => {
        const etc = item("etcService");
        const max = etc.maxLength as number;
        expect(getDailyItemProblem(etc, {}, noErrors)).toBeNull();
        expect(getDailyItemProblem(etc, { etcService: "x".repeat(max) }, noErrors)).toBeNull();
        expect(getDailyItemProblem(etc, { etcService: "x".repeat(max + 1) }, noErrors)).toEqual({ kind: "textarea" });
        expect(getDailyItemProblem(etc, { etcService: 7 }, noErrors)).toBeNull();
    });
    it("counts: the first missing or erroring count, in declaration order", () => {
        const meals = item("meals");
        expect(getDailyItemProblem(meals, {}, noErrors)).toEqual({ kind: "count", countKey: "meal" });
        expect(getDailyItemProblem(meals, { meals_meal: "1" }, noErrors)).toEqual({ kind: "count", countKey: "snack" });
        expect(getDailyItemProblem(meals, { meals_meal: "1", meals_snack: "2" }, noErrors)).toBeNull();
        expect(getDailyItemProblem(meals, { meals_meal: "x", meals_snack: "2" }, { meals_meal: "bad" }))
            .toEqual({ kind: "count", countKey: "meal" });
        expect(getDailyItemProblem(meals, { meals_meal: "1", meals_snack: "x" }, { meals_snack: "bad" }))
            .toEqual({ kind: "count", countKey: "snack" });
    });
    it("stool: option when unanswered, stoolColor when abnormal without colour, otherwise complete", () => {
        const stool = item("stool");
        expect(getDailyItemProblem(stool, {}, noErrors)).toEqual({ kind: "option" });
        expect(getDailyItemProblem(stool, { stool: "이상변" }, noErrors)).toEqual({ kind: "stoolColor" });
        expect(getDailyItemProblem(stool, { stool: "이상변", stool_color: "초록" }, noErrors)).toBeNull();
        expect(getDailyItemProblem(stool, { stool: "정상변" }, noErrors)).toBeNull();
    });
    it("radio, multi and confirm: option until answered", () => {
        expect(getDailyItemProblem(item("sitzBath"), {}, noErrors)).toEqual({ kind: "option" });
        expect(getDailyItemProblem(item("sitzBath"), { sitzBath: "실시" }, noErrors)).toBeNull();
        expect(getDailyItemProblem(item("perineum"), { perineum: [] }, noErrors)).toEqual({ kind: "option" });
        expect(getDailyItemProblem(item("perineum"), { perineum: ["이상없음"] }, noErrors)).toBeNull();
        expect(getDailyItemProblem(item("paymentConfirmed"), { paymentConfirmed: false }, noErrors)).toEqual({ kind: "option" });
        expect(getDailyItemProblem(item("paymentConfirmed"), { paymentConfirmed: true }, noErrors)).toBeNull();
    });
});

describe("header state", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const validHeader = {
        momName: "이예지", momBirth: "1999-01-01", babyName: "이아기", babyBirth: "2026-06-15",
        deliveryType: "자연분만", babyWeight: "3.2",
    };

    describe("resolveHeaderErrors", () => {
        it("a complete valid employee header has no errors and is complete", () => {
            const result = resolveHeaderErrors(validHeader, { adminMode: false, suppliedHeaderErrors: undefined, now });
            expect(result).toEqual({ headerErrors: {}, usesScopedHeaderErrors: false, isHeaderComplete: true });
        });
        it("an employee header requires every field", () => {
            const result = resolveHeaderErrors({ ...validHeader, momName: "" }, { adminMode: false, suppliedHeaderErrors: undefined, now });
            expect(result.headerErrors.momName).toBeTruthy();
            expect(result.isHeaderComplete).toBe(false);
        });
        it("a future birth date is an error", () => {
            const result = resolveHeaderErrors({ ...validHeader, babyBirth: "2026-12-31" }, { adminMode: false, suppliedHeaderErrors: undefined, now });
            expect(result.headerErrors.babyBirth).toBeTruthy();
            expect(result.isHeaderComplete).toBe(false);
        });
        it("validates dates against the supplied now, not the ambient clock", () => {
            // 2030-01-01 is in the future for the real clock but past for the supplied now.
            const laterNow = new Date("2031-01-01T00:00:00Z");
            const accepted = resolveHeaderErrors({ ...validHeader, babyBirth: "2030-01-01" }, { adminMode: false, suppliedHeaderErrors: undefined, now: laterNow });
            expect(accepted.headerErrors).toEqual({});
            expect(accepted.isHeaderComplete).toBe(true);
            // 2020-01-01 is in the past for the real clock but future for the supplied now.
            const earlierNow = new Date("2019-01-01T00:00:00Z");
            const rejected = resolveHeaderErrors({ ...validHeader, babyBirth: "2020-01-01" }, { adminMode: false, suppliedHeaderErrors: undefined, now: earlierNow });
            expect(rejected.headerErrors.babyBirth).toBeTruthy();
            expect(rejected.isHeaderComplete).toBe(false);
        });
        it("supplied errors are merged into the computed ones for employees", () => {
            const result = resolveHeaderErrors(validHeader, { adminMode: false, suppliedHeaderErrors: { babyWeight: "서버 오류" }, now });
            expect(result.headerErrors).toEqual({ babyWeight: "서버 오류" });
            expect(result.usesScopedHeaderErrors).toBe(false);
            expect(result.isHeaderComplete).toBe(false);
        });
        it("admin mode without a supplied map validates without requiring values", () => {
            const result = resolveHeaderErrors({ momName: "", momBirth: "" }, { adminMode: true, suppliedHeaderErrors: undefined, now });
            expect(result.usesScopedHeaderErrors).toBe(false);
            expect(result.headerErrors).toEqual({});
            expect(result.isHeaderComplete).toBe(false);
        });
        it("admin mode with a supplied map owns the validation scope", () => {
            const supplied = {};
            const scoped = resolveHeaderErrors(validHeader, { adminMode: true, suppliedHeaderErrors: supplied, now });
            expect(scoped.usesScopedHeaderErrors).toBe(true);
            expect(scoped.headerErrors).toBe(supplied);
            expect(scoped.isHeaderComplete).toBe(true);
            const withError = resolveHeaderErrors(validHeader, { adminMode: true, suppliedHeaderErrors: { momName: "x" }, now });
            expect(withError.isHeaderComplete).toBe(false);
            const missing = resolveHeaderErrors({ ...validHeader, babyName: "" }, { adminMode: true, suppliedHeaderErrors: {}, now });
            expect(missing.isHeaderComplete).toBe(false);
        });
    });

    describe("getHeaderFieldMessage", () => {
        const base = {
            value: "", hadValue: false, touched: false, focused: false, submitted: false,
            adminMode: false, readOnly: false, suppliedHeaderErrors: undefined, headerErrors: {},
        };
        it("exports the date keys", () => {
            expect([...HEADER_DATE_KEYS]).toEqual(["momBirth", "babyBirth"]);
        });
        it("is null when read-only", () => {
            expect(getHeaderFieldMessage("momName", { ...base, readOnly: true, submitted: true })).toBeNull();
        });
        it("shows nothing for an untouched empty or filled value", () => {
            expect(getHeaderFieldMessage("momName", base)).toBeNull();
            expect(getHeaderFieldMessage("momBirth", { ...base, value: "1999-01-01", headerErrors: { momBirth: "x" } })).toBeNull();
        });
        it("an empty field shows required after it held a value or after submit", () => {
            expect(getHeaderFieldMessage("momName", { ...base, hadValue: true }))
                .toEqual({ tone: "error", text: requiredInputCopy("산모 성명") });
            expect(getHeaderFieldMessage("momName", { ...base, submitted: true }))
                .toEqual({ tone: "error", text: requiredInputCopy("산모 성명") });
        });
        it("the delivery type uses the choice wording", () => {
            expect(getHeaderFieldMessage("deliveryType", { ...base, submitted: true }))
                .toEqual({ tone: "error", text: requiredChoiceCopy("분만형태") });
        });
        it("a date shows the format hint while focused and the format error once touched", () => {
            expect(getHeaderFieldMessage("momBirth", { ...base, value: "1999", focused: true }))
                .toEqual({ tone: "hint", text: FIELD_COPY.dateHint });
            expect(getHeaderFieldMessage("momBirth", { ...base, value: "1999", touched: true }))
                .toEqual({ tone: "error", text: FIELD_COPY.dateError });
            expect(getHeaderFieldMessage("momBirth", { ...base, value: "1999", submitted: true }))
                .toEqual({ tone: "error", text: FIELD_COPY.dateError });
        });
        it("a non-date field with a value shows the computed error only once active", () => {
            const headerErrors = { babyWeight: "범위를 확인해 주세요" };
            expect(getHeaderFieldMessage("babyWeight", { ...base, value: "99", headerErrors })).toBeNull();
            expect(getHeaderFieldMessage("babyWeight", { ...base, value: "99", headerErrors, focused: true }))
                .toEqual({ tone: "error", text: "범위를 확인해 주세요" });
            expect(getHeaderFieldMessage("babyWeight", { ...base, value: "99", headerErrors, touched: true })?.tone).toBe("error");
            expect(getHeaderFieldMessage("babyWeight", { ...base, value: "99", headerErrors, submitted: true })?.tone).toBe("error");
        });
        it("a supplied error beats the computed one", () => {
            expect(getHeaderFieldMessage("babyWeight", {
                ...base, value: "99", touched: true,
                suppliedHeaderErrors: { babyWeight: "서버" }, headerErrors: { babyWeight: "계산" },
            })).toEqual({ tone: "error", text: "서버" });
        });
        it("a supplied error shows for a filled field even when untouched", () => {
            expect(getHeaderFieldMessage("babyWeight", {
                ...base, value: "99", suppliedHeaderErrors: { babyWeight: "서버" },
            })).toEqual({ tone: "error", text: "서버" });
        });
        it("admin mode suppresses the generated required/format errors", () => {
            const admin = { ...base, adminMode: true };
            expect(getHeaderFieldMessage("momName", { ...admin, hadValue: true, submitted: true })).toBeNull();
            expect(getHeaderFieldMessage("momBirth", { ...admin, value: "1999", touched: true })).toBeNull();
        });
        it("admin mode still shows the focused format hint and shows computed errors without interaction", () => {
            const admin = { ...base, adminMode: true };
            expect(getHeaderFieldMessage("momBirth", { ...admin, value: "1999", focused: true }))
                .toEqual({ tone: "hint", text: FIELD_COPY.dateHint });
            expect(getHeaderFieldMessage("babyWeight", { ...admin, value: "99", headerErrors: { babyWeight: "계산" } }))
                .toEqual({ tone: "error", text: "계산" });
        });
    });

    describe("firstHeaderProblemKey", () => {
        it("is null without errors and otherwise follows the field order", () => {
            expect(firstHeaderProblemKey({})).toBeNull();
            expect(firstHeaderProblemKey({ babyWeight: "x", babyName: "y" })).toBe("babyName");
            expect(firstHeaderProblemKey({ babyBirth: "x", momBirth: "y" })).toBe("momBirth");
        });
    });
});

describe("getPhoneState", () => {
    const base = { hadValue: false, touched: false, focused: false, submitted: false, phoneFieldError: null };
    it("an empty phone shows nothing until it held a value or was submitted", () => {
        expect(getPhoneState("", base)).toEqual({ digits: "", complete: false, message: null });
        expect(getPhoneState("", { ...base, hadValue: true }).message).toEqual({ tone: "error", text: requiredInputCopy("휴대폰 번호") });
        expect(getPhoneState("", { ...base, submitted: true }).message).toEqual({ tone: "error", text: requiredInputCopy("휴대폰 번호") });
    });
    it("counts digits only and is complete from ten digits", () => {
        expect(getPhoneState("010-1234-567", base)).toMatchObject({ digits: "0101234567", complete: true });
        expect(getPhoneState("010-1234-56", base)).toMatchObject({ digits: "010123456", complete: false });
        expect(getPhoneState("010-1234-5678", base)).toMatchObject({ digits: "01012345678", complete: true, message: null });
    });
    it("an incomplete phone shows the hint while focused and the format error otherwise once touched", () => {
        expect(getPhoneState("010", { ...base, focused: true }).message).toEqual({ tone: "hint", text: FIELD_COPY.phoneHint });
        expect(getPhoneState("010", base).message).toEqual({ tone: "hint", text: FIELD_COPY.phoneHint });
        expect(getPhoneState("010", { ...base, touched: true }).message).toEqual({ tone: "error", text: FIELD_COPY.phoneError });
        expect(getPhoneState("010", { ...base, submitted: true }).message).toEqual({ tone: "error", text: FIELD_COPY.phoneError });
    });
    it("a format error beats the field error, which beats a hint", () => {
        const fieldError = "일치하는 제공인력이 없습니다";
        expect(getPhoneState("010", { ...base, touched: true, phoneFieldError: fieldError }).message)
            .toEqual({ tone: "error", text: FIELD_COPY.phoneError });
        expect(getPhoneState("010", { ...base, focused: true, phoneFieldError: fieldError }).message)
            .toEqual({ tone: "error", text: fieldError });
        expect(getPhoneState("01012345678", { ...base, phoneFieldError: fieldError }).message)
            .toEqual({ tone: "error", text: fieldError });
        expect(getPhoneState("", { ...base, phoneFieldError: fieldError }).message)
            .toEqual({ tone: "error", text: fieldError });
    });
    it("an empty field error is ignored", () => {
        expect(getPhoneState("01012345678", { ...base, phoneFieldError: "" }).message).toBeNull();
    });
});

describe("resolvePlannedDates", () => {
    const defaultDate = (day: number) => `2026-09-${String(20 + day).padStart(2, "0")}`;
    const makeContext = (overrides: Partial<ServiceRecordContext> = {}): ServiceRecordContext => ({
        totalSessions: 3, startDate: "2026-09-21", header: null, sessions: [], ...overrides,
    });
    const vector = [
        { sessionIndex: 1, serviceDate: "2026-09-21" },
        { sessionIndex: 2, serviceDate: "2026-09-22" },
        { sessionIndex: 3, serviceDate: "2026-09-23" },
    ];
    const resolve = (context: ServiceRecordContext | null, overrides: { day?: number; adminMode?: boolean; draft?: Record<string, unknown> } = {}) => (
        resolvePlannedDates({ context, day: 1, adminMode: false, draft: {}, defaultDate, ...overrides })
    );

    it("without a vector falls back to the default date", () => {
        const result = resolve(makeContext());
        expect(result.plannedDateVectorProvided).toBe(false);
        expect(result.plannedDateVectorValid).toBe(true);
        expect(result.providerDateLocked).toBe(false);
        expect(result.currentServiceDate).toBe("2026-09-21");
        expect(result.plannedServiceDate).toBeUndefined();
        expect(result.displayDateForSession(2)).toBe("2026-09-22");
    });
    it("works without a context", () => {
        const result = resolve(null, { day: 2 });
        expect(result.currentSession).toBeUndefined();
        expect(result.currentServiceDate).toBe("2026-09-22");
    });
    it("a valid vector locks the provider's date to the planned date", () => {
        const result = resolve(makeContext({ plannedSessionDates: vector }), { day: 2, draft: { _date: "2026-10-01" } });
        expect(result.plannedDateVectorProvided).toBe(true);
        expect(result.plannedDateVectorValid).toBe(true);
        expect(result.providerDateLocked).toBe(true);
        expect(result.plannedServiceDate).toBe("2026-09-22");
        expect(result.plannedDateBySession?.get(3)).toBe("2026-09-23");
        expect(result.currentServiceDate).toBe("2026-09-22");
        expect(result.displayDateForSession(3)).toBe("2026-09-23");
    });
    it("an administrator is not locked and prefers the draft date, then the session, then the plan", () => {
        const sessions = [{ sessionIndex: 2, serviceDate: "2026-09-25T00:00:00Z", locked: false }];
        const context = makeContext({ plannedSessionDates: vector, sessions });
        expect(resolve(context, { day: 2, adminMode: true, draft: { _date: "2026-10-01" } }).currentServiceDate).toBe("2026-10-01");
        const admin = resolve(context, { day: 2, adminMode: true });
        expect(admin.providerDateLocked).toBe(false);
        expect(admin.currentSession?.sessionIndex).toBe(2);
        expect(admin.currentServiceDate).toBe("2026-09-25");
        expect(resolve(makeContext({ plannedSessionDates: vector }), { day: 2, adminMode: true }).currentServiceDate).toBe("2026-09-22");
    });
    it("a session date is shown ahead of the plan and default in displayDateForSession", () => {
        const result = resolve(makeContext({ plannedSessionDates: vector }));
        expect(result.displayDateForSession(1, { serviceDate: "2026-09-30T10:00:00Z" })).toBe("2026-09-30");
        expect(result.displayDateForSession(1, { serviceDate: "" })).toBe("2026-09-21");
    });
    it("a provided vector never falls back to the default date", () => {
        const result = resolve(makeContext({ plannedSessionDates: [], totalSessions: 0 }), { day: 1 });
        expect(result.currentServiceDate).toBe("");
        expect(result.displayDateForSession(1)).toBe("");
    });
    it.each([
        ["wrong length", vector.slice(0, 2)],
        ["duplicate session index", [vector[0], { sessionIndex: 1, serviceDate: "2026-09-22" }, vector[2]]],
        ["duplicate date", [vector[0], { sessionIndex: 2, serviceDate: "2026-09-21" }, vector[2]]],
        ["invalid calendar date", [vector[0], { sessionIndex: 2, serviceDate: "2026-02-30" }, vector[2]]],
        ["malformed date", [vector[0], { sessionIndex: 2, serviceDate: "2026/09/22" }, vector[2]]],
        ["index out of range", [vector[0], vector[1], { sessionIndex: 4, serviceDate: "2026-09-23" }]],
        ["index zero", [vector[0], vector[1], { sessionIndex: 0, serviceDate: "2026-09-23" }]],
        ["fractional index", [vector[0], vector[1], { sessionIndex: 2.5, serviceDate: "2026-09-23" }]],
    ])("rejects a vector with %s", (_label, plannedSessionDates) => {
        const result = resolve(makeContext({ plannedSessionDates }));
        expect(result.plannedDateVectorProvided).toBe(true);
        expect(result.plannedDateVectorValid).toBe(false);
        expect(result.plannedDateBySession).toBeNull();
        expect(result.plannedServiceDate).toBeUndefined();
        expect(result.providerDateLocked).toBe(true);
        expect(result.currentServiceDate).toBe("");
    });
    it("rejects a non-array vector", () => {
        const result = resolve(makeContext({ plannedSessionDates: null as unknown as ServiceRecordContext["plannedSessionDates"] }));
        expect(result.plannedDateVectorValid).toBe(false);
    });
});

describe("service date", () => {
    const defaultDate = (day: number) => `2026-09-${String(20 + day).padStart(2, "0")}`;
    const context: ServiceRecordContext = { totalSessions: 3, startDate: "2026-09-21T00:00:00Z", header: null, sessions: [] };

    describe("getServiceDateMin", () => {
        it("day 1 uses the context start date, later days the default date", () => {
            expect(getServiceDateMin({ day: 1, context, defaultDate })).toBe("2026-09-21");
            expect(getServiceDateMin({ day: 0, context, defaultDate })).toBe("2026-09-21");
            expect(getServiceDateMin({ day: 2, context, defaultDate })).toBe("2026-09-22");
        });
        it("is undefined for day 1 without a start date or context", () => {
            expect(getServiceDateMin({ day: 1, context: { ...context, startDate: null }, defaultDate })).toBeUndefined();
            expect(getServiceDateMin({ day: 1, context: null, defaultDate })).toBeUndefined();
        });
    });

    describe("getServiceDateMessage", () => {
        const base = {
            text: "2026-09-21" as string | null, hadValue: true, touched: false, focused: false, submitted: false,
            min: "2026-09-21" as string | undefined, mismatch: false, fieldVisible: true,
        };
        it("a valid date on or after the minimum is reportable and has no message", () => {
            const result = getServiceDateMessage(base);
            expect(result.blocked).toBe(false);
            expect(result.message).toBeNull();
            expect(result.slot).toBeNull();
            expect(result.reportable("2026-09-21")).toBe(true);
            expect(result.reportable("2026-09-20")).toBe(false);
            expect(result.reportable("2026-02-30")).toBe(false);
            expect(result.reportable("20260921")).toBe(false);
        });
        it("without a minimum any real date is reportable", () => {
            const result = getServiceDateMessage({ ...base, min: undefined });
            expect(result.reportable("1999-01-01")).toBe(true);
            expect(result.reportable("nope")).toBe(false);
        });
        it("a date before the minimum is blocked with the range message", () => {
            const result = getServiceDateMessage({ ...base, text: "2026-09-01" });
            expect(result.blocked).toBe(true);
            expect(result.message).toEqual({ tone: "error", text: FIELD_COPY.serviceDateBefore });
            expect(result.slot).toEqual(result.message);
        });
        it("an invalid date is blocked with the invalid message", () => {
            const result = getServiceDateMessage({ ...base, text: "2026-02-30" });
            expect(result.blocked).toBe(true);
            expect(result.message).toEqual({ tone: "error", text: FIELD_COPY.dateInvalid });
        });
        it("a partial date shows the hint while focused, and the error once touched or submitted", () => {
            expect(getServiceDateMessage({ ...base, text: "2026-09", focused: true }).message)
                .toEqual({ tone: "hint", text: FIELD_COPY.dateHint });
            const touched = getServiceDateMessage({ ...base, text: "2026-09", touched: true });
            expect(touched.message).toEqual({ tone: "error", text: FIELD_COPY.dateError });
            expect(touched.blocked).toBe(true);
            expect(getServiceDateMessage({ ...base, text: "2026-09", submitted: true }).message?.tone).toBe("error");
        });
        it("an emptied field is blocked and shows required once it held a value", () => {
            const result = getServiceDateMessage({ ...base, text: "" });
            expect(result.blocked).toBe(true);
            expect(result.message).toEqual({ tone: "error", text: requiredInputCopy("제공일자") });
            expect(getServiceDateMessage({ ...base, text: "", hadValue: false }).message).toBeNull();
        });
        it("when the field is not being edited there is no message and nothing is blocked", () => {
            const result = getServiceDateMessage({ ...base, text: null });
            expect(result.blocked).toBe(false);
            expect(result.message).toBeNull();
        });
        it("the mismatch caution fills the slot only while the field is visible and no message exists", () => {
            const caution = { tone: "hint", text: FIELD_COPY.serviceDateMismatch };
            expect(getServiceDateMessage({ ...base, mismatch: true }).slot).toEqual(caution);
            expect(getServiceDateMessage({ ...base, text: null, mismatch: true }).slot).toEqual(caution);
            expect(getServiceDateMessage({ ...base, mismatch: true, fieldVisible: false }).slot).toBeNull();
            expect(getServiceDateMessage({ ...base, text: "2026-09-01", mismatch: true }).slot?.tone).toBe("error");
            expect(getServiceDateMessage({ ...base, mismatch: true }).message).toBeNull();
        });
    });
});

describe("getWizardProgress", () => {
    it("is fixed per non-day screen", () => {
        expect(getWizardProgress("loading", 0)).toBe(5);
        expect(getWizardProgress("invalid", 0)).toBe(5);
        expect(getWizardProgress("phone", 3)).toBe(5);
        expect(getWizardProgress("service", 3)).toBe(12);
        expect(getWizardProgress("overview", 3)).toBe(20);
        expect(getWizardProgress("done", 0)).toBe(100);
    });
    it("grows with the page on the day screen", () => {
        expect(DAY_PAGES).toHaveLength(4);
        expect(getWizardProgress("day", 0)).toBe(38);
        expect(getWizardProgress("day", 1)).toBe(55);
        expect(getWizardProgress("day", 2)).toBe(73);
        expect(getWizardProgress("day", 3)).toBe(90);
    });
});

describe("day page helpers", () => {
    const flags = { serviceDateBlocked: false, serviceDateFieldVisible: true };
    const momPage = DAY_PAGES[0].items;
    const babyPage = DAY_PAGES[1].items;
    const servicePage = DAY_PAGES[2].items;
    const momDone = {
        perineum: ["이상없음"], breast: ["이상없음"], excretion: ["이상없음"], sitzBath: "실시",
        meals_meal: "1", meals_snack: "1",
    };

    describe("getFirstDayPageProblem", () => {
        it("the blocked service date comes first, but only while its field is visible", () => {
            expect(getFirstDayPageProblem(momPage, {}, {}, { serviceDateBlocked: true, serviceDateFieldVisible: true }))
                .toEqual({ kind: "serviceDate" });
            expect(getFirstDayPageProblem(momPage, {}, {}, { serviceDateBlocked: true, serviceDateFieldVisible: false }))
                .toMatchObject({ kind: "item" });
        });
        it("otherwise the first unfinished item in page order, with its problem", () => {
            expect(getFirstDayPageProblem(momPage, {}, {}, flags))
                .toEqual({ kind: "item", item: item("perineum"), problem: { kind: "option" } });
            expect(getFirstDayPageProblem(momPage, { ...momDone, sitzBath: undefined }, {}, flags))
                .toEqual({ kind: "item", item: item("sitzBath"), problem: { kind: "option" } });
            expect(getFirstDayPageProblem(momPage, { ...momDone, meals_snack: "" }, {}, flags))
                .toEqual({ kind: "item", item: item("meals"), problem: { kind: "count", countKey: "snack" } });
        });
        it("is null when the page is complete", () => {
            expect(getFirstDayPageProblem(momPage, momDone, {}, flags)).toBeNull();
        });
        it("a numeric error blocks a filled count", () => {
            expect(getFirstDayPageProblem(momPage, momDone, { meals_snack: "bad" }, flags))
                .toEqual({ kind: "item", item: item("meals"), problem: { kind: "count", countKey: "snack" } });
        });
        it("the abnormal stool without colour points at the colour", () => {
            const babyDone = {
                temperature_temp: "36.5", sleep: "잘 잠", breastFeeding_count: "1", formulaFeeding_count: "1", formulaFeeding_ml: "60",
                stool: "이상변", bath: "실시",
            };
            expect(getFirstDayPageProblem(babyPage, babyDone, {}, flags))
                .toEqual({ kind: "item", item: item("stool"), problem: { kind: "stoolColor" } });
        });
        it("an over-limit text points at the textarea, then the unconfirmed payment", () => {
            const max = item("etcService").maxLength as number;
            expect(getFirstDayPageProblem(servicePage, { etcService: "x".repeat(max + 1) }, {}, flags))
                .toEqual({ kind: "item", item: item("etcService"), problem: { kind: "textarea" } });
            expect(getFirstDayPageProblem(servicePage, {}, {}, flags))
                .toEqual({ kind: "item", item: item("paymentConfirmed"), problem: { kind: "option" } });
            expect(getFirstDayPageProblem(servicePage, { paymentConfirmed: true }, {}, flags)).toBeNull();
        });
        it("skips unknown item indexes and an empty page", () => {
            expect(getFirstDayPageProblem([999], {}, {}, flags)).toBeNull();
            expect(getFirstDayPageProblem([], {}, {}, flags)).toBeNull();
        });
    });

    describe("hasInvalidTextAnswers", () => {
        it("is true only when a textarea answer exceeds its limit", () => {
            const etcMax = item("etcService").maxLength as number;
            const notesMax = item("notes").maxLength as number;
            expect(hasInvalidTextAnswers({})).toBe(false);
            expect(hasInvalidTextAnswers({ etcService: "x".repeat(etcMax), notes: "x".repeat(notesMax) })).toBe(false);
            expect(hasInvalidTextAnswers({ etcService: "x".repeat(etcMax + 1) })).toBe(true);
            expect(hasInvalidTextAnswers({ notes: "x".repeat(notesMax + 1) })).toBe(true);
            expect(hasInvalidTextAnswers({ notes: 1000 })).toBe(false);
        });
    });

    describe("hasInvalidNumericAnswersOnPage", () => {
        it("only counts numeric errors of count items on the given page", () => {
            expect(hasInvalidNumericAnswersOnPage(momPage, {})).toBe(false);
            expect(hasInvalidNumericAnswersOnPage(momPage, { meals_snack: "bad" })).toBe(true);
            expect(hasInvalidNumericAnswersOnPage(babyPage, { meals_snack: "bad" })).toBe(false);
            expect(hasInvalidNumericAnswersOnPage(babyPage, { formulaFeeding_ml: "bad" })).toBe(true);
            expect(hasInvalidNumericAnswersOnPage(servicePage, { formulaFeeding_ml: "bad" })).toBe(false);
            expect(hasInvalidNumericAnswersOnPage([999], { meals_snack: "bad" })).toBe(false);
            expect(hasInvalidNumericAnswersOnPage([], { meals_snack: "bad" })).toBe(false);
        });
    });
});
