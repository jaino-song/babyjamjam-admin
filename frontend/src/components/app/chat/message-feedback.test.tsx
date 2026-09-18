import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessageFeedback } from "./message-feedback";

jest.mock("./feedback-modal", () => ({
    FeedbackModal: ({
        open,
        onSubmit,
    }: {
        open: boolean;
        onClose: () => void;
        onSubmit: (comment: string) => void;
    }) => open ? (
        <button type="button" onClick={() => onSubmit("설명이 필요해요")}>
            부정 피드백 제출
        </button>
    ) : null,
}));

describe("MessageFeedback accessibility", () => {
    it("names both feedback controls and preserves positive and negative callbacks", async () => {
        const onSubmitFeedback = jest.fn().mockResolvedValue(undefined);

        render(
            <MessageFeedback
                messageId="message-1"
                sessionId="session-1"
                onSubmitFeedback={onSubmitFeedback}
            />,
        );

        const positiveButton = screen.getByRole("button", { name: "도움이 됐어요" });
        const negativeButton = screen.getByRole("button", { name: "개선이 필요해요" });

        expect(positiveButton).toBeInTheDocument();
        expect(negativeButton).toBeInTheDocument();

        fireEvent.click(positiveButton);
        await waitFor(() => expect(onSubmitFeedback).toHaveBeenCalledWith("positive"));

        expect(positiveButton).toBeDisabled();
        expect(negativeButton).toBeDisabled();

        const secondSubmitFeedback = jest.fn().mockResolvedValue(undefined);
        render(
            <MessageFeedback
                messageId="message-2"
                sessionId="session-2"
                onSubmitFeedback={secondSubmitFeedback}
            />,
        );

        fireEvent.click(screen.getAllByRole("button", { name: "개선이 필요해요" })[1]!);
        fireEvent.click(screen.getByRole("button", { name: "부정 피드백 제출" }));

        await waitFor(() => {
            expect(secondSubmitFeedback).toHaveBeenCalledWith("negative", "설명이 필요해요");
        });
    });
});
