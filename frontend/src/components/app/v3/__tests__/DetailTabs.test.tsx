import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DetailTabPanels } from "../DetailTabPanels";
import { DetailTabs } from "../DetailTabs";

function DetailTabsHarness() {
  const [activeTab, setActiveTab] = useState("basic");
  const tabs = [
    { key: "basic", label: "기본 정보" },
    { key: "contracts", label: "계약서 정보" },
  ];

  return (
    <>
      <DetailTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="고객 상세 정보"
        idPrefix="dashboard-client-detail"
      />
      <DetailTabPanels
        panels={[
          { key: "basic", children: "기본 본문" },
          { key: "contracts", children: "계약서 본문" },
        ]}
        activeTab={activeTab}
        idPrefix="dashboard-client-detail"
      />
    </>
  );
}

describe("DetailTabs", () => {
  it("connects tabs to panels and supports arrow-key navigation", () => {
    render(<DetailTabsHarness />);

    const basicTab = screen.getByRole("tab", { name: "기본 정보" });
    const contractsTab = screen.getByRole("tab", { name: "계약서 정보" });
    const basicPanel = screen.getByRole("tabpanel", { name: "기본 정보" });
    const contractsPanel = document.querySelector<HTMLElement>(
      "#dashboard-client-detail-panel-contracts",
    );

    expect(screen.getByRole("tablist", { name: "고객 상세 정보" })).toBeInTheDocument();
    expect(basicTab).toHaveAttribute("aria-selected", "true");
    expect(basicTab).toHaveAttribute("aria-controls", basicPanel.id);
    expect(contractsPanel).toHaveAttribute("aria-hidden", "true");
    expect(contractsPanel).toHaveAttribute("inert");

    fireEvent.keyDown(basicTab, { key: "ArrowRight" });

    expect(contractsTab).toHaveAttribute("aria-selected", "true");
    expect(contractsTab).toHaveFocus();
    expect(contractsPanel).toHaveAttribute("aria-hidden", "false");
    expect(contractsPanel).not.toHaveAttribute("inert");
  });
});
