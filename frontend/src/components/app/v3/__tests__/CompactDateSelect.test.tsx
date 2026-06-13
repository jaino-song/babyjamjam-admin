import "@testing-library/jest-dom";
import { render } from "@testing-library/react";

import { CompactDateSelect } from "../CompactDateSelect";

describe("CompactDateSelect", () => {
  it("uses the same compact width for the trigger and dropdown content", () => {
    const { container } = render(
      <CompactDateSelect
        value="2026"
        onValueChange={jest.fn()}
        defaultOpen
        options={[
          { label: "2025년", value: "2025" },
          { label: "2026년", value: "2026" },
        ]}
      />,
    );

    expect(container.querySelector('[data-slot="select-trigger"]')).toHaveClass(
      "w-[4.75rem]",
      "justify-between",
    );
    expect(document.body.querySelector('[data-slot="select-content"]')).toHaveClass(
      "!min-w-[4.75rem]",
      "w-[4.75rem]",
    );
    expect(document.body.querySelector('[data-slot="select-item"][data-state="checked"]')).toHaveClass(
      "data-[state=checked]:!bg-[hsl(var(--v3-primary))]",
      "data-[state=checked]:!text-white",
      "[&_span[data-slot=select-item-indicator]]:hidden",
    );
  });
});
