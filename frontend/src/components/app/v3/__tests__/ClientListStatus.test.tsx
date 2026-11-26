import { render, screen } from "@testing-library/react";

import { ClientBadgeMark, ClientListStatus } from "../ClientListStatus";
import { CONTRACT_INFO_MISMATCH_HINT } from "../ContractInfoMismatch";
import { getClientAvatarBadge, getClientBadgeAvatarClassName, prioritizeClientBadges } from "@/lib/client/badges";
import type { ClientBadge } from "@/lib/client/types";

const BASE = "desktop_clients_page_sections_section-content_list-section_split-layout_list-panel_content_item_status_badges";

const mismatchBadge: ClientBadge = {
  key: "contract_info_mismatch",
  status: "review",
  label: "정보 불일치",
  tone: "warning",
  priority: 5,
};
const serviceBadge: ClientBadge = {
  key: "service_status",
  status: "active",
  label: "진행중",
  tone: "primary",
  priority: 20,
};
const careCenterBadge: ClientBadge = {
  key: "care_center",
  status: "careCenter",
  label: "조리원 이용",
  tone: "primary",
  priority: 30,
};

describe("ClientListStatus", () => {
  it("shows the first badge as a pill and the rest as a plain +N count", () => {
    const { container } = render(
      <ClientListStatus data-component={BASE} badges={[serviceBadge, careCenterBadge]} />,
    );

    expect(screen.getByText("진행중")).toHaveAttribute("data-slot", "status-badge");
    expect(screen.queryByText("조리원 이용")).not.toBeInTheDocument();
    const more = screen.getByText("+1");
    expect(more.tagName).toBe("SPAN");
    expect(more).toHaveAttribute("data-component", `${BASE}_more`);
    expect(more).not.toHaveAttribute("data-slot", "status-badge");
    expect(container.firstElementChild).toHaveAttribute("data-source-component", "ClientListStatus");
  });

  it("leads with the bare warning icon when the contract and client info differ", () => {
    const badges = prioritizeClientBadges([serviceBadge, careCenterBadge, mismatchBadge]);
    render(<ClientListStatus data-component={BASE} badges={badges} />);

    const icon = screen.getByRole("img", { name: CONTRACT_INFO_MISMATCH_HINT });
    expect(icon).toHaveAttribute("title", "계약서와 정보가 달라요");
    expect(icon).toHaveAttribute("data-component", `${BASE}_first`);
    expect(icon).toHaveClass("text-v3-orange");
    expect(screen.queryByText("정보 불일치")).not.toBeInTheDocument();
    expect(screen.queryByText("진행중")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("maps the first badge's label for display when asked", () => {
    render(
      <ClientListStatus data-component={BASE} badges={[careCenterBadge]} formatLabel={(label) => `${label}!`} />,
    );
    expect(screen.getByText("조리원 이용!")).toBeInTheDocument();
  });

  it("renders nothing without badges", () => {
    const { container } = render(<ClientListStatus data-component={BASE} badges={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single badge mark without an owned name when none is passed", () => {
    render(<ClientBadgeMark badge={mismatchBadge} />);
    expect(screen.getByRole("img", { name: CONTRACT_INFO_MISMATCH_HINT })).not.toHaveAttribute("data-component");
  });
});

describe("client avatar badge", () => {
  it("keeps the service-status tone when 정보 불일치 leads", () => {
    const badges = prioritizeClientBadges([serviceBadge, mismatchBadge]);

    expect(badges[0]).toBe(mismatchBadge);
    expect(getClientAvatarBadge(badges)).toBe(serviceBadge);
    expect(getClientBadgeAvatarClassName(getClientAvatarBadge(badges))).toContain("bg-status-info");
  });
});
