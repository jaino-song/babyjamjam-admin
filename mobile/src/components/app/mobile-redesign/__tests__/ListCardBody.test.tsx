import { render, screen } from "@testing-library/react";

import { ListCardBody } from "../ListCardBody";

describe("ListCardBody", () => {
  it("preserves the scroll body DOM contract", () => {
    const { container } = render(
      <ListCardBody>
        <p>본문 콘텐츠</p>
      </ListCardBody>,
    );

    expect(container.querySelector('[data-component="mobile-redesign-list-scroll"]'))
      .toHaveClass("list-card-scroll");
    expect(screen.getByText("본문 콘텐츠")).toBeInTheDocument();
  });
});
