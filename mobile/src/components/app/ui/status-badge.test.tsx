import { render, screen } from "@testing-library/react";

import { StatusBadge as V3StatusBadge } from "@/components/app/v3/StatusBadge";

import { StatusPill } from "./status-badge";

describe("rejected_by_reviewer (반려됨, eformsign 071, 계약-04)", () => {
  it("renders a solid burgundy fill with white text, stronger than the soft danger pill", () => {
    render(
      <>
        <StatusPill data-component="test_rejected" variant="rejected_by_reviewer">반려됨</StatusPill>
        <StatusPill data-component="test_danger" variant="danger">기간 만료</StatusPill>
      </>,
    );

    expect(screen.getByText("반려됨")).toHaveClass(
      "bg-status-danger-solid",
      "border-status-danger-solid",
      "text-status-danger-solid-fg",
    );
    const soft = screen.getByText("기간 만료");
    expect(soft).toHaveClass("bg-status-danger", "text-status-danger-fg");
    expect(soft).not.toHaveClass("bg-status-danger-solid");
  });

  it("is reachable through the v3 StatusBadge with the 반려됨 label by default", () => {
    render(<V3StatusBadge data-component="test_v3" status="rejected_by_reviewer" />);

    expect(screen.getByText("반려됨")).toHaveClass("bg-status-danger-solid", "text-status-danger-solid-fg");
  });
});
