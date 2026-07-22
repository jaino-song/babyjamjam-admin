import * as React from "react";
import { render } from "@testing-library/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

describe("Select Component", () => {
  it("renders the shared compact input trigger styles by default", () => {
    const { container } = render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="문서 선택" />
        </SelectTrigger>
      </Select>
    );

    const trigger = container.querySelector('[data-slot="select-trigger"]');

    expect(trigger).toHaveClass("h-[calc(38px*var(--glint-ui-scale,1))]");
    expect(trigger).toHaveClass("rounded-[13px]");
    expect(trigger).toHaveClass("border-[1.35px]");
    expect(trigger).toHaveClass("border-input");
    expect(trigger).toHaveClass("text-[calc(12px*var(--glint-ui-scale,1))]");
    expect(trigger).toHaveClass("focus-visible:ring-[3px]");
  });

  it("renders the shared dropdown surface styles", () => {
    render(
      <Select open>
        <SelectTrigger>
          <SelectValue placeholder="문서 선택" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="contract">근로계약서</SelectItem>
        </SelectContent>
      </Select>
    );

    const content = document.body.querySelector('[data-slot="select-content"]');
    const item = document.body.querySelector('[data-slot="select-item"]');

    expect(content).toHaveClass("rounded-[22px]");
    expect(content).toHaveClass("border-v3-border");
    expect(item).toHaveClass("rounded-[16px]");
    expect(item).toHaveClass("text-v3-dark");
  });
});
