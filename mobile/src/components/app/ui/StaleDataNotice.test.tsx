import { render, screen } from "@testing-library/react";

import { StaleDataNotice } from "./StaleDataNotice";

const DC = "mobile_clients_detail-sheet_stack_list-page_content_list-card_body_cached-error";
const MESSAGE = "새로 불러오지 못해 최근에 확인된 목록을 표시하고 있어요";

describe("StaleDataNotice", () => {
  it("renders the exact message and status root with caller and component annotations", () => {
    render(<StaleDataNotice dataComponent={DC} message={MESSAGE} />);

    const root = screen.getByRole("status");
    expect(root.tagName).toBe("P");
    expect(root).toHaveAttribute("data-component", DC);
    expect(root).toHaveAttribute("data-source-component", "StaleDataNotice");
    expect(root).toHaveAttribute("data-slot", "stale-data-notice");
    expect(root.textContent).toBe(MESSAGE);
  });

  it("hides the decorative icon from assistive technology and offers no button", () => {
    render(<StaleDataNotice dataComponent={DC} message={MESSAGE} />);

    expect(screen.getByRole("status").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
