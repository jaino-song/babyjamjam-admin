import { render, screen } from "@testing-library/react";
import { PanelTitleGroup } from "../PanelTitleGroup";

test("preserves all title, subtitle, badge and class props with literal full namespaces", () => {
  const { container } = render(<PanelTitleGroup data-component="desktop_test_panel_title-group" title="Panel title" subtitle="Panel subtitle"
    badgesLeft={<span>Left badge</span>} badges={<span>Title badge</span>} badgesRight={<span>Right badge</span>}
    className="root-override" titleClassName="title-override" subtitleClassName="subtitle-override" />);
  const root = container.firstElementChild!;
  expect(root).toHaveAttribute("data-source-component", "PanelTitleGroup");
  expect(root).toHaveClass("flex", "min-w-0", "flex-col", "root-override");
  expect(screen.getByRole("heading", { name: "Panel title" })).toHaveClass("truncate", "font-bold", "text-v3-dark", "title-override");
  expect(screen.getByText("Panel subtitle")).toHaveAttribute("data-slot", "panel-subtitle");
  expect(screen.getByText("Panel subtitle")).toHaveClass("text-v3-text-muted", "subtitle-override");
  const row = root.firstElementChild!;
  expect([...row.children].map((node) => node.textContent)).toEqual(["Left badge", "Panel title", "Title badge", "Right badge"]);
  expect([...root.children]).toEqual([row, screen.getByText("Panel subtitle")]);
  expect(screen.getByText("Right badge").parentElement).toHaveClass("ml-auto", "flex", "shrink-0");
  expect([...container.querySelectorAll("[data-component]")].map((node) => node.getAttribute("data-component"))).toEqual([
    "desktop_test_panel_title-group", "desktop_test_panel_title-group_title-row", "desktop_test_panel_title-group_title-row_title",
    "desktop_test_panel_title-group_title-row_badges-right", "desktop_test_panel_title-group_subtitle",
  ]);
});

test.each([{}, { "data-component": "" }])("omits all owned metadata for %j while retaining optional content", (metadata) => {
  const { container } = render(<PanelTitleGroup title="Optional title" subtitle="Optional subtitle" badgesLeft={<span>Left</span>}
    badges={<span>Middle</span>} badgesRight={<span>Right</span>} {...metadata} />);
  expect(container.firstElementChild).toHaveAttribute("data-source-component", "PanelTitleGroup");
  expect(screen.getByRole("heading", { name: "Optional title" })).toBeInTheDocument();
  expect(screen.getByText("Optional subtitle")).toHaveAttribute("data-slot", "panel-subtitle");
  expect([...container.firstElementChild!.firstElementChild!.children].map((node) => node.textContent)).toEqual(["Left", "Optional title", "Middle", "Right"]);
  expect(container.querySelectorAll("[data-component]")).toHaveLength(0);
});

test("keeps the minimal omitted call and caller-authored badge metadata intact", () => {
  const { container, rerender } = render(<PanelTitleGroup title="Minimal title" />);
  expect(screen.getByRole("heading", { name: "Minimal title" })).toBeInTheDocument();
  expect(container.querySelector('[data-slot="panel-subtitle"]')).toBeNull();
  expect(container.querySelectorAll("[data-component]")).toHaveLength(0);
  rerender(<PanelTitleGroup title="Minimal title" badges={<span data-component="caller_badge">Owned badge</span>} />);
  expect(screen.getByText("Owned badge")).toHaveAttribute("data-component", "caller_badge");
  expect(container.querySelectorAll("[data-component]")).toHaveLength(1);
});
