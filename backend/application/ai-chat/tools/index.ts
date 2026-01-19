import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";
import { clientTools } from "./client.tools";
import { employeeTools } from "./employee.tools";
import { contractTools } from "./contract.tools";
import { messageTools } from "./message.tools";
import { dashboardTools } from "./dashboard.tools";
import { scheduleTools } from "./schedule.tools";
import { voucherTools } from "./voucher.tools";
import { bankAccountTools } from "./bankAccount.tools";

export * from "./client.tools";
export * from "./employee.tools";
export * from "./contract.tools";
export * from "./message.tools";
export * from "./dashboard.tools";
export * from "./schedule.tools";
export * from "./voucher.tools";
export * from "./bankAccount.tools";

export const allTools: FunctionDeclaration[] = [
    ...clientTools,
    ...employeeTools,
    ...contractTools,
    ...messageTools,
    ...dashboardTools,
    ...scheduleTools,
    ...voucherTools,
    ...bankAccountTools,
];

export const CUD_TOOLS = [
    "createClient",
    "updateClient",
    "deleteClient",
    "terminateClientService",
    "requestEmployeeReplacement",
    "createEmployee",
    "updateEmployee",
    "deleteEmployee",
    "changeEmployeeAvailability",
    "createMessage",
    "updateMessage",
    "deleteMessage",
    "createAndSendContract",
] as const;

export type CUDToolName = typeof CUD_TOOLS[number];

export function isCUDTool(toolName: string): toolName is CUDToolName {
    return CUD_TOOLS.includes(toolName as CUDToolName);
}
