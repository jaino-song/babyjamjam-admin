import type {
    AdminServiceRecordCaseSummary,
    PrepareServiceRecordLinkResponse,
    ResetServiceRecordLinkRequest,
    ServiceRecordLinkTarget,
    ResetServiceRecordLinkResponse,
    ServiceRecordAssignment,
    ServiceRecordOverview,
} from "../types/service-record";

export function legacyServiceRecordLinkAssignment(
    overview: ServiceRecordOverview,
): ServiceRecordAssignment | undefined {
    const { cases = [], legacyLinkAssignment, assignments } = overview;
    if (cases.length > 1 || cases.some(({ babyId, retired }) => babyId !== null || retired)) return;
    if (legacyLinkAssignment === null) return;

    // Older overviews supported a scalar link for an unambiguous schedule.
    const eligible = assignments.filter(({ replaced, scheduleId, employee }) => !replaced
        && (legacyLinkAssignment === undefined
            || (legacyLinkAssignment.scheduleId === scheduleId && legacyLinkAssignment.employeeId === employee.id)));
    return eligible.length === 1 ? eligible[0] : undefined;
}

export function caseServiceRecordLinkAssignment(record: AdminServiceRecordCaseSummary) {
    const assignments = record.linkAssignments;
    if (record.retired || record.babyId === null || !Array.isArray(assignments) || assignments.length !== 1) return;
    const [target] = assignments;
    if (!target || ![target.scheduleId, target.employeeId, target.assignmentVersion]
        .every((value) => Number.isSafeInteger(value) && value > 0)) return;
    return target;
}

export function serviceRecordResetTarget(
    overview: ServiceRecordOverview,
    caseId?: string,
): { scheduleId: number; request: ResetServiceRecordLinkRequest } | undefined {
    const selectedCaseId = caseId ?? overview.record?.id;
    const record = overview.cases?.find((item) => item.caseId === selectedCaseId);
    if (record?.babyId) {
        const target = caseServiceRecordLinkAssignment(record);
        if (!target) return;
        return {
            scheduleId: target.scheduleId,
            request: {
                employeeId: target.employeeId,
                members: [{ caseId: record.caseId, assignmentVersion: target.assignmentVersion }],
            } satisfies ResetServiceRecordLinkRequest,
        };
    }
    if (caseId && !record) return;
    const legacy = legacyServiceRecordLinkAssignment(overview);
    if (legacy) return { scheduleId: legacy.scheduleId, request: {} };
}

export function serviceRecordResetUrl(response: ResetServiceRecordLinkResponse, request: ResetServiceRecordLinkRequest) {
    if ("members" in request) {
        const [expected] = request.members;
        if (!expected || request.members.length !== 1 || response.kind !== "group"
            || response.employeeId !== request.employeeId || !Array.isArray(response.members) || response.members.length !== 1) return;
        const [member] = response.members;
        if (member.caseId === expected.caseId && member.assignmentVersion === expected.assignmentVersion) {
            return member.serviceRecordUrl;
        }
    } else if (response.kind !== "group") {
        return response.serviceRecordUrl;
    }
}


export function preparedServiceRecordMembers(
    response: PrepareServiceRecordLinkResponse,
    employeeId: number,
    targets: readonly ServiceRecordLinkTarget[],
) {
    if (!targets.length || response.kind !== "group" || response.employeeId !== employeeId || !response.previewContent?.trim()
        || !Array.isArray(response.members) || response.members.length !== targets.length) return;
    const caseIds = new Set(response.members.map(({ caseId }) => caseId));
    const urls = new Set(response.members.map(({ serviceRecordUrl }) => serviceRecordUrl));
    const tokens = new Set(response.members.map(({ preparedLinkToken }) => preparedLinkToken));
    if ([caseIds, urls, tokens].some((values) => values.size !== targets.length)) return;
    if (!response.members.every((member) => Boolean(member.preparedLinkToken && member.serviceRecordUrl)
        && response.previewContent.includes(member.serviceRecordUrl)
        && targets.some(({ caseId, assignmentVersion }) =>
            member.caseId === caseId && member.assignmentVersion === assignmentVersion))) return;
    return response.members.map(({ caseId, assignmentVersion, preparedLinkToken }) => ({
        caseId, assignmentVersion, preparedLinkToken,
    }));
}
