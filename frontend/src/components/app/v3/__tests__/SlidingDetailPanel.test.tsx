import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { SlidingDetailPanel } from "../SlidingDetailPanel";

function Harness() {
    const [open, setOpen] = useState(false);
    return <SlidingDetailPanel data-component="test_slide" open={open} onBack={() => setOpen(false)}
        backLabel="일정으로 돌아가기"
        list={<button onClick={() => setOpen(true)}>고객 일정</button>}
        detail={<div>고객 상세 정보</div>} />;
}

test("isolates inactive panes and restores row focus after back or Escape without unmounting", () => {
    const { container } = render(<Harness />);
    const row = screen.getByRole("button", { name: "고객 일정" });
    row.focus();
    fireEvent.click(row);
    const back = screen.getByRole("button", { name: "일정으로 돌아가기" });
    expect(back).toHaveFocus();
    expect(container.querySelector('[data-slot="sliding-detail-list"]')).toHaveAttribute("inert");
    fireEvent.keyDown(back, { key: "Escape" });
    expect(row).toHaveFocus();
    expect(container.querySelector('[data-slot="sliding-detail-content"]')).toHaveAttribute("inert");
    expect(screen.getByText("고객 상세 정보")).toBeInTheDocument();
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "일정으로 돌아가기" }));
    expect(row).toHaveFocus();
    expect(container.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "false");
});
