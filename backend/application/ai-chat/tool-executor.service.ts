import { Injectable, Logger } from "@nestjs/common";
import { ClientService } from "application/services/client.service";
import { EmployeeService } from "application/services/employee.service";
import { MessageService } from "application/services/message.service";
import { AreaTemplateService } from "application/services/area-template.service";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { VoucherPriceInfoService } from "application/services/voucher-price-info.service";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { isCUDTool } from "./tools";

export interface ToolExecutionResult {
    success: boolean;
    data?: unknown;
    error?: string;
    requiresConfirmation?: boolean;
    confirmationMessage?: string;
}

type ToolArgs = Record<string, unknown>;

@Injectable()
export class ToolExecutorService {
    private readonly logger = new Logger(ToolExecutorService.name);

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

    async execute(toolName: string, args: ToolArgs): Promise<ToolExecutionResult> {
        this.logger.log(`Executing tool: ${toolName} with args: ${JSON.stringify(args)}`);

        if (isCUDTool(toolName) && args['confirmed'] !== true) {
            return this.requestConfirmation(toolName, args);
        }

        try {
            switch (toolName) {
                case "searchClients":
                    return this.searchClients(args);
                case "getClient":
                    return this.getClient(args);
                case "createClient":
                    return this.createClient(args);
                case "updateClient":
                    return this.updateClient(args);
                case "deleteClient":
                    return this.deleteClient(args);
                case "searchEmployees":
                    return this.searchEmployees(args);
                case "getEmployee":
                    return this.getEmployee(args);
                case "createEmployee":
                    return this.createEmployee(args);
                case "updateEmployee":
                    return this.updateEmployee(args);
                case "deleteEmployee":
                    return this.deleteEmployee(args);
                case "getMessages":
                    return this.getMessages();
                case "createMessage":
                    return this.createMessage(args);
                case "updateMessage":
                    return this.updateMessage(args);
                case "deleteMessage":
                    return this.deleteMessage(args);
                case "listAvailableTemplates":
                    return this.listAvailableTemplates();
                case "createAndSendContract":
                    return this.createAndSendContract(args);
                case "getContractStatus":
                    return this.getContractStatus(args);
                case "getDashboardStats":
                    return this.getDashboardStats();
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
                    return this.listVoucherPrices();
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
                default:
                    return { success: false, error: `Unknown tool: ${toolName}` };
            }
        } catch (error) {
            this.logger.error(`Tool execution failed: ${error}`);
            return {
                success: false,
                error: error instanceof Error ? error.message : "도구 실행에 실패했습니다",
            };
        }
    }

    private requestConfirmation(toolName: string, args: ToolArgs): ToolExecutionResult {
        const messages: Record<string, string> = {
            createClient: `새 산모 "${args['name']}"님을 등록하시겠습니까?`,
            updateClient: `산모 ID ${args['clientId']}의 정보를 수정하시겠습니까?`,
            deleteClient: `산모 ID ${args['clientId']}을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            terminateClientService: `산모 ID ${args['clientId']}의 서비스를 종료하시겠습니까?`,
            requestEmployeeReplacement: `산모 ID ${args['clientId']}의 관리사를 교체하시겠습니까? (새 담당: ID ${args['newPrimaryEmployeeId']})`,
            createEmployee: `새 관리사 "${args['name']}"님을 등록하시겠습니까?`,
            updateEmployee: `관리사 ID ${args['employeeId']}의 정보를 수정하시겠습니까?`,
            deleteEmployee: `관리사 ID ${args['employeeId']}을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            changeEmployeeAvailability: `관리사 ID ${args['employeeId']}의 배정 상태를 ${args['available'] ? '가능' : '불가'}으로 변경하시겠습니까?`,
            createMessage: `새 메시지 "${args['title']}"을(를) 등록하시겠습니까?`,
            updateMessage: `메시지 ID ${args['messageId']}을(를) 수정하시겠습니까?`,
            deleteMessage: `메시지 ID ${args['messageId']}을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            createAndSendContract: `산모 ID ${args['clientId']}에게 계약서를 발송하시겠습니까?`,
        };

        return {
            success: true,
            requiresConfirmation: true,
            confirmationMessage: messages[toolName] || `${toolName} 작업을 실행하시겠습니까?`,
        };
    }

    private async searchClients(args: ToolArgs): Promise<ToolExecutionResult> {
        const query = String(args['query'] || "");
        const page = Number(args['page']) || 1;
        const limit = Math.min(Number(args['limit']) || 10, 50);

        const result = await this.clientService.findAllPaginated(page, limit, query);
        return {
            success: true,
            data: {
                clients: result.data.map(c => ({
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    address: c.address,
                    serviceStatus: c.serviceStatus,
                    primaryEmployee: c.primaryEmployee?.name,
                })),
                total: result.total,
                page: result.page,
                totalPages: result.totalPages,
            },
        };
    }

    private async getClient(args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = Number(args['clientId']);
        const client = await this.clientService.findById(clientId);
        if (!client) {
            return { success: false, error: "산모를 찾을 수 없습니다" };
        }
        return { success: true, data: client };
    }

    private async createClient(args: ToolArgs): Promise<ToolExecutionResult> {
        const client = await this.clientService.create({
            name: String(args['name']),
            primaryEmployeeId: Number(args['primaryEmployeeId']),
            secondaryEmployeeId: args['secondaryEmployeeId'] ? Number(args['secondaryEmployeeId']) : null,
            address: args['address'] ? String(args['address']) : null,
            phone: args['phone'] ? String(args['phone']) : null,
            type: args['type'] ? String(args['type']) : null,
            duration: args['duration'] ? Number(args['duration']) : null,
            startDate: args['startDate'] ? String(args['startDate']) : null,
            endDate: args['endDate'] ? String(args['endDate']) : null,
            careCenter: Boolean(args['careCenter']),
            voucherClient: Boolean(args['voucherClient']),
            birthday: args['birthday'] ? String(args['birthday']) : null,
            breastPump: Boolean(args['breastPump']),
        });
        return { success: true, data: { id: client.id, name: client.name, message: "산모가 등록되었습니다" } };
    }

    private async updateClient(args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = Number(args['clientId']);
        const updateData: Record<string, unknown> = {};
        
        if (args['name'] !== undefined) updateData['name'] = String(args['name']);
        if (args['phone'] !== undefined) updateData['phone'] = args['phone'] ? String(args['phone']) : null;
        if (args['address'] !== undefined) updateData['address'] = args['address'] ? String(args['address']) : null;
        if (args['primaryEmployeeId'] !== undefined) updateData['primaryEmployeeId'] = Number(args['primaryEmployeeId']);
        if (args['secondaryEmployeeId'] !== undefined) updateData['secondaryEmployeeId'] = args['secondaryEmployeeId'] ? Number(args['secondaryEmployeeId']) : null;
        if (args['type'] !== undefined) updateData['type'] = args['type'] ? String(args['type']) : null;
        if (args['duration'] !== undefined) updateData['duration'] = args['duration'] ? Number(args['duration']) : null;
        if (args['startDate'] !== undefined) updateData['startDate'] = args['startDate'] ? String(args['startDate']) : null;
        if (args['endDate'] !== undefined) updateData['endDate'] = args['endDate'] ? String(args['endDate']) : null;
        if (args['serviceStatus'] !== undefined) updateData['serviceStatus'] = args['serviceStatus'] ? String(args['serviceStatus']) : null;

        const client = await this.clientService.update(clientId, updateData as Parameters<typeof this.clientService.update>[1]);
        return { success: true, data: { id: client.id, name: client.name, message: "산모 정보가 수정되었습니다" } };
    }

    private async deleteClient(args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = Number(args['clientId']);
        await this.clientService.delete(clientId);
        return { success: true, data: { message: "산모가 삭제되었습니다" } };
    }

    private async searchEmployees(args: ToolArgs): Promise<ToolExecutionResult> {
        const query = String(args['query'] || "");
        const employees = await this.employeeService.findAll();
        const filtered = employees.filter(e => 
            e.name.includes(query) || e.phone.includes(query)
        );
        return {
            success: true,
            data: filtered.map(e => ({
                id: e.id,
                name: e.name,
                phone: e.phone,
                grade: e.grade,
                openToNextWork: e.openToNextWork,
            })),
        };
    }

    private async getEmployee(args: ToolArgs): Promise<ToolExecutionResult> {
        const employeeId = Number(args['employeeId']);
        const employee = await this.employeeService.findById(employeeId);
        if (!employee) {
            return { success: false, error: "관리사를 찾을 수 없습니다" };
        }
        return { success: true, data: employee };
    }

    private async createEmployee(args: ToolArgs): Promise<ToolExecutionResult> {
        const employee = await this.employeeService.create({
            name: String(args['name']),
            phone: String(args['phone']),
            grade: String(args['grade']),
            workArea: args['workArea'] ? String(args['workArea']).split(",").map(s => s.trim()) : [],
            openToNextWork: args['openToNextWork'] !== false,
            registeredDate: args['companyRegisteredDate'] ? String(args['companyRegisteredDate']) : undefined,
        });
        return { success: true, data: { id: employee.id, name: employee.name, message: "관리사가 등록되었습니다" } };
    }

    private async updateEmployee(args: ToolArgs): Promise<ToolExecutionResult> {
        const employeeId = Number(args['employeeId']);
        const updateData: Record<string, unknown> = {};
        
        if (args['name'] !== undefined) updateData['name'] = String(args['name']);
        if (args['phone'] !== undefined) updateData['phone'] = String(args['phone']);
        if (args['grade'] !== undefined) updateData['grade'] = String(args['grade']);
        if (args['workArea'] !== undefined) updateData['workArea'] = String(args['workArea']).split(",").map(s => s.trim());
        if (args['openToNextWork'] !== undefined) updateData['openToNextWork'] = Boolean(args['openToNextWork']);

        const employee = await this.employeeService.update(employeeId, updateData as Parameters<typeof this.employeeService.update>[1]);
        return { success: true, data: { id: employee.id, name: employee.name, message: "관리사 정보가 수정되었습니다" } };
    }

    private async deleteEmployee(args: ToolArgs): Promise<ToolExecutionResult> {
        const employeeId = Number(args['employeeId']);
        await this.employeeService.delete(employeeId);
        return { success: true, data: { message: "관리사가 삭제되었습니다" } };
    }

    private async getMessages(): Promise<ToolExecutionResult> {
        return { success: false, error: "메시지 목록 조회는 지원되지 않습니다" };
    }

    private async createMessage(args: ToolArgs): Promise<ToolExecutionResult> {
        const message = await this.messageService.create(
            String(args['title']),
            String(args['text']),
        );
        return { success: true, data: { id: message.id, title: message.title, message: "메시지가 등록되었습니다" } };
    }

    private async updateMessage(args: ToolArgs): Promise<ToolExecutionResult> {
        const messageId = Number(args['messageId']);
        const title = args['title'] !== undefined ? String(args['title']) : "";
        const text = args['text'] !== undefined ? String(args['text']) : "";

        const message = await this.messageService.update(messageId, title, text);
        return { success: true, data: { id: message.id, title: message.title, message: "메시지가 수정되었습니다" } };
    }

    private async deleteMessage(args: ToolArgs): Promise<ToolExecutionResult> {
        const messageId = Number(args['messageId']);
        await this.messageService.delete(messageId);
        return { success: true, data: { message: "메시지가 삭제되었습니다" } };
    }

    private async listAvailableTemplates(): Promise<ToolExecutionResult> {
        const templates = await this.areaTemplateService.findAll();
        return {
            success: true,
            data: templates.map(t => ({
                areaId: t.areaId,
                templateId: t.templateId,
                templateName: t.templateName,
            })),
        };
    }

    private async createAndSendContract(args: ToolArgs): Promise<ToolExecutionResult> {
        const clientId = Number(args['clientId']);
        const areaId = String(args['areaId']);

        const template = await this.areaTemplateService.findByArea(areaId);
        if (!template) {
            return { success: false, error: `지역 "${areaId}"에 대한 템플릿을 찾을 수 없습니다` };
        }

        const result = await this.eformsignDocService.createAndSendContract({
            clientId,
            templateId: template.templateId,
            templateName: template.templateName || undefined,
        });

        if (!result.success) {
            return { success: false, error: result.error };
        }

        return {
            success: true,
            data: {
                documentId: result.documentId,
                message: "계약서가 발송되었습니다",
            },
        };
    }

    private async getContractStatus(args: ToolArgs): Promise<ToolExecutionResult> {
        if (args['documentId']) {
            const doc = await this.eformsignDocService.findByDocumentId(String(args['documentId']));
            if (!doc) {
                return { success: false, error: "문서를 찾을 수 없습니다" };
            }
            return { success: true, data: doc };
        }

        if (args['clientId']) {
            const docs = await this.eformsignDocService.findByClientId(Number(args['clientId']));
            return { success: true, data: docs };
        }

        return { success: false, error: "documentId 또는 clientId가 필요합니다" };
    }

    private async getDashboardStats(): Promise<ToolExecutionResult> {
        const [allClients, startingSoon, endingSoon, incompleteContracts, noContract] = await Promise.all([
            this.clientService.findAll(),
            this.clientService.findByFilter("starting-soon"),
            this.clientService.findByFilter("ending-soon"),
            this.clientService.findByFilter("incomplete-contracts"),
            this.clientService.findByFilter("no-contract"),
        ]);

        return {
            success: true,
            data: {
                totalClients: allClients.length,
                startingSoonCount: startingSoon.length,
                endingSoonCount: endingSoon.length,
                incompleteContractsCount: incompleteContracts.length,
                noContractCount: noContract.length,
            },
        };
    }

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
                message: available ? "배정 가능으로 변경되었습니다" : "배정 불가로 변경되었습니다",
            },
        };
    }

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

    private async listVoucherPrices(): Promise<ToolExecutionResult> {
        const vouchers = await this.voucherPriceInfoService.list();
        return {
            success: true,
            data: vouchers.map(v => ({
                id: v.id,
                type: v.type,
                duration: Number(v.duration),
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
                duration: Number(v.duration),
                fullPrice: v.fullPrice,
                grant: v.grant,
                actualPrice: v.actualPrice,
                year: v.year,
            })),
        };
    }

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

    private async listAllContracts(): Promise<ToolExecutionResult> {
        const contracts = await this.eformsignDocService.findAll();
        return {
            success: true,
            data: contracts.map(c => ({
                id: c.id,
                documentId: c.documentId,
                clientId: c.clientId,
                statusType: c.statusType,
                statusDetail: c.statusDetail,
                stepName: c.stepName,
                createdDate: c.createdDate,
                updatedDate: c.updatedDate,
            })),
        };
    }
}
