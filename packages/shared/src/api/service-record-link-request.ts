type Action = "prepare" | "send" | "reset";

const PHONE = /^01[016789]-?\d{3,4}-?\d{4}$/;
const TOKEN = /^efl_[A-Za-z0-9_-]{40,64}$/;
const CASE_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const validCaseId = (value: unknown): value is string => typeof value === "string" && CASE_ID.test(value);
const validToken = (value: unknown): value is string => typeof value === "string" && TOKEN.test(value);
const positiveInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function allowServiceRecordLinkRequest(
    action: Action,
    input: Record<string, unknown>,
): { body: Record<string, unknown> } | { pointer: string } {
    const { employeeId, caseIds, members, caseId, recipientPhone, preparedLinkToken } = input;
    if (recipientPhone !== undefined && (
        action === "reset" || typeof recipientPhone !== "string" || !PHONE.test(recipientPhone)
    )) return { pointer: "/recipientPhone" };
    const phone = recipientPhone === undefined ? {} : { recipientPhone };
    if (employeeId === undefined && caseIds === undefined && members === undefined) {
        if (caseId !== undefined && !validCaseId(caseId)) return { pointer: "/caseId" };
        if (preparedLinkToken !== undefined && (action !== "send" || !validToken(preparedLinkToken))) {
            return { pointer: "/preparedLinkToken" };
        }
        return { body: {
            ...phone,
            ...(caseId === undefined ? {} : { caseId }),
            ...(preparedLinkToken === undefined ? {} : { preparedLinkToken }),
        } };
    }
    if (!positiveInteger(employeeId)) return { pointer: "/employeeId" };
    if (caseId !== undefined) return { pointer: "/caseId" };
    if (preparedLinkToken !== undefined) return { pointer: "/preparedLinkToken" };

    if (action === "prepare") {
        if (members !== undefined) return { pointer: "/members" };
        if (!Array.isArray(caseIds) || !caseIds.length || !caseIds.every(validCaseId)
            || new Set(caseIds.map((id) => id.toLowerCase())).size !== caseIds.length) {
            return { pointer: "/caseIds" };
        }
        return { body: { ...phone, employeeId, caseIds } };
    }

    if (caseIds !== undefined) return { pointer: "/caseIds" };
    if (!Array.isArray(members) || !members.length) return { pointer: "/members" };
    const seenCases = new Set<string>();
    const allowedMembers = [];
    for (const [index, member] of members.entries()) {
        if (!member || typeof member !== "object" || Array.isArray(member)) return { pointer: `/members/${index}` };
        const { caseId, assignmentVersion, preparedLinkToken } = member as Record<string, unknown>;
        if (!validCaseId(caseId) || seenCases.has(caseId.toLowerCase())) return { pointer: `/members/${index}/caseId` };
        if (!positiveInteger(assignmentVersion)) return { pointer: `/members/${index}/assignmentVersion` };
        if (action === "send" && !validToken(preparedLinkToken)) return { pointer: `/members/${index}/preparedLinkToken` };
        seenCases.add(caseId.toLowerCase());
        allowedMembers.push({ caseId, assignmentVersion, ...(action === "send" ? { preparedLinkToken } : {}) });
    }
    return { body: { ...phone, employeeId, members: allowedMembers } };
}
