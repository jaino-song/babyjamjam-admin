import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";

import { NotificationTestSection } from "./NotificationTestSection";

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn(),
  },
}));

const mockedPost = jest.mocked(api.post);

describe("NotificationTestSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends a broadcast and reports delivery counts", async () => {
    mockedPost.mockResolvedValue({ data: { sent: 3, failed: 1 } });

    render(<NotificationTestSection />);
    fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));

    expect(mockedPost).toHaveBeenCalledWith("/notifications/test-broadcast");
    expect(await screen.findByText("전송 완료: 성공 3건, 실패 1건")).toBeInTheDocument();
  });

  it("shows an actionable error when the broadcast fails", async () => {
    mockedPost.mockRejectedValue(new Error("network error"));

    render(<NotificationTestSection />);
    fireEvent.click(screen.getByRole("button", { name: "테스트 알림 보내기" }));

    await waitFor(() => {
      expect(
        screen.getByText("알림 전송에 실패했습니다. 구독 상태와 서버 설정을 확인해 주세요."),
      ).toBeInTheDocument();
    });
  });
});
