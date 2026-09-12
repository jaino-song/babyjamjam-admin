import { act, createRef, type ChangeEvent, type Ref } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { TemplateContentEditor, type TemplateContentEditorHandle } from "../template-content-editor";
import type { VariableChipEditorHandle } from "../variable-chip-editor";
import type { TemplateVariable } from "@/lib/template/types";

const mockInsertVariable = jest.fn();

interface MockChipEditorProps {
    id?: string;
    placeholder?: string;
    value: string;
    onChange: (value: string) => void;
    variables: { key: string }[];
    onVariableClick?: (key: string) => void;
}

jest.mock("../variable-chip-editor", () => {
    // jest.mock factories are hoisted above this file's imports, so the
    // top-level `react` import isn't in scope here -- require() is the only
    // way to reach React inside the factory.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require("react");
    return {
        VariableChipEditor: React.forwardRef(function MockChipEditor(
            props: MockChipEditorProps,
            ref: Ref<VariableChipEditorHandle>
        ) {
            React.useImperativeHandle(ref, () => ({ insertVariable: mockInsertVariable }));
            return React.createElement(
                "div",
                null,
                React.createElement("textarea", {
                    id: props.id,
                    placeholder: props.placeholder,
                    value: props.value,
                    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => props.onChange(e.target.value),
                }),
                props.variables.map((v) =>
                    React.createElement(
                        "button",
                        { key: v.key, type: "button", onClick: () => props.onVariableClick?.(v.key) },
                        `chip:${v.key}`,
                    ),
                ),
            );
        }),
    };
});

const NAME_VAR: TemplateVariable = { key: "name", label: "이름", type: "text", required: true };

function getPopover() {
    return document.querySelector('[data-component="test_editor_variable-popover"]') as HTMLElement;
}

describe("TemplateContentEditor", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("opens an editable popover (with a real input) when onVariableChange is given", () => {
        const handleChange = jest.fn();
        render(
            <TemplateContentEditor
                dataComponent="test_editor"
                content=""
                onContentChange={() => {}}
                variables={[NAME_VAR]}
                onVariableChange={handleChange}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "chip:name" }));

        const popover = getPopover();
        expect(popover).toBeInTheDocument();
        expect(popover.querySelector("#label-name")).toBeInTheDocument();
    });

    it("shows a read-only summary with no form controls when onVariableChange is omitted", () => {
        render(
            <TemplateContentEditor
                dataComponent="test_editor"
                content=""
                onContentChange={() => {}}
                variables={[NAME_VAR]}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: "chip:name" }));

        const popover = getPopover();
        expect(within(popover).getByText("{{name}}")).toBeInTheDocument();
        expect(within(popover).getByText("이름")).toBeInTheDocument();
        expect(within(popover).getByText("필수")).toBeInTheDocument();

        expect(within(popover).queryAllByRole("textbox")).toHaveLength(0);
        expect(within(popover).queryAllByRole("checkbox")).toHaveLength(0);
        expect(within(popover).queryAllByRole("combobox")).toHaveLength(0);
    });

    it("shows SMS/LMS byte counts, or the too-long message past MAX_BODY_LENGTH", () => {
        const getFooter = () =>
            document.querySelector('[data-component="test_editor_content-footer"]') as HTMLElement;

        // getTextByteLength is UTF-8: each Korean syllable is 3 bytes, so 30
        // chars = 90 bytes (== SMS_BYTE_LIMIT, still SMS) and 31 = 93 (LMS).
        const { rerender } = render(
            <TemplateContentEditor
                dataComponent="test_editor"
                content={"가".repeat(30)}
                onContentChange={() => {}}
                variables={[]}
            />
        );
        expect(getFooter().textContent).toBe("90 bytes · SMS");

        rerender(
            <TemplateContentEditor
                dataComponent="test_editor"
                content={"가".repeat(31)}
                onContentChange={() => {}}
                variables={[]}
            />
        );
        expect(getFooter().textContent).toBe("93 bytes · LMS 자동 전환");

        rerender(
            <TemplateContentEditor
                dataComponent="test_editor"
                content={"가".repeat(2001)}
                onContentChange={() => {}}
                variables={[]}
            />
        );
        expect(getFooter().textContent).toBe("메시지가 최대 길이(2,000자)를 초과했습니다.");
    });

    it("renders the quickInsert slot and forwards insertVariable through the ref", () => {
        const ref = createRef<TemplateContentEditorHandle>();
        render(
            <TemplateContentEditor
                ref={ref}
                dataComponent="test_editor"
                content=""
                onContentChange={() => {}}
                variables={[]}
                quickInsert={<button type="button">quick-insert-slot</button>}
            />
        );

        expect(screen.getByText("quick-insert-slot")).toBeInTheDocument();

        act(() => {
            ref.current?.insertVariable("name");
        });

        expect(mockInsertVariable).toHaveBeenCalledWith("name");
    });
});
