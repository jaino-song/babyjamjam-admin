import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

// jsdom needs pointerType to exercise the mouse, touch and pen paths separately.
const originalPointerEvent = Object.getOwnPropertyDescriptor(window, "PointerEvent");
beforeAll(() => {
  if (!originalPointerEvent) {
    class PointerEventPolyfill extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "";
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: PointerEventPolyfill, configurable: true });
  }
});
afterAll(() => {
  if (!originalPointerEvent) delete (window as { PointerEvent?: typeof PointerEvent }).PointerEvent;
});

describe("Autocomplete completed activation", () => {
  it.each(["touch", "pen"])("keeps %s contact and cancelled scrolling inert", (pointerType) => {
    const onChange = jest.fn();
    renderAutocomplete({ onChange });
    fireEvent.focus(screen.getByLabelText("산모"));
    const option = screen.getByText("김산모");

    expect(fireEvent.pointerDown(option, { pointerType, clientY: 180 })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("test_autocomplete_dropdown")).toBeVisible();

    fireEvent.pointerMove(option, { pointerType, clientY: 100 });
    fireEvent.pointerMove(document.body, { pointerType, clientY: 20 });
    fireEvent.pointerCancel(option, { pointerType });

    // A browser cancels the native click during scrolling; jsdom cannot simulate scrolling.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("산모")).toHaveValue("");
    expect(screen.getByTestId("test_autocomplete_dropdown")).toBeVisible();
  });

  it.each(["touch", "pen"])("selects exactly once after a completed %s click", (pointerType) => {
    const onChange = jest.fn();
    const secondItem = { id: 2, name: "이산모" };
    renderAutocomplete({ onChange, items: [...items, secondItem] });
    const input = screen.getByLabelText("산모");
    fireEvent.focus(input);
    const option = screen.getByText(secondItem.name);

    fireEvent.pointerDown(option, { pointerType });
    fireEvent.pointerUp(option, { pointerType });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(secondItem);
    expect(input).toHaveValue(secondItem.name);
    expect(screen.queryByTestId("test_autocomplete_dropdown")).not.toBeInTheDocument();
  });

  it("preserves mouse focus until a completed click selects", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderAutocomplete({ onChange });
    const input = screen.getByLabelText("산모");
    await user.click(input);
    const option = screen.getByText("김산모");

    await user.pointer({ target: option, keys: "[MouseLeft>]" });
    expect(input).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.pointer({ target: option, keys: "[/MouseLeft]" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(items[0]);
    expect(input).toHaveValue("김산모");
    expect(screen.queryByTestId("test_autocomplete_dropdown")).not.toBeInTheDocument();
  });

  it("selects the keyboard-highlighted item with ArrowDown and Enter", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    renderAutocomplete({ onChange });
    await user.click(screen.getByLabelText("산모"));
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(items[0]);
    expect(screen.getByLabelText("산모")).toHaveValue("김산모");
    expect(screen.queryByTestId("test_autocomplete_dropdown")).not.toBeInTheDocument();
  });

  it("keeps a disabled field inert for mouse and keyboard", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    const onSelect = jest.fn();
    renderAutocomplete({ disabled: true, onChange, manualEntry: { label: "직접 입력", onSelect } });
    const input = screen.getByLabelText("산모");
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(input).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("test_autocomplete_dropdown")).not.toBeInTheDocument();
  });
});

describe("Autocomplete manual-entry activation", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  it.each(["touch", "pen"])("does not schedule manual entry on %s contact or cancellation", (pointerType) => {
    const onSelect = jest.fn();
    renderAutocomplete({ manualEntry: { label: "직접 입력", onSelect } });
    fireEvent.change(screen.getByLabelText("산모"), { target: { value: "새 수신자" } });
    const option = screen.getByText("직접 입력");

    expect(fireEvent.pointerDown(option, { pointerType, clientY: 180 })).toBe(true);
    act(() => jest.advanceTimersByTime(200));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("test_autocomplete_dropdown")).toBeVisible();
    fireEvent.pointerMove(document.body, { pointerType, clientY: 20 });
    fireEvent.pointerCancel(option, { pointerType });
    act(() => jest.advanceTimersByTime(200));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("test_autocomplete_dropdown")).toBeVisible();
  });

  it.each(["touch", "pen", "mouse"])("delays manual entry until after a completed %s click", (pointerType) => {
    const onSelect = jest.fn();
    renderAutocomplete({ manualEntry: { label: "직접 입력", onSelect } });
    fireEvent.change(screen.getByLabelText("산모"), { target: { value: "새 수신자" } });
    const option = screen.getByText("직접 입력");

    fireEvent.pointerDown(option, { pointerType });
    fireEvent.pointerUp(option, { pointerType });
    act(() => jest.advanceTimersByTime(200));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(option);

    expect(screen.queryByTestId("test_autocomplete_dropdown")).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(99));
    expect(onSelect).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("새 수신자");
  });
});

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
