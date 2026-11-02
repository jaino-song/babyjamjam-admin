import { render } from "@testing-library/react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

function renderSheet(overlayClassName?: string) {
  render(
    <Sheet open>
      <SheetContent overlayClassName={overlayClassName}>
        <SheetTitle>제목</SheetTitle>
        <SheetDescription>설명</SheetDescription>
      </SheetContent>
    </Sheet>,
  );
  return {
    overlay: document.querySelector('[data-slot="sheet-overlay"]'),
    content: document.querySelector('[data-slot="sheet-content"]'),
  };
}

describe("SheetContent overlayClassName", () => {
  it("keeps the default z-50 overlay and content when overlayClassName is not passed", () => {
    const { overlay, content } = renderSheet();

    expect(overlay).toHaveClass("z-50");
    expect(content).toHaveClass("z-50");
  });

  it("merges overlayClassName into the overlay only, overriding its default z-index", () => {
    const { overlay, content } = renderSheet("z-[200]");

    expect(overlay).toHaveClass("z-[200]");
    expect(overlay).not.toHaveClass("z-50");
    expect(content).toHaveClass("z-50");
    expect(content).not.toHaveAttribute("overlayClassName");
  });
});
