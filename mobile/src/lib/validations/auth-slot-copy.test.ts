import { authErrorSlot, toAuthSlotCopy } from "./auth-slot-copy";

it.each([
  ["이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요.", "이미 등록된 전화번호예요"],
  ["이미 등록된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.", "이미 등록된 이메일입니다"],
  ["이미 등록된 전화번호예요. 오너에게 문의해 주세요.", "등록된 번호예요. 오너에게 문의해 주세요"],
  ["확인할 비밀번호를 다시 입력해 주세요.", "비밀번호를 다시 입력해 주세요"],
  ["처음 문장. 마지막 문장.", "처음 문장. 마지막 문장"],
])("fits the field slot: %s", (message, expected) => {
  expect(toAuthSlotCopy("phone", message)).toBe(expected);
  expect(authErrorSlot("phone", message)).toEqual({ text: expected, tone: "err" });
});
it("uses the password rule regardless of the server sentence", () => {
  expect(toAuthSlotCopy("password", "임의 오류.")).toBe("비밀번호 조건을 확인해 주세요");
});
it("keeps an empty field slot empty", () => {
  expect(authErrorSlot("phone", undefined)).toBeNull();
});
