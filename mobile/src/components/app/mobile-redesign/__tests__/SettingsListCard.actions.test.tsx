import { fireEvent, render, screen } from "@testing-library/react";

import { SettingsListCard } from "../settings/SettingsListCard";

it("uses the shared 40px pill header action and keeps its handler and name", () => {
  const onAction = jest.fn();
  render(<SettingsListCard data-component="mobile_messages_automation_list" title="자동 전송" count={0} subtitle="규칙" actionLabel="+ 규칙" onAction={onAction}>내용</SettingsListCard>);
  const action = screen.getByRole("button", { name: "+ 규칙" });
  expect(action).toHaveAttribute("data-slot", "button");
  expect(action).toHaveAttribute("data-size", "default");
  expect(action).toHaveClass("h-10", "rounded-full");
  expect(action).toHaveAttribute("data-component", "mobile_messages_automation_list_header_action");
  fireEvent.click(action);
  expect(onAction).toHaveBeenCalledTimes(1);
});
