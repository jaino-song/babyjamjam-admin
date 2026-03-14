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
  it("renders the shared pill trigger styles by default", () => {
    const { container } = render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="문서 선택" />
        </SelectTrigger>
      </Select>
    );

    const trigger = container.querySelector('[data-slot="select-trigger"]');

    expect(trigger).toHaveClass("rounded-full");
    expect(trigger).toHaveClass("border-2");
    expect(trigger).toHaveClass("border-v3-border");
    expect(trigger).toHaveClass("btn-press");
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
