import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChangeEvent, Ref } from "react";

import { TemplateEditor } from "../template-editor";
import type { VariableChipEditorHandle } from "../variable-chip-editor";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockInsertVariable = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

interface MockChipEditorProps {
    id?: string;
    placeholder?: string;
    value: string;
    onChange: (value: string) => void;
    variables: { key: string }[];
    onVariableClick?: (key: string) => void;
}

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));
jest.mock("@/hooks/use-message-templates", () => ({
    useCreateMessageTemplate: () => ({ mutate: mockCreate, isPending: false }),
    useUpdateMessageTemplate: () => ({ mutate: mockUpdate, isPending: false }),
}));
jest.mock("../variable-chip-editor", () => {
    // jest.mock factories are hoisted above this file's imports, so the
    // top-level `react` import isn't in scope here (Jest throws "module
    // factory ... not allowed to reference any out-of-scope variables" if we
    // try) -- require() is the only way to reach React inside the factory.
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

// `label` is deliberately not a PRESET_VARIABLES value ("이름" collides with the
// quick-insert preset badge and the preview panel, producing duplicate text matches).
const INITIAL = {
    id: "t1",
    name: "인사말",
    content: "안녕하세요 {{name}}님",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    variables: [{ key: "name", label: "고객명", type: "text" as const, required: true }],
};

describe("TemplateEditor", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders the initial name/content and the quick-insert row", () => {
        const { container } = render(<TemplateEditor initialData={INITIAL} />);

        expect((document.getElementById("template-name") as HTMLInputElement).value).toBe("인사말");
        expect((document.getElementById("template-content") as HTMLTextAreaElement).value).toBe(
            "안녕하세요 {{name}}님"
        );

        const quickInsert = container.querySelector(
            '[data-component="desktop_my-templates_variable-inserter"]'
        ) as HTMLElement;
        expect(within(quickInsert).getByText("이름")).toBeInTheDocument();
        expect(within(quickInsert).getByText("커스텀 변수")).toBeInTheDocument();
    });

    it("clicking a preset chip in the quick-insert row inserts that variable", () => {
        const { container } = render(<TemplateEditor initialData={INITIAL} />);

        const quickInsert = container.querySelector(
            '[data-component="desktop_my-templates_variable-inserter"]'
        ) as HTMLElement;
        fireEvent.click(within(quickInsert).getByText("연락처"));

        expect(mockInsertVariable).toHaveBeenCalledWith("phone");
    });

    it("edits made in the variable settings card carry through to the save payload", () => {
        render(<TemplateEditor initialData={INITIAL} />);

        fireEvent.change(document.getElementById("label-name") as HTMLInputElement, {
            target: { value: "산모님" },
        });
        fireEvent.click(screen.getByRole("button", { name: "저장" }));

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        const [payload] = mockUpdate.mock.calls[0];
        expect(payload.request.variables[0].label).toBe("산모님");
    });

    it("saves via update and navigates on success; saves via create for a new template", () => {
        const first = render(<TemplateEditor initialData={INITIAL} />);

        fireEvent.click(screen.getByRole("button", { name: "저장" }));

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockUpdate.mock.calls[0][0]).toEqual({
            id: "t1",
            request: {
                name: INITIAL.name,
                content: INITIAL.content,
                variables: INITIAL.variables,
            },
        });

        act(() => {
            mockUpdate.mock.calls[0][1].onSuccess();
        });
        expect(mockPush).toHaveBeenCalledWith("/messages/templates");

        first.unmount();

        render(<TemplateEditor />);
        fireEvent.change(document.getElementById("template-name") as HTMLInputElement, {
            target: { value: "새 템플릿" },
        });
        fireEvent.change(document.getElementById("template-content") as HTMLTextAreaElement, {
            target: { value: "안녕하세요" },
        });
        fireEvent.click(screen.getByRole("button", { name: "저장" }));

        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("removing a variable from the content closes any popover open on it (regression)", async () => {
        const initial = {
            id: "t2",
            name: "안내",
            content: "안녕 {{phone}}",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
            variables: [{ key: "phone", label: "고객 연락처", type: "text" as const, required: true }],
        };

        render(<TemplateEditor initialData={initial} />);

        fireEvent.click(screen.getByRole("button", { name: "chip:phone" }));
        expect(document.querySelectorAll("#label-phone").length).toBe(2);

        fireEvent.change(document.getElementById("template-content") as HTMLTextAreaElement, {
            target: { value: "안녕" },
        });

        await waitFor(() => {
            expect(document.querySelectorAll("#label-phone").length).toBe(0);
        });
    });
});
