import { fireEvent, render, screen } from "@testing-library/react";

import { FormNativeSelect } from "./form-section";

describe("FormNativeSelect", () => {
  it("renders flat and grouped options and reports the selected value", () => {
    const onValueChange = jest.fn();

    render(
      <FormNativeSelect
        aria-label="바우처 유형"
        value=""
        onValueChange={onValueChange}
        options={[
          { value: "", label: "선택하세요" },
          {
            label: "단태아",
            options: [{ value: "A-통합-1형", label: "통합 1형" }],
          },
        ]}
      />,
    );

    const select = screen.getByRole("combobox", { name: "바우처 유형" });
    expect(screen.getByRole("group", { name: "단태아" })).toBeInTheDocument();
    expect(select).toHaveClass("h-[44px]", "py-0", "border-input");

    fireEvent.change(select, { target: { value: "A-통합-1형" } });

    expect(onValueChange).toHaveBeenCalledWith("A-통합-1형");
  });

  it("can hide the decorative chevron while keeping the select disabled", () => {
    const { container } = render(
      <FormNativeSelect
        aria-label="기간"
        value=""
        disabled
        hideIcon
        options={[{ value: "", label: "선택하세요" }]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "기간" })).toBeDisabled();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
