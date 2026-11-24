import { getAuthErrorDialog } from "./auth-errors";

it("returns the exact notice for a pending account match", () => {
  expect(getAuthErrorDialog("LINK_PENDING_APPROVAL")).toEqual({
    title: "승인 대기중 입니다.",
    description: "관계자에게 문의해 주세요.",
  });
});

it("keeps the ordinary pending sign-in notice", () => {
  expect(getAuthErrorDialog("PENDING_APPROVAL")).toEqual({
    title: "관리자 승인 대기 중입니다.",
    description: "관리자의 승인이 완료된 후 로그인할 수 있습니다.",
  });
});
