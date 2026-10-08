import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DAILY_ITEMS, getDailyItemProblem } from "@babyjamjam/service-record-ui";

import { DailyItemField, type DailyItemFieldProps } from "../DailyItemField";
import { dailyFieldComponent, getDailyItemProblemId } from "../ids";

const ROOT = "mobile_service-record_wizard";

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
    it("names a multi group after its item and toggles with the item key and option", async () => {
        const user = userEvent.setup();
        const { onToggleMulti } = setup("perineum", { draft: { perineum: ["이상없음"] } });

        const group = screen.getByRole("group", { name: /회음절개부위/ });
        expect(within(group).getByRole("button", { name: "이상없음" })).toHaveAttribute("aria-pressed", "true");
        expect(within(group).getByRole("button", { name: "열상" })).toHaveAttribute("aria-pressed", "false");

        await user.click(within(group).getByRole("button", { name: "열상" }));
        expect(onToggleMulti).toHaveBeenCalledWith("perineum", "열상");
    });

    it("shows the multi hint until an answer exists and describes every option by the message slot", () => {
        setup("perineum");
        const first = screen.getByRole("button", { name: "이상없음" });
        const slot = slotOf(first);
        expect(slot).toHaveTextContent("여러 개 선택 가능");
        expect(slot).toHaveAttribute("data-tone", "hint");
        expect(slot).toHaveAttribute("data-slot", "lab-msg");
        for (const option of screen.getAllByRole("button")) expect(option).toHaveAttribute("aria-describedby", slot.id);
    });

    it("renders a radio item as a radiogroup and answers with the chosen option", async () => {
        const user = userEvent.setup();
        const { onFieldChange } = setup("sitzBath", { draft: { sitzBath: "실시" } });

        const group = screen.getByRole("radiogroup", { name: /좌욕/ });
        expect(within(group).getByRole("button", { name: "실시" })).toHaveAttribute("aria-pressed", "true");
        await user.click(within(group).getByRole("button", { name: "미실시" }));
        expect(onFieldChange).toHaveBeenCalledWith("sitzBath", "미실시");
    });

    it("reveals the stool colour input only for an abnormal stool", async () => {
        const user = userEvent.setup();
        const { onFieldChange } = setup("stool", { draft: { stool: "정상변" } });
        expect(screen.queryByRole("textbox", { name: "이상변의 색깔과 상태" })).toBeNull();
        await user.click(screen.getByRole("button", { name: "이상변" }));
        expect(onFieldChange).toHaveBeenCalledWith("stool", "이상변");
    });

    it("types into the stool colour input with the colour key", async () => {
        const user = userEvent.setup();
        const { onFieldChange } = setup("stool", { draft: { stool: "이상변" }, submitted: true });

        const color = screen.getByRole("textbox", { name: "이상변의 색깔과 상태" });
        expect(color).toHaveAttribute("aria-invalid", "true");
        expect(slotOf(color)).toHaveTextContent("변 색깔·상태를 적어 주세요");
        await user.type(color, "녹");
        expect(onFieldChange).toHaveBeenCalledWith("stool_color", "녹");
    });

    it("gives every count input the accessible name the shared wizard exposes", () => {
        setup("meals");
        expect(screen.getByRole("textbox", { name: "식사" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "간식" })).toBeInTheDocument();
    });

    it.each([
        ["temperature", ["체온"]],
        ["breastFeeding", ["모유수유 횟수"]],
        ["formulaFeeding", ["분유수유 횟수", "분유수유 회당"]],
    ])("names the %s count inputs", (key, names) => {
        setup(key);
        for (const name of names) expect(screen.getByRole("textbox", { name })).toBeInTheDocument();
    });

    it("reports a typed count with its full draft key", async () => {
        const user = userEvent.setup();
        const { onFieldChange, item } = setup("meals");
        const mealKey = `${item.key}_${item.counts![0].k}`;

        await user.type(screen.getByRole("textbox", { name: "식사" }), "3");
        expect(onFieldChange).toHaveBeenCalledWith(mealKey, "3");
    });

    it("shows the required message only after a count held a value and was cleared", async () => {
        const user = userEvent.setup();
        render(<Harness itemKey="meals" />);
        const meal = screen.getByRole("textbox", { name: "식사" });
        const slot = slotOf(meal);

        expect(slot).toBeEmptyDOMElement();
        await user.type(meal, "3");
        expect(slot).toBeEmptyDOMElement();
        await user.clear(meal);
        expect(slot).toHaveTextContent("식사를 입력해 주세요");
        expect(slot).toHaveAttribute("data-tone", "error");
        expect(meal).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByRole("textbox", { name: "간식" })).not.toHaveAttribute("aria-invalid");
    });

    it("shows the required message of every empty count after a blocked next", () => {
        setup("meals", { submitted: true });
        expect(slotOf(screen.getByRole("textbox", { name: "식사" }))).toHaveTextContent("식사를 입력해 주세요");
        expect(screen.getByRole("textbox", { name: "간식" })).toHaveAttribute("aria-invalid", "true");
    });

    it("shows the numeric error of a count from the shared rules", () => {
        const { item } = setup("temperature", {
            draft: { temperature_temp: "abc" },
            numericErrors: { temperature_temp: "숫자만 입력해 주세요" },
        });
        const input = screen.getByRole("textbox", { name: "체온" });
        expect(item.key).toBe("temperature");
        expect(slotOf(input)).toHaveTextContent("숫자만 입력해 주세요");
        expect(input).toHaveAttribute("aria-invalid", "true");
    });

    it("counts a textarea while it has focus and when it has text", async () => {
        const user = userEvent.setup();
        const { onFieldChange } = setup("etcService", { draft: { etcService: "가나" } });

        const box = screen.getByRole("textbox", { name: "기타 서비스 (필요 시 기재)" });
        expect(slotOf(box)).toHaveTextContent("2/40자");
        await user.type(box, "다");
        expect(onFieldChange).toHaveBeenCalledWith("etcService", "가나다");
    });

    it("shows the counter on focus before any text and the limit message over the limit", async () => {
        const user = userEvent.setup();
        const { rerender } = render(
            <DailyItemField
                data-component={dailyFieldComponent(ROOT, itemOf("notes"))}
                item={itemOf("notes")}
                draft={{}}
                onFieldChange={jest.fn()}
                onToggleMulti={jest.fn()}
            />,
        );
        const box = screen.getByRole("textbox", { name: "특이사항 (필요 시 기재)" });
        expect(slotOf(box)).toBeEmptyDOMElement();
        await user.click(box);
        expect(slotOf(box)).toHaveTextContent("0/80자");

        rerender(
            <DailyItemField
                data-component={dailyFieldComponent(ROOT, itemOf("notes"))}
                item={itemOf("notes")}
                draft={{ notes: "가".repeat(81) }}
                onFieldChange={jest.fn()}
                onToggleMulti={jest.fn()}
            />,
        );
        expect(slotOf(box)).toHaveTextContent("80자 이내로 줄여 주세요");
        expect(box).toHaveAttribute("aria-invalid", "true");
    });

    it("toggles the payment confirmation with the opposite boolean", async () => {
        const user = userEvent.setup();
        const first = setup("paymentConfirmed", { draft: {} });
        await user.click(screen.getByRole("button", { name: "결제 확인 완료" }));
        expect(first.onFieldChange).toHaveBeenCalledWith("paymentConfirmed", true);
    });

    it("clears a confirmed payment and asks for it after a blocked next", async () => {
        const user = userEvent.setup();
        const confirmed = setup("paymentConfirmed", { draft: { paymentConfirmed: true } });
        const button = screen.getByRole("button", { name: "결제 확인 완료" });
        expect(button).toHaveAttribute("aria-pressed", "true");
        await user.click(button);
        expect(confirmed.onFieldChange).toHaveBeenCalledWith("paymentConfirmed", false);
    });

    it("asks for the payment confirmation once submitted", () => {
        setup("paymentConfirmed", { submitted: true });
        expect(slotOf(screen.getByRole("button", { name: "결제 확인 완료" }))).toHaveTextContent("결제 확인을 눌러 주세요");
    });

    it("points getDailyItemProblemId at a control that exists", () => {
        const item = itemOf("meals");
        const dataComponent = dailyFieldComponent(ROOT, item);
        const problem = getDailyItemProblem(item, {}, {});
        setup("meals");
        const id = getDailyItemProblemId(item, dataComponent, problem);
        expect(id).toBeTruthy();
        expect(document.getElementById(id!)).toBe(screen.getByRole("textbox", { name: "식사" }));
    });
});
