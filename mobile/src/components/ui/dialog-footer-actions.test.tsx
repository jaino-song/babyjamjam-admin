import { render, screen } from "@testing-library/react";

import { Button } from "./button";
import { Dialog, DialogFooter } from "./dialog";

it("places a two-action footer in a row with the secondary action taking one third", () => {
  const { container } = render(<DialogFooter><Button variant="outline">취소</Button><Button>저장</Button></DialogFooter>);
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["취소", "저장"]);
  expect(container.firstChild).toHaveClass("flex-row", "[&>*:first-child]:flex-1", "[&>*:last-child]:flex-[2]");
  expect(container.firstChild).not.toHaveClass("flex-col-reverse");
});

it("preserves the layout and width of a single-action footer", () => {
  const { container } = render(<DialogFooter><Button>닫기</Button></DialogFooter>);
  expect(container.firstChild).toHaveClass("flex-col-reverse", "sm:flex-row", "sm:justify-end");
  expect(container.firstChild).not.toHaveClass("[&>*:first-child]:flex-1");
  expect(container.firstChild).not.toHaveClass("[&>*:last-child]:flex-[2]");
});

it("puts the optional close action before the proceeding action in a two-action footer", () => {
  const { container } = render(<Dialog><DialogFooter showCloseButton><Button>저장</Button></DialogFooter></Dialog>);
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Close", "저장"]);
  expect(container.firstChild).toHaveClass("flex-row", "[&>*:first-child]:flex-1", "[&>*:last-child]:flex-[2]");
});
