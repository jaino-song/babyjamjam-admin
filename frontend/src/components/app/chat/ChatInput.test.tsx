import { fireEvent, render, screen } from "@testing-library/react";

import { ChatInput } from "./ChatInput";

describe("ChatInput accessibility", () => {
    it("names the question field and send button while preserving submission", () => {
        const onSubmit = jest.fn();

        render(<ChatInput onSubmit={onSubmit} />);

        const input = screen.getByRole("textbox", { name: "질문 입력" });
        const sendButton = screen.getByRole("button", { name: "전송" });

        expect(input).toBeInTheDocument();
        expect(sendButton).toBeDisabled();

        fireEvent.change(input, { target: { value: "고객 질문" } });
        expect(sendButton).toBeEnabled();

        fireEvent.click(sendButton);

        expect(onSubmit).toHaveBeenCalledWith("고객 질문");
        expect(input).toHaveValue("");
    });
    it.each([{ isComposing: true }, { keyCode: 229 }])("ignores composing Enter %o then submits ordinary Enter", (composition) => {
        const onSubmit = jest.fn();
        render(<ChatInput onSubmit={onSubmit} />);
        const input = screen.getByRole("textbox", { name: "질문 입력" });
        fireEvent.change(input, { target: { value: "  한글 질문  " } });
        fireEvent.keyDown(input, { key: "Enter", ...composition });
        expect(onSubmit).not.toHaveBeenCalled();
        expect(input).toHaveValue("  한글 질문  ");
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith("한글 질문");
        expect(input).toHaveValue("");
    });

    it("keeps disabled and empty Enter from sending", () => {
        const onSubmit = jest.fn();
        const { rerender } = render(<ChatInput onSubmit={onSubmit} />);
        const input = screen.getByRole("textbox", { name: "질문 입력" });
        fireEvent.keyDown(input, { key: "Enter" });
        fireEvent.change(input, { target: { value: "질문" } });
        rerender(<ChatInput onSubmit={onSubmit} disabled />);
        fireEvent.keyDown(input, { key: "Enter" });
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
