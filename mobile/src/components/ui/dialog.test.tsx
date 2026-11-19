import { render, screen } from "@testing-library/react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

describe("Dialog", () => {
  it("centers the header at every viewport width", () => {
    const { container } = render(<DialogHeader>제목</DialogHeader>);

    expect(container.firstChild).toHaveClass("text-center");
    expect(container.firstChild).not.toHaveClass("sm:text-left");
  });

  it("renders a 32px close button with a 44px hit area and the existing glyph size", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>제목</DialogTitle>
          <DialogDescription>설명</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "absolute", "h-8", "w-8", "after:absolute", "after:-inset-1.5", "after:content-['']",
      "[&_svg:not([class*='size-'])]:size-4",
    );
  });
});
