import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const listSchedulesSchema: FunctionDeclaration = {
    name: "listSchedules",
    description: `List all employee schedules.

USE THIS TOOL when user asks:
- "스케줄 목록", "배정 현황", "근무 일정", "전체 스케줄"

Returns: List of all schedules with client and employee info`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const getSchedulesByEmployeeSchema: FunctionDeclaration = {
    name: "getSchedulesByEmployee",
    description: `Get schedules for a specific employee.

USE THIS TOOL when user asks:
- "김이모님 스케줄", "관리사 3번 일정", "제공인력 근무 현황"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            employeeId: {
                type: "number",
                description: "The unique ID of the employee (관리사/이모님 ID)",
            },
        },
        required: ["employeeId"],
    },
};

export const scheduleTools: FunctionDeclaration[] = [
    listSchedulesSchema,
    getSchedulesByEmployeeSchema,
];
