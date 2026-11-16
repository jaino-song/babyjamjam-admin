import { fireEvent, render, screen } from "@testing-library/react";

import { AddCategoryModal } from "./add-category-modal";

describe("AddCategoryModal title alignment", () => {
  it("centers the title between equal side columns and keeps close reachable", () => {
    const onClose = jest.fn();
    render(
      <AddCategoryModal
        data-component="mobile_documents_add-category-modal"
        open
        onClose={onClose}
        onAdd={jest.fn()}
        existingColors={[]}
      />,
    );

    const title = screen.getByRole("heading", { name: "태그 추가" });
    expect(title).toHaveClass("text-center", "col-start-2", "min-w-0");
    expect(title).not.toHaveClass("text-left");
    expect(title.parentElement).toHaveClass("grid", "grid-cols-[32px_minmax(0,1fr)_32px]");
    const close = title.parentElement!.querySelector("button")!;
    expect(close).toHaveClass("h-8", "w-8");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
