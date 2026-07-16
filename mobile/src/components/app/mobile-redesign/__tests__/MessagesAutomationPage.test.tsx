import { render, screen } from "@testing-library/react";

import {
  MESSAGE_NAVIGATION_ITEMS,
  MessagesAutomationPage,
} from "../MessagesAutomationPage";

describe("MessagesAutomationPage", () => {
  it("exposes every frontend message section as a mobile navigation destination", () => {
    render(<MessagesAutomationPage />);

    expect(screen.getByRole("navigation", { name: "메시지 기능" })).toBeInTheDocument();
    expect(MESSAGE_NAVIGATION_ITEMS.map((item) => item.title)).toEqual([
      "전송하기",
      "발송 예정",
      "발송 기록",
      "템플릿",
      "자동 전송",
      "설정",
    ]);

    for (const item of MESSAGE_NAVIGATION_ITEMS) {
      expect(screen.getByRole("link", { name: new RegExp(item.title) }))
        .toHaveAttribute("href", item.href);
    }
  });
});
