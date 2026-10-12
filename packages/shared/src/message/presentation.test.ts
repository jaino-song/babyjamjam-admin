import { formatMessageFailureReason } from "./presentation";

describe("formatMessageFailureReason", () => {
  it.each(["잔액 부족", "인증 오류", "수신 거부", "잘못된 번호"])(
    "preserves the permanent-failure prefix for %s", (reason) => {
      const message = `발송 실패: ${reason}`;
      expect(formatMessageFailureReason(message)).toBe(message);
      expect(formatMessageFailureReason(formatMessageFailureReason(message))).toBe(message);
    },
  );

  it("still removes provider internals and punctuation from legacy reasons", () => {
    expect(formatMessageFailureReason("Aligo SMS API error (403): 등록되지 않은 IP 입니다."))
      .toBe("등록되지 않은 입니다.");
  });

  it("sanitizes the reason rather than allowing arbitrary provider punctuation", () => {
    expect(formatMessageFailureReason("발송 실패: Aligo (403): 잔액 부족!"))
      .toBe("발송 실패: 잔액 부족");
    expect(formatMessageFailureReason(null)).toBe("");
  });
});
