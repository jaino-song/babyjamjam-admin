import { render, screen } from "@testing-library/react";

import { DetailTabPanels } from "../DetailTabPanels";

describe("DetailTabPanels", () => {
  it.each([0, 300])("insets every panel's cards without removing slide clipping (duration %s)", (durationMs) => {
    const { container, rerender } = render(
      <DetailTabPanels
        activeTab="basic"
        durationMs={durationMs}
        idPrefix="detail"
        panels={[
          { key: "basic", children: "기본 정보 카드" },
          { key: "contracts", children: "계약 정보 카드" },
        ]}
      />,
    );

    expect(container.firstElementChild).toHaveClass("overflow-hidden");
    for (const panel of screen.getAllByRole("tabpanel", { hidden: true })) {
      expect(panel).toHaveClass("w-full", "shrink-0", "px-px");
    }

    rerender(
      <DetailTabPanels
        activeTab="contracts"
        durationMs={durationMs}
        idPrefix="detail"
        panels={[
          { key: "basic", children: "기본 정보 카드" },
          { key: "contracts", children: "계약 정보 카드" },
        ]}
      />,
    );

    const activePanel = screen.getByRole("tabpanel");
    expect(activePanel).toHaveClass("px-px");
    expect(activePanel).toHaveAttribute("data-panel", "contracts");
    expect(activePanel.parentElement).toHaveStyle({
      transform: durationMs === 0 ? "none" : "translateX(-100%)",
    });
  });
});
