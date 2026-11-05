import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";

const branchId = "branch-1";
const date = (value: string) => new Date(value);
const client = { id: 10, branchId, name: "김산모", duration: 3,
    startDate: date("2026-09-07"), endDate: date("2026-09-09"), serviceStatus: "completed",
    allowSaturdayService: false, allowSundayService: false, allowHolidayService: false };
const record = { id: "case-1", clientId: 10, branchId, version: 4, requiredSessionCount: 3,
    startDate: date("2026-09-07"), endDate: date("2026-09-09"), plannedSessions: null };
const schedule = { id: 55, branchId, clientId: 10, startDate: date("2026-09-07"), endDate: date("2026-09-09"),
    replaced: false, terminatedAt: null, primaryEmployeeId: 9, secondaryEmployeeId: null,
    primaryEmployee: { name: "이관리" },
    serviceRecordAssignment: { id: "assignment-1", branchId, serviceRecordCaseId: "case-1",
        scheduleId: 55, employeeId: 9, employeeNameSnapshot: "이관리",
        startDate: date("2026-09-07"), endDate: date("2026-09-09") } };

describe("branch-scoped service record alert sources", () => {
    const db = { client: { findMany: jest.fn() }, employee_schedule: { findMany: jest.fn() },
        service_record_case: { findMany: jest.fn() }, service_record_day: { findMany: jest.fn() } };
    const repository = new SbClientRepository(db as unknown as PrismaService);
    beforeEach(() => {
        jest.resetAllMocks();
        db.client.findMany.mockResolvedValue([client]);
        db.employee_schedule.findMany.mockResolvedValue([schedule]);
        db.service_record_case.findMany.mockResolvedValue([record]);
        db.service_record_day.findMany.mockResolvedValue([]);
    });

    it("loads lean source fields in branch-scoped batches without tokens, signatures or answers", async () => {
        const result = await repository.findServiceRecordAlertCandidates(branchId);
        expect(result).toHaveLength(1);
        expect(result[0]!.source.caseVersion).toBe(4);
        expect(result[0]!.source.assignments[0]!.id).toBe("assignment-1");
        expect(db.client.findMany.mock.calls[0]![0]).toMatchObject({ where: { branchId, deletedAt: null }, take: 100 });
        expect(db.client.findMany.mock.calls[0]![0].where.employeeSchedules.none.OR).toEqual([
            { branchId: null }, { branchId: { not: branchId } },
            { primaryEmployee: { OR: [{ branchId: null }, { branchId: { not: branchId } }] } },
        ]);
        expect(db.service_record_case.findMany.mock.calls[0]![0].where).toMatchObject({
            branchId, client: { branchId, deletedAt: null },
        });
        expect(db.employee_schedule.findMany.mock.calls[0]![0]).toMatchObject({
            where: { branchId, clientId: { in: [10] }, client: { branchId, deletedAt: null }, primaryEmployee: { branchId } },
        });
        for (const table of [db.employee_schedule, db.service_record_case, db.service_record_day]) {
            const query = table.findMany.mock.calls[0]![0];
            expect(query.where.branchId).toBe(branchId);
            expect(query.take).toBeLessThanOrEqual(500);
            expect(JSON.stringify(query.select)).not.toMatch(/answers|Signature|tokens|notes/);
        }
    });

    it("excludes absent cases and foreign assignment provenance", async () => {
        db.service_record_case.findMany.mockResolvedValue([]);
        expect(await repository.findServiceRecordAlertCandidates(branchId)).toEqual([]);
        db.service_record_case.findMany.mockResolvedValue([record]);
        db.employee_schedule.findMany.mockResolvedValue([{ ...schedule,
            serviceRecordAssignment: { ...schedule.serviceRecordAssignment, branchId: "other" } }]);
        expect(await repository.findServiceRecordAlertCandidates(branchId)).toEqual([]);
    });

    it("retains canonical index normalization and ambiguity separately from local record indexes", async () => {
        const day = { id: "day-1", branchId, serviceRecordCaseId: "case-1", scheduleId: 55,
            sessionIndex: 1, caseSessionIndex: 3, serviceDate: date("2026-09-09"), employeeId: 9 };
        db.service_record_day.findMany.mockResolvedValue([day, { ...day, id: "day-2", sessionIndex: 2 }]);
        const [result] = await repository.findServiceRecordAlertCandidates(branchId);
        expect(result!.source.sessions).toEqual([
            { sessionIndex: 3, serviceDate: "2026-09-09", scheduleId: 55, employeeId: 9, ambiguous: true },
            { sessionIndex: 3, serviceDate: "2026-09-09", scheduleId: 55, employeeId: 9, ambiguous: true },
        ]);
        expect(result!.assignmentSessions.map((row) => row.sessionIndex)).toEqual([1, 2]);
    });

    it("preserves persisted planned-vector JSON without interpreting or replacing its provenance", async () => {
        const plannedSessions = { entries: [{ sessionIndex: 1, serviceDate: "2026-09-07",
            originalDate: "2026-09-07", assignmentId: "assignment-1", scheduleId: 55,
            employeeId: 9, provenance: { version: 4 } }], metadata: null };
        db.service_record_case.findMany.mockResolvedValue([{ ...record, plannedSessions }]);
        const [result] = await repository.findServiceRecordAlertCandidates(branchId);
        expect(result!.source.plannedSessions).toEqual(plannedSessions);
    });

    it("retains written rows across bounded relation pages", async () => {
        const day = { serviceRecordCaseId: "case-1", scheduleId: 55, sessionIndex: 1,
            caseSessionIndex: null, serviceDate: date("2026-09-07"), employeeId: 9 };
        db.service_record_day.findMany
            .mockResolvedValueOnce(Array.from({ length: 500 }, (_, index) => ({
                ...day, id: `day-${String(index).padStart(4, "0")}`,
            })))
            .mockResolvedValueOnce([{ ...day, id: "day-0500", sessionIndex: 2 }]);
        const [result] = await repository.findServiceRecordAlertCandidates(branchId);
        expect(result!.assignmentSessions).toHaveLength(501);
        expect(result!.assignmentSessions[500]!.sessionIndex).toBe(2);
        expect(db.service_record_day.findMany.mock.calls[1]![0]).toMatchObject({
            where: { branchId, id: { gt: "day-0499" } }, take: 500,
        });
    });

    it("does not fetch relation data when all clients are absent (including deleted/foreign clients)", async () => {
        db.client.findMany.mockResolvedValue([]);
        expect(await repository.findServiceRecordAlertCandidates(branchId)).toEqual([]);
        expect(db.employee_schedule.findMany).not.toHaveBeenCalled();
    });

    it("advances bounded client pages and propagates query failure rather than reporting observed alerts", async () => {
        db.client.findMany.mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => ({ ...client, id: index + 1 })))
            .mockResolvedValueOnce([]);
        await repository.findServiceRecordAlertCandidates(branchId);
        expect(db.client.findMany.mock.calls[1]![0]).toMatchObject({ where: { branchId, deletedAt: null, id: { gt: 100 } }, take: 100 });
        db.client.findMany.mockRejectedValueOnce(new Error("db unavailable"));
        await expect(repository.findServiceRecordAlertCandidates(branchId)).rejects.toThrow("db unavailable");
    });
});
