import { fireEvent, render, screen } from "@testing-library/react";

import { AnimatedSlotList } from "./AnimatedSlotList";

type TestItem = { id: string; label: string };

const item: TestItem = { id: "feedback-1", label: "QA 피드백" };

function renderItem({ item: value }: { item: TestItem | null }) {
    return value ? <span>{value.label}</span> : null;
}

describe("AnimatedSlotList navigation semantics", () => {
    it("renders loaded items as keyboard-focusable native links", () => {
        render(
            <AnimatedSlotList<TestItem>
                data-component="mobile_test_feedback-list"
                items={[item]}
                isLoading={false}
                getSlotHref={(value) => `/admin/feedback/${value.id}`}
                render={renderItem}
            />,
        );

        const link = screen.getByRole("link", { name: "QA 피드백" });
        expect(link).toHaveAttribute("href", "/admin/feedback/feedback-1");

        link.focus();
        expect(link).toHaveFocus();
    });

    it("keeps loading and empty slots non-interactive", () => {
        const { rerender } = render(
            <AnimatedSlotList<TestItem>
                data-component="mobile_test_feedback-list"
                items={[item]}
                isLoading
                loadingCount={1}
                getSlotHref={(value) => `/admin/feedback/${value.id}`}
                render={renderItem}
            />,
        );

        expect(screen.queryByRole("link")).not.toBeInTheDocument();

        rerender(
            <AnimatedSlotList<TestItem>
                data-component="mobile_test_feedback-list"
                count={1}
                items={[]}
                isLoading={false}
                hideEmptySlots={false}
                getSlotHref={(value) => `/admin/feedback/${value.id}`}
                render={renderItem}
            />,
        );

        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("preserves the legacy click wrapper when no href resolver is supplied", () => {
        const onSlotClick = jest.fn();

        render(
            <AnimatedSlotList<TestItem>
                data-component="mobile_test_feedback-list"
                items={[item]}
                isLoading={false}
                onSlotClick={onSlotClick}
                render={renderItem}
            />,
        );

        const slot = screen.getByText("QA 피드백").closest("div");
        expect(slot).toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();

        fireEvent.click(slot!);

        expect(onSlotClick).toHaveBeenCalledWith(item, 0);
    });
});
