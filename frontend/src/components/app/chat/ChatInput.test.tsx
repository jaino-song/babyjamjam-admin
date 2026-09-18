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
});
