import {
  isFieldValueInvalid,
  pickSlotMessage,
  resolveSlotMessage,
  type FieldSpec,
  type SlotMessage,
} from "../field-message";

const state = (value: string, overrides: Partial<{ hadValue: boolean; touched: boolean; focused: boolean }> = {}) => ({
  value,
  hadValue: false,
  touched: false,
  focused: false,
  ...overrides,
});

const name: FieldSpec = { kind: "text", label: "이름", required: true };
const phone: FieldSpec = { kind: "phone", label: "연락처", required: true };
const mobilePhone: FieldSpec = { ...phone, mobileOnly: true };
const birthday: FieldSpec = { kind: "birthday", label: "생년월일" };
const endDate: FieldSpec = { kind: "date", label: "종료일", dateRange: { notBefore: "2026-12-01" } };

describe("resolveSlotMessage", () => {
  it("shows nothing for an untouched empty field", () => {
    expect(resolveSlotMessage("ko", name, state(""), { submitted: false })).toBeNull();
  });

  it("uses the right object particle in the required message", () => {
    expect(resolveSlotMessage("ko", name, state("", { hadValue: true }), { submitted: false }))
      .toEqual({ text: "이름을 입력해 주세요", tone: "err" });
    expect(resolveSlotMessage("ko", phone, state("", {}), { submitted: true }))
      .toEqual({ text: "연락처를 입력해 주세요", tone: "err" });
  });

  it("turns a phone hint into an error once the field was left", () => {
    expect(resolveSlotMessage("ko", phone, state("0101", { focused: true }), { submitted: false }))
      .toEqual({ text: "010-1234-5678 형식", tone: "muted" });
    expect(resolveSlotMessage("ko", phone, state("0101", { touched: true }), { submitted: false }))
      .toEqual({ text: "010-1234-5678로 입력해 주세요", tone: "err" });
  });

  it("treats a landline as incomplete only when the form needs a mobile number", () => {
    const untouched = state("031-123-4567", { touched: true });
    expect(resolveSlotMessage("ko", phone, untouched, { submitted: false })).toBeNull();
    expect(resolveSlotMessage("ko", mobilePhone, untouched, { submitted: false }))
      .toEqual({ text: "010-1234-5678로 입력해 주세요", tone: "err" });
    expect(resolveSlotMessage("ko", mobilePhone, state("031-123-4567", { focused: true }), { submitted: false }))
      .toEqual({ text: "010-1234-5678 형식", tone: "muted" });
    expect(resolveSlotMessage("ko", mobilePhone, state("010-1234-5678", { touched: true }), { submitted: false }))
      .toBeNull();
  });

  it("rejects a future birthday on top of the shared date rules", () => {
    expect(resolveSlotMessage("ko", birthday, state("1958-03-03"), { submitted: false })).toBeNull();
    expect(resolveSlotMessage("ko", birthday, state("2999-01-01"), { submitted: false }))
      .toEqual({ text: "미래 날짜는 입력할 수 없어요", tone: "err" });
    expect(resolveSlotMessage("ko", birthday, state("1958-02-31"), { submitted: false })?.text)
      .toBe("존재하지 않는 날짜예요");
  });

  it("checks the end date against the start date", () => {
    expect(resolveSlotMessage("ko", endDate, state("2026-11-15"), { submitted: false })?.text)
      .toBe("종료일은 시작일 이후여야 해요");
    expect(resolveSlotMessage("ko", endDate, state("2026-12-19"), { submitted: false })).toBeNull();
  });

  it("renders English copy for the en locale", () => {
    expect(resolveSlotMessage("en", name, state("", { hadValue: true }), { submitted: false })?.text)
      .toBe("Enter 이름");
  });
});

describe("isFieldValueInvalid", () => {
  it("counts an incomplete value as invalid even before the field was left", () => {
    expect(isFieldValueInvalid("ko", phone, "0101")).toBe(true);
    expect(isFieldValueInvalid("ko", phone, "010-1234-5678")).toBe(false);
    expect(isFieldValueInvalid("ko", phone, "031-123-4567")).toBe(false);
    expect(isFieldValueInvalid("ko", mobilePhone, "031-123-4567")).toBe(true);
    expect(isFieldValueInvalid("ko", name, "")).toBe(true);
    expect(isFieldValueInvalid("ko", birthday, "")).toBe(false);
  });
});

describe("pickSlotMessage", () => {
  const ok: SlotMessage = { text: "ok", tone: "ok" };
  const hint: SlotMessage = { text: "hint", tone: "muted" };
  const err: SlotMessage = { text: "err", tone: "err" };

  it("prefers error over hint over informational status", () => {
    expect(pickSlotMessage(ok, hint, err)).toBe(err);
    expect(pickSlotMessage(ok, hint)).toBe(hint);
    expect(pickSlotMessage(null, ok)).toBe(ok);
    expect(pickSlotMessage(null, undefined)).toBeNull();
  });
});
