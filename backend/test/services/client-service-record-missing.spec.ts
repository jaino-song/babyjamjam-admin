import { ClientService } from "application/services/client.service";
import type { ServiceRecordAlertCandidate } from "domain/repositories/client.repository.interface";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { MISSING_RECORD_BRANCH_ID, missingRecordCandidate } from "../fixtures/missing-service-record-alert.fixture";

function createService(candidates: ServiceRecordAlertCandidate[] = []) {
    const repository = { findServiceRecordAlertCandidates: jest.fn().mockResolvedValue(candidates) };
    const holidayCalendar = { forBranch: jest.fn().mockResolvedValue(KR_BUILTIN_CALENDAR) };
    const service = new ClientService(
        {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
        {} as never, repository as never, {} as never, {} as never, {} as never, holidayCalendar as never,
    );
    return { service, repository, holidayCalendar };
}

describe("ClientService.getServiceRecordMissing", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-09-10T18:00:00+09:00"));
    });

    afterEach(() => jest.useRealTimers());

    it("derives count from eligible clients, sorts by progress/name/id and omits scheduleId", async () => {
        const excluded = missingRecordCandidate(99);
        excluded.source.client.branchId = "other-branch";
        const { service, repository, holidayCalendar } = createService([
            missingRecordCandidate(5, "가산모", 2),
            missingRecordCandidate(4, "가산모", 3),
            missingRecordCandidate(3, "가산모", 3),
            excluded,
            missingRecordCandidate(2, "나산모", 3),
            missingRecordCandidate(1, "하산모", 4),
        ]);
        const result = await service.getServiceRecordMissing(MISSING_RECORD_BRANCH_ID);
        expect(result.count).toBe(result.items.length);
        expect(result).toEqual({ count: 5, items: [
            { clientId: 1, clientName: "하산모", primaryEmployeeName: "이관리", unwrittenThroughSessionIndex: 4 },
            { clientId: 3, clientName: "가산모", primaryEmployeeName: "이관리", unwrittenThroughSessionIndex: 3 },
            { clientId: 4, clientName: "가산모", primaryEmployeeName: "이관리", unwrittenThroughSessionIndex: 3 },
            { clientId: 2, clientName: "나산모", primaryEmployeeName: "이관리", unwrittenThroughSessionIndex: 3 },
            { clientId: 5, clientName: "가산모", primaryEmployeeName: "이관리", unwrittenThroughSessionIndex: 2 },
        ] });
        expect(repository.findServiceRecordAlertCandidates).toHaveBeenCalledTimes(1);
        expect(repository.findServiceRecordAlertCandidates).toHaveBeenCalledWith(MISSING_RECORD_BRANCH_ID);
        expect(holidayCalendar.forBranch).toHaveBeenCalledTimes(1);
        expect(holidayCalendar.forBranch).toHaveBeenCalledWith(MISSING_RECORD_BRANCH_ID);
    });

    it("does not query for an empty branch id", async () => {
        const { service, repository, holidayCalendar } = createService([missingRecordCandidate()]);
        expect(await service.getServiceRecordMissing("")).toEqual({ count: 0, items: [] });
        expect(repository.findServiceRecordAlertCandidates).not.toHaveBeenCalled();
        expect(holidayCalendar.forBranch).not.toHaveBeenCalled();
    });

    it("returns zero for a branch without candidates", async () => {
        const { service } = createService();
        expect(await service.getServiceRecordMissing(MISSING_RECORD_BRANCH_ID)).toEqual({ count: 0, items: [] });
    });

    it("evaluates eligibility using the current time", async () => {
        const { service } = createService([missingRecordCandidate()]);
        jest.setSystemTime(new Date("2026-09-08T17:59:00+09:00"));
        expect(await service.getServiceRecordMissing(MISSING_RECORD_BRANCH_ID)).toEqual({ count: 0, items: [] });
        jest.setSystemTime(new Date("2026-09-08T18:00:00+09:00"));
        expect((await service.getServiceRecordMissing(MISSING_RECORD_BRANCH_ID)).items[0]?.unwrittenThroughSessionIndex).toBe(2);
    });
});
