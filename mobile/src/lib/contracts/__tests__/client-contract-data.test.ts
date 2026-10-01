import {
  buildClientContractData,
  resolveContractAreaTemplateId,
} from "@/lib/contracts/client-contract-data";
import { createKrBusinessDayCalendar, getKoreanHolidays, KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import type { Client } from "@/lib/client/types";
import type { Employee } from "@/hooks/useEmployees";
import type { AreaTemplate } from "@/hooks/useVoucherData";

const baseClient: Client = {
  id: 44,
  name: "김정인",
  birthday: "960101",
  dueDate: "2026-05-30T00:00:00.000Z",
  birthDate: null,
  address: "인천광역시 남동구 구월동",
  phone: "010-1234-5678",
  primaryEmployee: { id: 7, name: "이관리" },
  secondaryEmployee: null,
  type: "A통합3형",
  duration: 15,
  fullPrice: "1,234,000",
  grant: "900,000",
  actualPrice: "334,000",
  startDate: "2026-06-03T00:00:00.000Z",
  endDate: "2026-06-23T00:00:00.000Z",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
  serviceStatus: "active",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

const employees: Employee[] = [
  {
    id: 7,
    name: "이관리",
    phone: "010-9999-8888",
    workArea: ["남동구"],
    grade: "베스트",
    openToNextWork: true,
    registeredDate: "2026-01-01",
    status: "working",
  },
];

const areaTemplates: AreaTemplate[] = [
  { id: "at_001", areaId: "area_dong", templateId: "tmpl_001", templateName: "동구 서비스 계약서" },
  { id: "at_002", areaId: "area_namdong", templateId: "tmpl_002", templateName: "남동구 서비스 계약서" },
  { id: "at_003", areaId: "area_jung", templateId: "tmpl_003", templateName: "중구 서비스 계약서" },
];

// A branch calendar for 2026: the public list plus the branch's own extra days.
const branchCalendar2026 = (...extraDates: string[]) =>
  createKrBusinessDayCalendar([...getKoreanHolidays(2026), ...extraDates], {
    version: "kr-db-test",
    supportedYears: [2026],
  });

describe("buildClientContractData", () => {
  it("builds eformsign contract data from an existing client", () => {
    const result = buildClientContractData({
      client: baseClient,
      employees,
      areaTemplates,
      calendar: KR_BUILTIN_CALENDAR,
    });

    expect(result.areaId).toBe("area_namdong");
    expect(result.contractData).toMatchObject({
      customerName: "김정인",
      customerContact: "010-1234-5678",
      caretaker1Name: "이관리",
      caretaker1Contact: "010-9999-8888",
      type: "A통합3형",
      days: "15",
      area: "area_namdong",
      startDate: "2026-06-03",
      endDate: "2026-06-23",
      paymentYear: "26",
      paymentMonth: "06",
      paymentDay: "03",
    });
  });
});

describe("buildClientContractData end date", () => {
  const clientWithoutEnd: Client = { ...baseClient, endDate: null };
  const build = (calendar: ReturnType<typeof branchCalendar2026>) =>
    buildClientContractData({ client: clientWithoutEnd, employees, areaTemplates, calendar }).contractData.endDate;

  it("computes the missing end date on the calendar it is given", () => {
    const publicEnd = build(KR_BUILTIN_CALENDAR);
    // A branch-only holiday on the last counted day pushes the end date out.
    expect(KR_BUILTIN_CALENDAR.isBusinessDay(publicEnd)).toBe(true);
    const branchEnd = build(branchCalendar2026(publicEnd));
    expect(branchEnd).toBe(KR_BUILTIN_CALENDAR.nextBusinessDay(publicEnd));
  });

  it("keeps a stored end date regardless of the calendar", () => {
    const stored = buildClientContractData({
      client: baseClient,
      employees,
      areaTemplates,
      calendar: branchCalendar2026("2026-06-10"),
    });
    expect(stored.contractData.endDate).toBe("2026-06-23");
  });
});

describe("resolveContractAreaTemplateId", () => {
  it("blocks automatic issuance when multiple templates cannot be matched", () => {
    expect(() =>
      resolveContractAreaTemplateId(
        {
          ...baseClient,
          address: "인천광역시 주소 미확인",
        },
        areaTemplates,
      ),
    ).toThrow("계약서 유형을 주소에서 판단할 수 없어요.");
  });
});
