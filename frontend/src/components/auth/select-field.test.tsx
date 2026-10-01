import * as React from "react";
import { render, screen } from "@testing-library/react";
import { expectNoFieldMessageBelowControl } from "@/test-utils/field-message-slot";
import { SelectField } from "./select-field";

const options = [{ value: "user", label: "일반 사용자" }];
const SLOT_SELECTOR = '[data-component="desktop_auth_form-field_label-row_trailing"]';

describe("SelectField", () => {
  it("renders an error in the label-row slot, never below the select", () => {
    const { container } = render(
      <SelectField
        label="역할"
        value=""
        onValueChange={() => {}}
        options={options}
        error="역할을 선택해주세요."
      />
    );

    const error = screen.getByText("역할을 선택해주세요.");

    expect(document.querySelector(SLOT_SELECTOR)).toContainElement(error);
    expect(error).toHaveAttribute("data-slot", "field-error-message");
    expectNoFieldMessageBelowControl(container);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the label on one line and shows the hint until an error replaces it", () => {
    const { rerender } = render(
      <SelectField
        label="역할"
        value=""
        onValueChange={() => {}}
        options={options}
        labelTrailing={<span>권한을 요청해요</span>}
      />
    );
    expect(screen.getByText("역할")).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(screen.getByText("권한을 요청해요")).toBeInTheDocument();

    rerender(
      <SelectField
        label="역할"
        value=""
        onValueChange={() => {}}
        options={options}
        labelTrailing={<span>권한을 요청해요</span>}
        error="역할을 선택해주세요."
      />
    );
    expect(screen.queryByText("권한을 요청해요")).not.toBeInTheDocument();

    rerender(
      <SelectField
        label="역할"
        value=""
        onValueChange={() => {}}
        options={options}
        labelTrailing={<span>권한을 요청해요</span>}
      />
    );
    expect(screen.getByText("권한을 요청해요")).toBeInTheDocument();
  });

  it("leaves the slot empty when there is nothing to say", () => {
    render(<SelectField label="역할" value="" onValueChange={() => {}} options={options} />);

    expect(document.querySelector(SLOT_SELECTOR)).toBeNull();
  });
});
