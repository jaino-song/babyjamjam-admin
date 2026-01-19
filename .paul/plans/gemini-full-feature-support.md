# Gemini AI Chat - Full Feature Support Implementation Plan

## Context

### Original Request
User wants Gemini AI chat to support ALL backend features that are available for human manual operation. Currently, Gemini only supports 18 tools, but the backend has 79 use cases across 11 domains.

### Current State
**Currently Implemented (18 tools):**
- Client: searchClients, getClient, createClient, updateClient, deleteClient
- Employee: searchEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee
- Dashboard: getDashboardStats
- Messages: getMessages (broken), createMessage, updateMessage, deleteMessage
- Contracts: listAvailableTemplates, createAndSendContract, getContractStatus

### Gap Analysis
The following features are available in the backend but NOT exposed to Gemini:

| Domain | Missing Features | User Phrases |
|--------|------------------|--------------|
| Client Filters | no-contract, starting-soon, ending-soon, incomplete-contracts | "계약서 미발송 산모", "곧 시작하는 산모" |
| Client Actions | terminateService, requestReplacement | "서비스 종료", "관리사 교체" |
| Employee Filters | byWorkArea, byGrade, availableOnly | "강남구 관리사", "1급 관리사", "배정 가능한 이모님" |
| Employee Actions | changeAvailability | "관리사 배정 가능으로 변경" |
| Contracts | listAll | "모든 계약서 목록" |
| Schedules | list, byEmployee | "스케줄 목록", "김이모님 스케줄" |
| Voucher Prices | list, byType | "바우처 가격표", "A형 가격" |
| Bank Accounts | list, byArea | "계좌 정보", "인천 계좌" |

---

## Work Objectives

### Core Objective
Expose ALL backend service methods to Gemini AI chat so users can perform any operation via natural language.

### Concrete Deliverables
1. New tool schemas in `backend/application/ai-chat/tools/`
2. New handlers in `tool-executor.service.ts`
3. Service injections for VoucherPriceInfoService, BankAccountInfoService, EmployeeScheduleService
4. Updated system prompt with new capabilities

### Definition of Done
- [ ] All 40+ new tools defined and implemented
- [ ] Backend builds without errors
- [ ] User can ask "계약서 미발송 산모 보여줘" and get results

---

## TODOs

### 1. Update client.tools.ts - Add Filter & Action Tools

**What to do:**
Add these new tool schemas after `deleteClientSchema`:

```typescript
export const getClientsByFilterSchema: FunctionDeclaration = {
    name: "getClientsByFilter",
    description: `Get clients by predefined filter categories.

USE THIS TOOL when user asks about:
- 계약서 미발송 산모: "계약서 안 보낸 산모", "계약서 미발송", "eformsign 안 보낸 사람"
- 곧 시작하는 산모: "곧 시작하는 산모", "시작 예정", "입소 예정"
- 곧 종료되는 산모: "곧 종료되는 산모", "종료 예정", "퇴소 예정"
- 계약 미완료 산모: "계약 미완료", "서명 안 한 산모", "계약서 미서명"

SYNONYMS: 산모 = 이용자 = 고객 = 엄마 = client

Returns: List of clients matching the filter with their details`,
    parameters: {
        type: "object",
        properties: {
            filter: {
                type: "string",
                enum: ["no-contract", "starting-soon", "ending-soon", "incomplete-contracts"],
                description: `Filter type:
- no-contract: 계약서 미발송 산모 (contract not sent)
- starting-soon: 곧 시작하는 산모 (starting within 7 days)
- ending-soon: 곧 종료되는 산모 (ending within 7 days)
- incomplete-contracts: 계약 미완료 산모 (contract sent but not signed)`,
            },
        },
        required: ["filter"],
    },
};

export const terminateClientServiceSchema: FunctionDeclaration = {
    name: "terminateClientService",
    description: `Terminate a client's service. Requires confirmation.

USE THIS TOOL when user asks:
- "산모 서비스 종료해줘", "이용자 퇴소 처리", "서비스 중단"

SYNONYMS: 산모 = 이용자 = 고객 = 엄마 = client`,
    parameters: {
        type: "object",
        properties: {
            clientId: {
                type: "number",
                description: "The unique ID of the client (산모/이용자 ID)",
            },
            reason: {
                type: "string",
                description: "Reason for termination (종료 사유)",
            },
            confirmed: {
                type: "boolean",
                description: "Set to true to confirm. Set to false to request confirmation first.",
            },
        },
        required: ["clientId", "confirmed"],
    },
};

export const requestEmployeeReplacementSchema: FunctionDeclaration = {
    name: "requestEmployeeReplacement",
    description: `Request employee replacement for a client. Requires confirmation.

USE THIS TOOL when user asks:
- "관리사 교체해줘", "이모님 바꿔줘", "제공인력 교체 요청"

SYNONYMS: 
- 산모 = 이용자 = 고객 = 엄마 = client
- 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            clientId: {
                type: "number",
                description: "The unique ID of the client (산모/이용자 ID)",
            },
            newPrimaryEmployeeId: {
                type: "number",
                description: "ID of the new primary employee (새 담당 관리사 ID)",
            },
            newSecondaryEmployeeId: {
                type: "number",
                description: "ID of the new secondary employee (새 보조 관리사 ID, optional)",
            },
            confirmed: {
                type: "boolean",
                description: "Set to true to confirm. Set to false to request confirmation first.",
            },
        },
        required: ["clientId", "newPrimaryEmployeeId", "confirmed"],
    },
};
```

**Update clientTools array:**
```typescript
export const clientTools: FunctionDeclaration[] = [
    searchClientsSchema,
    getClientSchema,
    createClientSchema,
    updateClientSchema,
    deleteClientSchema,
    getClientsByFilterSchema,
    terminateClientServiceSchema,
    requestEmployeeReplacementSchema,
];
```

---

### 2. Update employee.tools.ts - Add Filter & Action Tools

**What to do:**
Add these new tool schemas:

```typescript
export const getAvailableEmployeesSchema: FunctionDeclaration = {
    name: "getAvailableEmployees",
    description: `Get all employees available for new assignments.

USE THIS TOOL when user asks:
- "배정 가능한 관리사", "일할 수 있는 이모님", "가용 인력", "빈 관리사"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee

Returns: List of employees with openToNextWork=true`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const getEmployeesByWorkAreaSchema: FunctionDeclaration = {
    name: "getEmployeesByWorkArea",
    description: `Get employees who work in a specific area.

USE THIS TOOL when user asks:
- "강남구 관리사", "인천 이모님", "서울 제공인력"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            workArea: {
                type: "string",
                description: "Work area to filter by (근무 지역, e.g., '강남구', '인천')",
            },
        },
        required: ["workArea"],
    },
};

export const getEmployeesByGradeSchema: FunctionDeclaration = {
    name: "getEmployeesByGrade",
    description: `Get employees by grade level.

USE THIS TOOL when user asks:
- "1급 관리사", "특급 이모님", "등급별 관리사"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            grade: {
                type: "string",
                description: "Grade level to filter by (등급, e.g., '1급', '2급', '특급')",
            },
        },
        required: ["grade"],
    },
};

export const changeEmployeeAvailabilitySchema: FunctionDeclaration = {
    name: "changeEmployeeAvailability",
    description: `Change an employee's availability status. Requires confirmation.

USE THIS TOOL when user asks:
- "관리사 배정 가능으로 변경", "이모님 휴무 처리", "제공인력 상태 변경"

SYNONYMS: 제공인력 = 관리사 = 이모님 = 직원 = employee`,
    parameters: {
        type: "object",
        properties: {
            employeeId: {
                type: "number",
                description: "The unique ID of the employee (관리사/이모님 ID)",
            },
            available: {
                type: "boolean",
                description: "true = 배정 가능, false = 배정 불가",
            },
            confirmed: {
                type: "boolean",
                description: "Set to true to confirm. Set to false to request confirmation first.",
            },
        },
        required: ["employeeId", "available", "confirmed"],
    },
};
```

**Update employeeTools array:**
```typescript
export const employeeTools: FunctionDeclaration[] = [
    searchEmployeesSchema,
    getEmployeeSchema,
    createEmployeeSchema,
    updateEmployeeSchema,
    deleteEmployeeSchema,
    getAvailableEmployeesSchema,
    getEmployeesByWorkAreaSchema,
    getEmployeesByGradeSchema,
    changeEmployeeAvailabilitySchema,
];
```

---

### 3. Create schedule.tools.ts - New File

**What to do:**
Create new file `backend/application/ai-chat/tools/schedule.tools.ts`:

```typescript
import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const listSchedulesSchema: FunctionDeclaration = {
    name: "listSchedules",
    description: `List all employee schedules.

USE THIS TOOL when user asks:
- "스케줄 목록", "배정 현황", "근무 일정"

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
```

---

### 4. Create voucher.tools.ts - New File

**What to do:**
Create new file `backend/application/ai-chat/tools/voucher.tools.ts`:

```typescript
import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const listVoucherPricesSchema: FunctionDeclaration = {
    name: "listVoucherPrices",
    description: `List all voucher price information.

USE THIS TOOL when user asks:
- "바우처 가격표", "요금표", "가격 정보", "바우처 요금"

Returns: List of all voucher prices with type, duration, prices`,
    parameters: {
        type: "object",
        properties: {
            year: {
                type: "number",
                description: "Filter by year (연도, optional)",
            },
        },
        required: [],
    },
};

export const getVoucherPriceByTypeSchema: FunctionDeclaration = {
    name: "getVoucherPriceByType",
    description: `Get voucher prices for a specific type.

USE THIS TOOL when user asks:
- "A형 가격", "통합1형 요금", "바우처 유형별 가격"`,
    parameters: {
        type: "object",
        properties: {
            type: {
                type: "string",
                description: "Voucher type (바우처 유형, e.g., 'A통합1형', 'B통합2형')",
            },
            year: {
                type: "number",
                description: "Filter by year (연도, optional)",
            },
        },
        required: ["type"],
    },
};

export const voucherTools: FunctionDeclaration[] = [
    listVoucherPricesSchema,
    getVoucherPriceByTypeSchema,
];
```

---

### 5. Create bankAccount.tools.ts - New File

**What to do:**
Create new file `backend/application/ai-chat/tools/bankAccount.tools.ts`:

```typescript
import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const listBankAccountsSchema: FunctionDeclaration = {
    name: "listBankAccounts",
    description: `List all bank account information by area.

USE THIS TOOL when user asks:
- "계좌 정보", "입금 계좌", "은행 계좌 목록"

Returns: List of all bank accounts with area, bank name, account number`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const getBankAccountByAreaSchema: FunctionDeclaration = {
    name: "getBankAccountByArea",
    description: `Get bank account information for a specific area.

USE THIS TOOL when user asks:
- "인천 계좌", "강남구 입금 계좌", "지역별 계좌"`,
    parameters: {
        type: "object",
        properties: {
            area: {
                type: "string",
                description: "Area name (지역명, e.g., '인천', '강남구')",
            },
        },
        required: ["area"],
    },
};

export const bankAccountTools: FunctionDeclaration[] = [
    listBankAccountsSchema,
    getBankAccountByAreaSchema,
];
```

---

### 6. Update contract.tools.ts - Add listAllContracts

**What to do:**
Add this new tool schema:

```typescript
export const listAllContractsSchema: FunctionDeclaration = {
    name: "listAllContracts",
    description: `List all eformsign contract documents.

USE THIS TOOL when user asks:
- "모든 계약서", "계약서 목록", "전체 계약 현황"

Returns: List of all contracts with status, client info, dates`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};
```

**Update contractTools array to include it.**

---

### 7. Update index.ts - Export All New Tools

**What to do:**
Update `backend/application/ai-chat/tools/index.ts`:

```typescript
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
```

---

### 8. Update tool-executor.service.ts - Add Service Injections

**What to do:**
Add imports and inject new services:

```typescript
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";

// In constructor:
constructor(
    private readonly clientService: ClientService,
    private readonly employeeService: EmployeeService,
    private readonly messageService: MessageService,
    private readonly areaTemplateService: AreaTemplateService,
    private readonly eformsignDocService: EformsignDocService,
    private readonly voucherPriceInfoService: VoucherPriceInfoService,
    private readonly bankAccountInfoService: BankAccountInfoService,
    private readonly employeeScheduleService: EmployeeScheduleService,
) {}
```

---

### 9. Update tool-executor.service.ts - Add Switch Cases

**What to do:**
Add new cases in the execute() switch statement:

```typescript
// Client filters & actions
case "getClientsByFilter":
    return this.getClientsByFilter(args);
case "terminateClientService":
    return this.terminateClientService(args);
case "requestEmployeeReplacement":
    return this.requestEmployeeReplacement(args);

// Employee filters & actions
case "getAvailableEmployees":
    return this.getAvailableEmployees();
case "getEmployeesByWorkArea":
    return this.getEmployeesByWorkArea(args);
case "getEmployeesByGrade":
    return this.getEmployeesByGrade(args);
case "changeEmployeeAvailability":
    return this.changeEmployeeAvailability(args);

// Schedules
case "listSchedules":
    return this.listSchedules();
case "getSchedulesByEmployee":
    return this.getSchedulesByEmployee(args);

// Voucher prices
case "listVoucherPrices":
    return this.listVoucherPrices(args);
case "getVoucherPriceByType":
    return this.getVoucherPriceByType(args);

// Bank accounts
case "listBankAccounts":
    return this.listBankAccounts();
case "getBankAccountByArea":
    return this.getBankAccountByArea(args);

// Contracts
case "listAllContracts":
    return this.listAllContracts();
```

---

### 10. Update tool-executor.service.ts - Add Handler Methods

**What to do:**
Add these handler methods:

```typescript
// ============ Client Filters & Actions ============

private async getClientsByFilter(args: ToolArgs): Promise<ToolExecutionResult> {
    const filter = String(args['filter']);
    const clients = await this.clientService.findByFilter(filter);
    return {
        success: true,
        data: {
            filter,
            count: clients.length,
            clients: clients.map(c => ({
                id: c.id,
                name: c.name,
                phone: c.phone,
                serviceStatus: c.serviceStatus,
                startDate: c.startDate,
                endDate: c.endDate,
                primaryEmployee: c.primaryEmployee?.name,
            })),
        },
    };
}

private async terminateClientService(args: ToolArgs): Promise<ToolExecutionResult> {
    const clientId = Number(args['clientId']);
    const reason = args['reason'] ? String(args['reason']) : undefined;
    const client = await this.clientService.terminateService(clientId, reason);
    return { success: true, data: { id: client.id, name: client.name, message: "서비스가 종료되었습니다" } };
}

private async requestEmployeeReplacement(args: ToolArgs): Promise<ToolExecutionResult> {
    const clientId = Number(args['clientId']);
    const newPrimaryEmployeeId = Number(args['newPrimaryEmployeeId']);
    const newSecondaryEmployeeId = args['newSecondaryEmployeeId'] ? Number(args['newSecondaryEmployeeId']) : undefined;
    const client = await this.clientService.requestReplacement(clientId, newPrimaryEmployeeId, newSecondaryEmployeeId);
    return { success: true, data: { id: client.id, name: client.name, message: "관리사 교체가 요청되었습니다" } };
}

// ============ Employee Filters & Actions ============

private async getAvailableEmployees(): Promise<ToolExecutionResult> {
    const employees = await this.employeeService.findAllOpenToNextWork();
    return {
        success: true,
        data: employees.map(e => ({
            id: e.id,
            name: e.name,
            phone: e.phone,
            grade: e.grade,
            workArea: e.workArea,
        })),
    };
}

private async getEmployeesByWorkArea(args: ToolArgs): Promise<ToolExecutionResult> {
    const workArea = String(args['workArea']);
    const employees = await this.employeeService.findByWorkArea(workArea);
    return {
        success: true,
        data: employees.map(e => ({
            id: e.id,
            name: e.name,
            phone: e.phone,
            grade: e.grade,
            openToNextWork: e.openToNextWork,
        })),
    };
}

private async getEmployeesByGrade(args: ToolArgs): Promise<ToolExecutionResult> {
    const grade = String(args['grade']);
    const employees = await this.employeeService.findByGrade(grade);
    return {
        success: true,
        data: employees.map(e => ({
            id: e.id,
            name: e.name,
            phone: e.phone,
            workArea: e.workArea,
            openToNextWork: e.openToNextWork,
        })),
    };
}

private async changeEmployeeAvailability(args: ToolArgs): Promise<ToolExecutionResult> {
    const employeeId = Number(args['employeeId']);
    const available = Boolean(args['available']);
    const employee = await this.employeeService.changeOpenStatus(employeeId, available);
    return { 
        success: true, 
        data: { 
            id: employee.id, 
            name: employee.name, 
            openToNextWork: employee.openToNextWork,
            message: available ? "배정 가능으로 변경되었습니다" : "배정 불가로 변경되었습니다" 
        } 
    };
}

// ============ Schedules ============

private async listSchedules(): Promise<ToolExecutionResult> {
    const schedules = await this.employeeScheduleService.findAll();
    return {
        success: true,
        data: schedules.map(s => ({
            id: s.id,
            clientId: s.clientId,
            primaryEmployeeId: s.primaryEmployeeId,
            secondaryEmployeeId: s.secondaryEmployeeId,
            workAddress: s.workAddress,
            startDate: s.startDate,
            endDate: s.endDate,
            replaced: s.replaced,
        })),
    };
}

private async getSchedulesByEmployee(args: ToolArgs): Promise<ToolExecutionResult> {
    const employeeId = Number(args['employeeId']);
    const [primarySchedules, secondarySchedules] = await Promise.all([
        this.employeeScheduleService.findByPrimaryEmployeeId(employeeId),
        this.employeeScheduleService.findBySecondaryEmployeeId(employeeId),
    ]);
    return {
        success: true,
        data: {
            asPrimary: primarySchedules.map(s => ({
                id: s.id,
                clientId: s.clientId,
                workAddress: s.workAddress,
                startDate: s.startDate,
                endDate: s.endDate,
            })),
            asSecondary: secondarySchedules.map(s => ({
                id: s.id,
                clientId: s.clientId,
                workAddress: s.workAddress,
                startDate: s.startDate,
                endDate: s.endDate,
            })),
        },
    };
}

// ============ Voucher Prices ============

private async listVoucherPrices(args: ToolArgs): Promise<ToolExecutionResult> {
    const vouchers = await this.voucherPriceInfoService.list();
    return {
        success: true,
        data: vouchers.map(v => ({
            id: v.id,
            type: v.type,
            duration: v.duration,
            fullPrice: v.fullPrice,
            grant: v.grant,
            actualPrice: v.actualPrice,
            year: v.year,
        })),
    };
}

private async getVoucherPriceByType(args: ToolArgs): Promise<ToolExecutionResult> {
    const type = String(args['type']);
    const year = args['year'] ? Number(args['year']) : undefined;
    const vouchers = await this.voucherPriceInfoService.findByType(type, year);
    return {
        success: true,
        data: vouchers.map(v => ({
            id: v.id,
            type: v.type,
            duration: v.duration,
            fullPrice: v.fullPrice,
            grant: v.grant,
            actualPrice: v.actualPrice,
            year: v.year,
        })),
    };
}

// ============ Bank Accounts ============

private async listBankAccounts(): Promise<ToolExecutionResult> {
    const accounts = await this.bankAccountInfoService.findAll();
    return {
        success: true,
        data: accounts.map(a => ({
            area: a.area,
            bankName: a.bankName,
            accNum: a.accNum,
        })),
    };
}

private async getBankAccountByArea(args: ToolArgs): Promise<ToolExecutionResult> {
    const area = String(args['area']);
    const account = await this.bankAccountInfoService.findByArea(area);
    if (!account) {
        return { success: false, error: `${area} 지역의 계좌 정보를 찾을 수 없습니다` };
    }
    return {
        success: true,
        data: {
            area: account.area,
            bankName: account.bankName,
            accNum: account.accNum,
        },
    };
}

// ============ Contracts ============

private async listAllContracts(): Promise<ToolExecutionResult> {
    const contracts = await this.eformsignDocService.findAll();
    return {
        success: true,
        data: contracts.map(c => ({
            id: c.id,
            documentId: c.documentId,
            clientId: c.clientId,
            templateName: c.templateName,
            statusType: c.statusType,
            currentStepName: c.currentStepName,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
        })),
    };
}
```

---

### 11. Update tool-executor.service.ts - Add Confirmation Messages

**What to do:**
Add to the `requestConfirmation` messages object:

```typescript
terminateClientService: `산모 ID ${args['clientId']}의 서비스를 종료하시겠습니까?`,
requestEmployeeReplacement: `산모 ID ${args['clientId']}의 관리사를 교체하시겠습니까?`,
changeEmployeeAvailability: `관리사 ID ${args['employeeId']}의 배정 상태를 변경하시겠습니까?`,
```

---

### 12. Update ai-chat.module.ts - Import New Services

**What to do:**
Update `backend/module/ai-chat.module.ts` to import the new service modules:

```typescript
import { VoucherPriceInfoModule } from "./voucher-price-info.module";
import { BankAccountInfoModule } from "./bank-account-info.module";
import { EmployeeScheduleModule } from "./employee-schedule.module";

@Module({
    imports: [
        ClientModule,
        EmployeeModule,
        MessageModule,
        AreaTemplateModule,
        EformsignDocModule,
        VoucherPriceInfoModule,
        BankAccountInfoModule,
        EmployeeScheduleModule,
    ],
    // ...
})
```

---

### 13. Update System Prompt with New Capabilities

**What to do:**
Update the AVAILABLE OPERATIONS section in `ai-chat.service.ts`:

```typescript
AVAILABLE OPERATIONS (ONLY THESE):
- 산모 검색/조회: searchClients, getClient, getClientsByFilter
- 산모 등록/수정/삭제: createClient, updateClient, deleteClient
- 산모 서비스 관리: terminateClientService, requestEmployeeReplacement
- 관리사 검색/조회: searchEmployees, getEmployee, getAvailableEmployees, getEmployeesByWorkArea, getEmployeesByGrade
- 관리사 등록/수정/삭제: createEmployee, updateEmployee, deleteEmployee
- 관리사 상태 변경: changeEmployeeAvailability
- 스케줄 조회: listSchedules, getSchedulesByEmployee
- 계약서 관리: listAvailableTemplates, createAndSendContract, getContractStatus, listAllContracts
- 바우처 가격 조회: listVoucherPrices, getVoucherPriceByType
- 계좌 정보 조회: listBankAccounts, getBankAccountByArea
- 메시지 관리: getMessages, createMessage, updateMessage, deleteMessage
- 대시보드 통계: getDashboardStats
```

---

## Success Criteria

### Final Checklist
- [ ] All new tool schema files created
- [ ] All tools exported in index.ts
- [ ] All handlers implemented in tool-executor.service.ts
- [ ] All services injected properly
- [ ] CUD_TOOLS array updated with new confirmation-required tools
- [ ] System prompt updated with new capabilities
- [ ] Backend builds without errors (`npm run build`)
- [ ] User can query "계약서 미발송 산모" and get results

---

## Summary of New Tools (15 new tools)

| Tool Name | Purpose | User Phrases |
|-----------|---------|--------------|
| getClientsByFilter | Filter clients by status | "계약서 미발송 산모", "곧 시작하는 산모" |
| terminateClientService | End client service | "서비스 종료", "퇴소 처리" |
| requestEmployeeReplacement | Replace assigned employee | "관리사 교체", "이모님 바꿔줘" |
| getAvailableEmployees | List available employees | "배정 가능한 관리사", "빈 이모님" |
| getEmployeesByWorkArea | Filter by work area | "강남구 관리사", "인천 이모님" |
| getEmployeesByGrade | Filter by grade | "1급 관리사", "특급 이모님" |
| changeEmployeeAvailability | Change availability status | "관리사 배정 가능으로" |
| listSchedules | List all schedules | "스케줄 목록", "배정 현황" |
| getSchedulesByEmployee | Get employee's schedules | "김이모님 스케줄" |
| listVoucherPrices | List voucher prices | "바우처 가격표", "요금표" |
| getVoucherPriceByType | Get price by type | "A형 가격", "통합1형 요금" |
| listBankAccounts | List bank accounts | "계좌 정보", "입금 계좌" |
| getBankAccountByArea | Get account by area | "인천 계좌", "강남구 계좌" |
| listAllContracts | List all contracts | "모든 계약서", "계약 현황" |
| getMessages | List messages (fix) | "메시지 목록" |

**Total: 18 existing + 15 new = 33 tools**
