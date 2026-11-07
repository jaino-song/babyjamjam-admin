import { render, screen } from "@testing-library/react";
import { AnimatedSlotList } from "./AnimatedSlotList";

type Row = { id: string; name: string; group?: string; label?: string };
const rows: Row[] = [
  { id: "GREETING", name: "첫 인사", group: "mother", label: "산모 대상" },
  { id: "CONTRACT_GUIDE", name: "계약서 작성 안내", group: "mother", label: "산모 대상" },
  { id: "PROVIDER_NOTICE", name: "제공인력 안내문", group: "provider", label: "제공인력 대상" },
];
const group = (row: Row) => row.group && row.label ? { id: row.group, label: row.label } : undefined;

describe("AnimatedSlotList optional groups", () => {
  it("renders one heading at each group boundary without changing item order", () => {
    const { container } = render(<AnimatedSlotList data-component="desktop_messages_templates_list" items={rows} isLoading={false}
      getItemGroup={group} render={({ item }) => item?.name} />);
    expect(screen.getAllByRole("heading").map((node) => node.textContent)).toEqual(["산모 대상", "제공인력 대상"]);
    expect(container.textContent).toBe("산모 대상첫 인사계약서 작성 안내제공인력 대상제공인력 안내문");
    expect(screen.getByText("산모 대상")).toHaveAttribute("data-component", "desktop_messages_templates_list_group-mother_heading");
  });

  it("keeps old responses and loading placeholders ungrouped", () => {
    const view = render(<AnimatedSlotList items={rows.map(({ id, name }) => ({ id, name }))} isLoading={false}
      getItemGroup={group} render={({ item }) => item?.name} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    view.rerender(<AnimatedSlotList items={rows} isLoading getItemGroup={group} render={() => null} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
