import { render, screen } from "@testing-library/react";

import { ContractFormField } from "../contract-form-field";

describe("ContractFormField", () => {
  it("keeps the label row and renders no message slot when there is nothing to say", () => {
    render(
      <ContractFormField dataComponent="test_field" label="연락처" htmlFor="phone" required>
        <input id="phone" />
      </ContractFormField>,
    );

    expect(document.querySelector('[data-component="test_field_label-row"]')).not.toBeNull();
    expect(document.querySelector("[data-slot]")).toBeNull();
    expect(screen.getByLabelText(/연락처/)).toBeInTheDocument();
  });

  it("renders one polite message inside the label row with the tone of its slot", () => {
    render(
      <ContractFormField
        dataComponent="test_field"
        label="연락처"
        htmlFor="phone"
        message={{ slot: "field-error-message", id: "phone-message", text: "010-1234-5678 형식으로 입력해 주세요" }}
      >
        <input id="phone" aria-describedby="phone-message" />
      </ContractFormField>,
    );

    const message = screen.getByText("010-1234-5678 형식으로 입력해 주세요");
    expect(message.closest('[data-component="test_field_label-row"]')).not.toBeNull();
    expect(message).toHaveAttribute("id", "phone-message");
    expect(message).toHaveAttribute("aria-live", "polite");
    expect(message).toHaveAttribute("data-component", "test_field_field-error-message");
    expect(message).toHaveClass("message", "tone_error");
  });

  it("uses the green tone for the registered-value hint and no tone class for hints", () => {
    const { rerender } = render(
      <ContractFormField
        dataComponent="test_field"
        label="주소"
        message={{ slot: "registered-value-diff-hint", id: "m", text: "등록된 정보와 달라요." }}
      >
        <input />
      </ContractFormField>,
    );
    expect(screen.getByText("등록된 정보와 달라요.")).toHaveClass("tone_ok");

    rerender(
      <ContractFormField
        dataComponent="test_field"
        label="주소"
        message={{ slot: "field-hint-message", id: "m", text: "YYYY-MM-DD 형식" }}
      >
        <input />
      </ContractFormField>,
    );
    const hint = screen.getByText("YYYY-MM-DD 형식");
    expect(hint).not.toHaveClass("tone_ok");
    expect(hint).not.toHaveClass("tone_error");
  });
});
