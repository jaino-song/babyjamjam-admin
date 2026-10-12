import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DAILY_ITEMS, getDailyItemProblem } from "@babyjamjam/service-record-ui";

import { DailyItemField, type DailyItemFieldProps } from "../DailyItemField";
import { dailyFieldComponent, getDailyItemProblemId } from "../ids";

const ROOT = "desktop_service-record-admin_wizard";

const itemOf = (key: string) => {
    const item = DAILY_ITEMS.find((candidate) => candidate.key === key);
    if (!item) throw new Error(`no item ${key}`);
    return item;
};

function setup(key: string, overrides: Partial<DailyItemFieldProps> = {}) {
    const item = itemOf(key);
    const onFieldChange = jest.fn();
    const onToggleMulti = jest.fn();
    render(
        <DailyItemField
            data-component={dailyFieldComponent(ROOT, item)}
            item={item}
            draft={{}}
            onFieldChange={onFieldChange}
            onToggleMulti={onToggleMulti}
            {...overrides}
        />,
    );
    return { item, onFieldChange, onToggleMulti };
}

/** Keeps the draft in state so a field can be filled and cleared. */
function Harness({ itemKey }: { itemKey: string }) {
    const [draft, setDraft] = useState<Record<string, unknown>>({});
    const item = itemOf(itemKey);
    return (
        <DailyItemField
            data-component={dailyFieldComponent(ROOT, item)}
            item={item}
            draft={draft}
            onFieldChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
            onToggleMulti={jest.fn()}
        />
    );
}

const slotOf = (control: HTMLElement) => document.getElementById(control.getAttribute("aria-describedby")!)!;

describe("DailyItemField", () => {
    it("names a multi group after its item and toggles with the item key and option", () => {
        const { onToggleMulti } = setup("perineum", { draft: { perineum: ["이상없음"] } });

        const group = screen.getByRole("group", { name: /회음절개부위/ });
        expect(within(group).getByRole("button", { name: "이상없음" })).toHaveAttribute("aria-pressed", "true");
        expect(within(group).getByRole("button", { name: "열상" })).toHaveAttribute("aria-pressed", "false");

        fireEvent.click(within(group).getByRole("button", { name: "열상" }));
        expect(onToggleMulti).toHaveBeenCalledWith("perineum", "열상");
    });

    it("shows no answer-required message in admin and describes every option by the empty message slot", () => {
        setup("perineum");
        const first = screen.getByRole("button", { name: "이상없음" });
        const slot = slotOf(first);
        // Admin drafts may leave answers blank (SRW:1011): not even the multi hint appears.
        expect(slot).toBeEmptyDOMElement();
        expect(slot).toHaveAttribute("data-slot", "lab-msg");
        expect(slot).not.toHaveAttribute("data-tone");
        for (const option of screen.getAllByRole("button")) expect(option).toHaveAttribute("aria-describedby", slot.id);
    });

    it("renders a radio item as a radiogroup and answers with the chosen option", () => {
        const { onFieldChange } = setup("sitzBath", { draft: { sitzBath: "실시" } });

        const group = screen.getByRole("radiogroup", { name: /좌욕/ });
        expect(within(group).getByRole("button", { name: "실시" })).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(within(group).getByRole("button", { name: "미실시" }));
        expect(onFieldChange).toHaveBeenCalledWith("sitzBath", "미실시");
    });

    it("reveals the stool colour input only for an abnormal stool and does not require it", () => {
        const normal = setup("stool", { draft: { stool: "정상변" } });
        expect(screen.queryByRole("textbox", { name: "이상변의 색깔과 상태" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "이상변" }));
        expect(normal.onFieldChange).toHaveBeenCalledWith("stool", "이상변");
    });

    it("types into the stool colour input with the colour key", () => {
        const { onFieldChange } = setup("stool", { draft: { stool: "이상변" } });

        const color = screen.getByRole("textbox", { name: "이상변의 색깔과 상태" });
        expect(color).toHaveAttribute("aria-required", "false");
        expect(color).not.toHaveAttribute("aria-invalid");
        expect(slotOf(color)).toBeEmptyDOMElement();
        fireEvent.change(color, { target: { value: "녹" } });
        expect(onFieldChange).toHaveBeenCalledWith("stool_color", "녹");
    });

    it("gives every count input the accessible name the shared wizard exposes", () => {
        setup("meals");
        expect(screen.getByRole("spinbutton", { name: "식사" })).toBeInTheDocument();
        expect(screen.getByRole("spinbutton", { name: "간식" })).toBeInTheDocument();
    });

    it.each([
        ["temperature", ["체온"]],
        ["breastFeeding", ["모유수유 횟수"]],
        ["formulaFeeding", ["분유수유 횟수", "분유수유 회당"]],
    ])("names the %s count inputs", (key, names) => {
        setup(key);
        for (const name of names) expect(screen.getByRole("spinbutton", { name })).toBeInTheDocument();
    });

    it("reports a typed count with its full draft key", () => {
        const { onFieldChange, item } = setup("meals");
        const mealKey = `${item.key}_${item.counts![0].k}`;

        fireEvent.change(screen.getByRole("spinbutton", { name: "식사" }), { target: { value: "3" } });
        expect(onFieldChange).toHaveBeenCalledWith(mealKey, "3");
    });

    it("never asks for a count again after it was cleared (answers are optional in admin)", () => {
        render(<Harness itemKey="meals" />);
        const meal = screen.getByRole("spinbutton", { name: "식사" });
        const slot = slotOf(meal);

        fireEvent.change(meal, { target: { value: "3" } });
        expect(slot).toBeEmptyDOMElement();
        fireEvent.change(meal, { target: { value: "" } });
        expect(slot).toBeEmptyDOMElement();
        expect(meal).not.toHaveAttribute("aria-invalid");
    });

    it("shows the numeric error of a count from the shared rules", () => {
        setup("temperature", {
            draft: { temperature_temp: "abc" },
            numericErrors: { temperature_temp: "숫자만 입력해 주세요" },
        });
        const input = screen.getByRole("spinbutton", { name: "체온" });
        expect(slotOf(input)).toHaveTextContent("숫자만 입력해 주세요");
        expect(slotOf(input)).toHaveAttribute("data-tone", "error");
        expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("counts a textarea while it has text and reports typing", () => {
        const { onFieldChange } = setup("etcService", { draft: { etcService: "가나" } });

        const box = screen.getByRole("textbox", { name: "기타 서비스 (필요 시 기재)" });
        expect(slotOf(box)).toHaveTextContent("2/40자");
        expect(box).toHaveAttribute("maxlength", "40");
        fireEvent.change(box, { target: { value: "가나다" } });
        expect(onFieldChange).toHaveBeenCalledWith("etcService", "가나다");
    });

    it("shows the counter on focus before any text and the limit message over the limit", () => {
        const item = itemOf("notes");
        const props = {
            "data-component": dailyFieldComponent(ROOT, item),
            item,
            onFieldChange: jest.fn(),
            onToggleMulti: jest.fn(),
        };
        const { rerender } = render(<DailyItemField {...props} draft={{}} />);
        const box = screen.getByRole("textbox", { name: "특이사항 (필요 시 기재)" });
        expect(slotOf(box)).toBeEmptyDOMElement();
        fireEvent.focus(box);
        expect(slotOf(box)).toHaveTextContent("0/80자");

        rerender(<DailyItemField {...props} draft={{ notes: "가".repeat(81) }} />);
        expect(slotOf(box)).toHaveTextContent("80자 이내로 줄여 주세요");
        expect(box).toHaveAttribute("aria-invalid", "true");
    });

    it("toggles the payment confirmation with the opposite boolean", () => {
        const first = setup("paymentConfirmed", { draft: {} });
        fireEvent.click(screen.getByRole("button", { name: "결제 확인 완료" }));
        expect(first.onFieldChange).toHaveBeenCalledWith("paymentConfirmed", true);
    });

    it("clears a confirmed payment", () => {
        const confirmed = setup("paymentConfirmed", { draft: { paymentConfirmed: true } });
        const button = screen.getByRole("button", { name: "결제 확인 완료" });
        expect(button).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(button);
        expect(confirmed.onFieldChange).toHaveBeenCalledWith("paymentConfirmed", false);
    });

    it("points getDailyItemProblemId at a control that exists", () => {
        const item = itemOf("meals");
        const dataComponent = dailyFieldComponent(ROOT, item);
        const problem = getDailyItemProblem(item, {}, {});
        setup("meals");
        const id = getDailyItemProblemId(item, dataComponent, problem);
        expect(id).toBeTruthy();
        expect(document.getElementById(id!)).toBe(screen.getByRole("spinbutton", { name: "식사" }));
    });

    describe("readOnly", () => {
        const draftOf: Record<string, Record<string, unknown>> = {
            perineum: { perineum: ["이상없음"] },
            sitzBath: { sitzBath: "실시" },
            stool: { stool: "이상변", stool_color: "녹색" },
            meals: { meals_meal: "3" },
            etcService: { etcService: "가나" },
            paymentConfirmed: {},
        };

        it.each(Object.keys(draftOf))("makes every control of %s inert and silent", (key) => {
            const { onFieldChange, onToggleMulti } = setup(key, { draft: draftOf[key], readOnly: true });
            const controls = [...screen.queryAllByRole("button"), ...screen.queryAllByRole("textbox"), ...screen.queryAllByRole("spinbutton")];
            expect(controls.length).toBeGreaterThan(0);
            for (const control of controls) {
                expect(control).toBeDisabled();
                fireEvent.click(control);
            }
            expect(onFieldChange).not.toHaveBeenCalled();
            expect(onToggleMulti).not.toHaveBeenCalled();
        });

        it("keeps the names and drops the textarea counter, which SRW suppresses (SRW:223)", () => {
            setup("etcService", { draft: { etcService: "가나" }, readOnly: true });
            const box = screen.getByRole("textbox", { name: "기타 서비스 (필요 시 기재)" });
            expect(box).toHaveValue("가나");
            expect(slotOf(box)).toBeEmptyDOMElement();
        });

        it("still shows the numeric error of a disabled count", () => {
            setup("temperature", {
                draft: { temperature_temp: "abc" },
                numericErrors: { temperature_temp: "숫자만 입력해 주세요" },
                readOnly: true,
            });
            const input = screen.getByRole("spinbutton", { name: "체온" });
            expect(input).toBeDisabled();
            expect(slotOf(input)).toHaveTextContent("숫자만 입력해 주세요");
        });
    });
});
