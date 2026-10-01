import { render, screen } from "@testing-library/react";

import { Autocomplete } from "./Autocomplete";

type Item = { id: number; name: string };

const items: Item[] = [{ id: 1, name: "김산모" }];

const renderAutocomplete = (props: Partial<React.ComponentProps<typeof Autocomplete<Item>>> = {}) =>
  render(
    <Autocomplete<Item>
      name="client"
      data-component="test_autocomplete"
      value={null}
      onChange={jest.fn()}
      items={items}
      getItemKey={(item) => item.id}
      getItemLabel={(item) => item.name}
      label="산모"
      {...props}
    />,
  );

const slotOf = (input: HTMLElement) =>
  document.getElementById(input.getAttribute("aria-describedby") ?? "") as HTMLElement;

describe("Autocomplete label-row slot", () => {
  it("shows an empty polite slot when nothing applies", () => {
    renderAutocomplete();

    const input = screen.getByLabelText("산모");
    expect(slotOf(input)).toBeEmptyDOMElement();
    expect(slotOf(input)).toHaveAttribute("aria-live", "polite");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  it("shows helperText as guidance in the slot, never below the input", () => {
    renderAutocomplete({ helperText: "이름이나 연락처로 찾아요" });

    const input = screen.getByLabelText("산모");
    expect(slotOf(input)).toHaveTextContent("이름이나 연락처로 찾아요");
    expect(screen.getAllByText("이름이나 연락처로 찾아요")).toHaveLength(1);
    expect(document.querySelectorAll("p")).toHaveLength(0);
  });

  it("lets the message replace the guidance and gives the guidance back when it clears", () => {
    const { rerender } = renderAutocomplete({
      helperText: "이름이나 연락처로 찾아요",
      message: { text: "산모를 선택해 주세요", tone: "err" },
      error: true,
    });
    const props = {
      name: "client",
      "data-component": "test_autocomplete",
      value: null,
      onChange: jest.fn(),
      items,
      getItemKey: (item: Item) => item.id,
      getItemLabel: (item: Item) => item.name,
      label: "산모",
      helperText: "이름이나 연락처로 찾아요",
    };

    let input = screen.getByLabelText("산모");
    expect(slotOf(input)).toHaveTextContent("산모를 선택해 주세요");
    expect(slotOf(input)).not.toHaveTextContent("이름이나 연락처로 찾아요");
    expect(input).toHaveAttribute("aria-invalid", "true");

    rerender(<Autocomplete<Item> {...props} message={null} />);
    input = screen.getByLabelText("산모");
    expect(slotOf(input)).toHaveTextContent("이름이나 연락처로 찾아요");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });
});
