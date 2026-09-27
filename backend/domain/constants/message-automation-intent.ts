export const MESSAGE_AUTOMATION_INTENT_RULE_ID = "system:message_automation_intent";
export const MESSAGE_AUTOMATION_INTENT_RETRY_REASON = "메시지 자동화 생성 재시도 대기";
export const MESSAGE_AUTOMATION_INTENT_INVALID_REASON =
    "메시지 자동화 복구 표식 손상 - 수동 확인 필요";
export const MESSAGE_AUTOMATION_INTENT_GENERATION_KEY = "recoveryGenerationId";
export const MESSAGE_AUTOMATION_INTENT_NEW_SCHEDULE_KEY = "allowImmediateAssignmentForNewSchedule";
export const EMPLOYEE_ASSIGNMENT_AUTOMATION_CHANGED_CANCEL_REASON = "Employee assignment changed";

export function isMessageAutomationIntentGenerationId(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type MessageAutomationIntentKind = "client" | "schedule" | "employee";

export function getClientAutomationIntentDedupeKey(branchId: string, clientId: number): string {
    return `${MESSAGE_AUTOMATION_INTENT_RULE_ID}:branch:${branchId}:client:${clientId}`;
}

export function getScheduleAutomationIntentDedupeKey(
    branchId: string,
    scheduleId: number,
): string {
    return `${MESSAGE_AUTOMATION_INTENT_RULE_ID}:branch:${branchId}:schedule:${scheduleId}`;
}

export function getEmployeeAutomationIntentDedupeKey(
    branchId: string,
    employeeId: number,
): string {
    return `${MESSAGE_AUTOMATION_INTENT_RULE_ID}:branch:${branchId}:employee:${employeeId}`;
}

export const getEmployeeProfileRefreshAutomationIntentDedupeKey = getEmployeeAutomationIntentDedupeKey;
