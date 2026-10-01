import { render } from "@testing-library/react";

import { FieldMessageText } from "@/components/app/ui/field-message";
import { FormHelperText } from "@/components/app/ui/form-section";
import { expectNoFieldMessageBelowControl } from "@/test-utils/field-message-slot";

describe("expectNoFieldMessageBelowControl", () => {
  it("passes when the message sits in the label row above the control", () => {
    const { container } = render(
      <div>
        <div>
          <label htmlFor="name">이름</label>
          <FieldMessageText tone="hint">한글로 입력해요</FieldMessageText>
        </div>
        <input id="name" />
      </div>,
    );
    expect(() => expectNoFieldMessageBelowControl(container)).not.toThrow();
  });

  it("fails for a FormHelperText rendered after the control", () => {
    const { container } = render(
      <div>
        <label htmlFor="name">이름</label>
        <input id="name" />
        <FormHelperText>이름을 입력해 주세요.</FormHelperText>
      </div>,
    );
    expect(() => expectNoFieldMessageBelowControl(container)).toThrow(/이름을 입력해 주세요/);
  });

  it("fails for plain text after the control without any data-slot", () => {
    const { container } = render(
      <div>
        <label htmlFor="memo">메모</label>
        <textarea id="memo" />
        <p>최대 200자</p>
      </div>,
    );
    expect(() => expectNoFieldMessageBelowControl(container)).toThrow(/최대 200자/);
  });

  it("fails for a slot message rendered after the control", () => {
    const { container } = render(
      <div>
        <label htmlFor="phone">전화번호</label>
        <input id="phone" />
        <FieldMessageText tone="error">전화번호를 확인해 주세요</FieldMessageText>
      </div>,
    );
    expect(() => expectNoFieldMessageBelowControl(container)).toThrow(/전화번호를 확인해 주세요/);
  });

  it("ignores unit suffixes, button text and hidden copy", () => {
    const { container } = render(
      <div>
        <label htmlFor="price">금액</label>
        <div>
          <input id="price" />
          <span data-component="price_suffix">원</span>
        </div>
        <button type="button">확인</button>
        <span aria-hidden="true">숨김</span>
      </div>,
    );
    expect(() => expectNoFieldMessageBelowControl(container)).not.toThrow();
  });
});
