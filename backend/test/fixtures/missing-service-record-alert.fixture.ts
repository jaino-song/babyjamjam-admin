import type { ServiceRecordAlertCandidate } from "domain/repositories/client.repository.interface";

export const MISSING_RECORD_BRANCH_ID = "branch-1";

export function missingRecordCandidate(
    clientId = 10,
    clientName = "김산모",
    sessionCount = 4,
): ServiceRecordAlertCandidate {
    return {
        source: {
            caseId: `case-${clientId}`, caseVersion: 7, requiredSessionCount: sessionCount,
            startDate: "2026-09-07", endDate: "2026-09-10", plannedSessions: null,
            client: {
                id: clientId, branchId: MISSING_RECORD_BRANCH_ID, name: clientName, duration: sessionCount,
                startDate: "2026-09-07", endDate: "2026-09-10", serviceStatus: "completed",
            },
            assignments: [{
                id: "assignment-1", branchId: MISSING_RECORD_BRANCH_ID, serviceRecordCaseId: `case-${clientId}`,
                scheduleId: 55, employeeId: 9, startDate: "2026-09-07", endDate: "2026-09-10",
                replaced: false, employeeName: "이관리", scheduleStartDate: "2026-09-07",
                scheduleEndDate: "2026-09-10", scheduleTerminatedAt: null,
                primaryEmployeeId: 9, secondaryEmployeeId: null, primaryEmployeeName: "이관리",
            }],
            sessions: [],
        },
        assignmentSessions: [],
    };
}
