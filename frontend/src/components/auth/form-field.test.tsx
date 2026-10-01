import * as React from "react";
import { render, screen } from "@testing-library/react";
import { expectNoFieldMessageBelowControl } from "@/test-utils/field-message-slot";
import { FormField } from "./form-field";

const SLOT_SELECTOR = '[data-component="desktop_auth_form-field_label-row_trailing"]';

describe("FormField", () => {
  it("renders an error in the label-row slot, never below the input", () => {
    render(
      <FormField
        label="이메일"
        value=""
        onChange={() => {}}
        error="이메일을 입력해 주세요."
      />
    );

    const error = screen.getByText("이메일을 입력해 주세요.");
    const slot = document.querySelector(SLOT_SELECTOR);

    expect(slot).toBeTruthy();
    expect(slot).toContainElement(error);
    expect(error).toHaveAttribute("data-slot", "field-error-message");
    expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("이메일").getAttribute("aria-describedby")).toBe(error.id);
  });

  it("keeps the label on one line and renders nothing after the input", () => {
    const { container } = render(
      <FormField
        label="비밀번호 확인"
        value="mismatch"
        onChange={() => {}}
        error="비밀번호가 일치하지 않아요."
      />
    );

    const input = screen.getByLabelText("비밀번호 확인");
    expect(screen.getByText("비밀번호 확인")).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(input.nextElementSibling).toBeNull();
    expectNoFieldMessageBelowControl(container);
  });

  it("shows the label hint while there is no message and gives way to an error", () => {
    const { rerender } = render(
      <FormField
        label="이메일"
        value=""
        onChange={() => {}}
        labelTrailing={<span>가입한 이메일이에요</span>}
      />
    );
    expect(screen.getByText("가입한 이메일이에요")).toBeInTheDocument();

    rerender(
      <FormField
        label="이메일"
        value=""
        onChange={() => {}}
        labelTrailing={<span>가입한 이메일이에요</span>}
        error="이메일 주소를 확인해 주세요."
      />
    );
    expect(screen.queryByText("가입한 이메일이에요")).not.toBeInTheDocument();
    expect(screen.getByText("이메일 주소를 확인해 주세요.")).toBeInTheDocument();

    rerender(
      <FormField
        label="이메일"
        value=""
        onChange={() => {}}
        labelTrailing={<span>가입한 이메일이에요</span>}
      />
    );
    expect(screen.getByText("가입한 이메일이에요")).toBeInTheDocument();
  });

  it("lets the message prop take the place of error", () => {
    render(
      <FormField
        label="전화번호"
        value=""
        onChange={() => {}}
        error="ignored"
        message={{ tone: "ok", text: "등록 가능한 번호입니다." }}
      />
    );

    expect(screen.getByText("등록 가능한 번호입니다.")).toHaveAttribute("data-slot", "field-message");
    expect(screen.queryByText("ignored")).not.toBeInTheDocument();
    expect(screen.getByLabelText("전화번호")).toHaveAttribute("aria-invalid", "false");
  });
});
