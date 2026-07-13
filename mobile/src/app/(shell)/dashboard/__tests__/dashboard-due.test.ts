import {
  dueForContractRequired,
  dueForServiceEndDate,
  dueForServiceStartDate,
  dueForServiceStatus,
} from "../dashboard-due";

const TODAY = new Date(2026, 6, 7, 12, 0, 0);

describe("dashboard due labels", () => {
  it("describes contract-required timing by service start", () => {
    expect(dueForContractRequired({ startDate: "2026-07-08" }, TODAY)).toMatchObject({
      due: "서비스 시작 1 영업일 남음",
      dueTone: "urgent",
    });

    expect(dueForContractRequired({ startDate: "2026-07-06" }, TODAY)).toMatchObject({
      due: "서비스 시작 1 영업일 경과",
      dueTone: "urgent",
    });
  });

  it("describes waiting timing by service start", () => {
    expect(dueForServiceStartDate("2026-07-14", TODAY)).toMatchObject({
      due: "서비스 시작 5 영업일 남음",
      dueTone: "soon",
    });
  });

  it("describes active timing by service end business days", () => {
    expect(dueForServiceEndDate("2026-07-16", TODAY)).toMatchObject({
      due: "서비스 종료 7 영업일 남음",
      dueTone: "soon",
    });
  });

  it("covers the remaining service status keys", () => {
    expect(dueForServiceStatus({
      serviceStatus: "completed",
      startDate: "2026-06-01",
      endDate: "2026-07-06",
      updatedAt: "2026-07-06",
      createdAt: "2026-06-01",
    }, TODAY)).toBeNull();

    expect(dueForServiceStatus({
      serviceStatus: "terminated",
      startDate: "2026-06-01",
      endDate: "2026-07-20",
      updatedAt: "2026-07-05",
      createdAt: "2026-06-01",
    }, TODAY)).toBeNull();

    expect(dueForServiceStatus({
      serviceStatus: "replacement_requested",
      startDate: "2026-06-01",
      endDate: "2026-07-20",
      updatedAt: "2026-07-05",
      createdAt: "2026-06-01",
    }, TODAY)).toMatchObject({ due: "교체 요청 2 영업일 경과" });
  });
});
