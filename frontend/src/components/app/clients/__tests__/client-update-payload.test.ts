import type { ClientFormData } from "@/features/clients/types";

import { buildClientUpdatePayload, serializeClientUpdateFields } from "../client-update-payload";

const baseline: ClientFormData = {
  name: "홍길동",
  birthday: "1990-01-01",
  dueDate: "2026-10-20",
  birthDate: "",
  address: "인천시 남동구",
  phone: "01012345678",
  primaryEmployeeId: 7,
  secondaryEmployeeId: null,
  type: "",
  duration: 10,
  fullPrice: "1620000",
  grant: "",
  actualPrice: "",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking",
  applyMessageAutomation: true,
  areaId: null,
};

describe("buildClientUpdatePayload", () => {
  it("sends nothing for an unchanged form", () => {
    expect(buildClientUpdatePayload({ baseline, current: { ...baseline } })).toEqual({});
  });

  it("sends only the edited field for an address-only edit, with no date fields and no end-date guard", () => {
    const payload = buildClientUpdatePayload({
      baseline,
      current: { ...baseline, address: "인천시 연수구" },
    });

    expect(payload).toEqual({ address: "인천시 연수구" });
    expect(payload).not.toHaveProperty("startDate");
    expect(payload).not.toHaveProperty("endDate");
    expect(payload).not.toHaveProperty("duration");
    expect(payload).not.toHaveProperty("expectedEndDate");
  });

  it("sends the whole service period plus the opening end date when the start date changes", () => {
    const payload = buildClientUpdatePayload({
      baseline,
      current: { ...baseline, startDate: "2026-11-03", endDate: "2026-11-16" },
    });

    expect(payload).toEqual({
      startDate: "2026-11-03",
      endDate: "2026-11-16",
      duration: 10,
      expectedEndDate: "2026-11-13",
    });
  });

  it.each([
    ["end date", { endDate: "2026-11-20" }, { startDate: "2026-11-02", endDate: "2026-11-20", duration: 10 }],
    ["duration", { duration: 12 }, { startDate: "2026-11-02", endDate: "2026-11-13", duration: 12 }],
  ])("guards a lone %s edit with the opening end date", (_label, change, expectedPeriod) => {
    const payload = buildClientUpdatePayload({ baseline, current: { ...baseline, ...change } });

    expect(payload).toEqual({ ...expectedPeriod, expectedEndDate: "2026-11-13" });
  });

  it("expects a null end date when the form was opened on a client without one", () => {
    const payload = buildClientUpdatePayload({
      baseline: { ...baseline, startDate: "", endDate: "", duration: null },
      current: { ...baseline, startDate: "2026-11-02", endDate: "2026-11-13", duration: 10 },
    });

    expect(payload.expectedEndDate).toBeNull();
  });

  it("carries the duration confirmation only together with a period change", () => {
    const periodEdit = buildClientUpdatePayload({
      baseline,
      current: { ...baseline, startDate: "2026-11-03", endDate: "2026-11-16" },
      allowBusinessDayMismatch: true,
    });
    expect(periodEdit.allowBusinessDayMismatch).toBe(true);

    const addressEdit = buildClientUpdatePayload({
      baseline,
      current: { ...baseline, address: "인천시 연수구" },
      allowBusinessDayMismatch: true,
    });
    expect(addressEdit).not.toHaveProperty("allowBusinessDayMismatch");
  });

  it("compares normalized values: an empty optional date and a null one are the same value", () => {
    const payload = buildClientUpdatePayload({
      baseline: { ...baseline, birthDate: null },
      current: { ...baseline, birthDate: "" },
    });

    expect(payload).toEqual({});
  });

  it("compares derived pricing, so a non-voucher price edit sends the price pair it implies", () => {
    const payload = buildClientUpdatePayload({
      baseline,
      current: { ...baseline, fullPrice: "1700000" },
    });

    expect(payload).toEqual({ fullPrice: "1700000", actualPrice: "1700000" });
  });

  it("does not send an employee id that is unset", () => {
    const fields = serializeClientUpdateFields({ ...baseline, primaryEmployeeId: null });

    expect(fields).not.toHaveProperty("primaryEmployeeId");
    expect(buildClientUpdatePayload({
      baseline,
      current: { ...baseline, primaryEmployeeId: null },
    })).toEqual({});
  });

  it("sends a changed employee id", () => {
    expect(buildClientUpdatePayload({
      baseline,
      current: { ...baseline, secondaryEmployeeId: 9 },
    })).toEqual({ secondaryEmployeeId: 9 });
  });

  it("removes the secondary employee with an explicit null, and does not resend an unchanged null", () => {
    const withSecondary: ClientFormData = { ...baseline, secondaryEmployeeId: 4 };

    expect(buildClientUpdatePayload({
      baseline: withSecondary,
      current: { ...withSecondary, secondaryEmployeeId: null },
    })).toEqual({ secondaryEmployeeId: null });
    expect(buildClientUpdatePayload({
      baseline,
      current: { ...baseline, secondaryEmployeeId: null },
    })).toEqual({});
    expect(buildClientUpdatePayload({
      baseline: withSecondary,
      current: { ...withSecondary },
    })).toEqual({});
  });
});
